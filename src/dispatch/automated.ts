import * as os from 'os';
import { hrTimeMs, weightedAverageFromBackByLUT } from "ts-utils";
import { format } from 'ts-utils/node/format';
import { loadTestContext } from '../analyze-test-results.js';
import { TFun } from '../main.js';
import { MinHeap } from '../min-heap.js';
import { spawnAsync } from '../process.js';
import { establishTestResultsDir, getTestReportingPath } from '../render/render-test-results.js';
import { SpawnResourceReport, TestDispatchResult, TestMetadata, TestResult } from '../types.js';
import { TestLaunchSeparator } from './flags.js';
import { tf, topt } from './util.js';

export type LaunchJobsList = { testName: string; suite?: string; file: string; testTimeEstimateMs: number; debug_prev_records?: number[]; }[];

// Used to launch tests in processes in headless mode. For now, this receives the tests loaded in after the file filtering is done
export async function launchAutomatedProcessTestsFromRegistryInParallel(
  testRegistry: Map<TFun | (() => Promise<void>), TestMetadata>,
  predicate: (t: TestMetadata) => boolean
) {
  // not sure how we want to do this eventually, but starting out with local launch and then spreading to other nodes over SSH should be solid
  // when we have a remote node, we assume the repo is already present and synchronized starting from the initial run.
  // Subsequently we trace and transfer only the deltas that have changed for each new run.
  // All of this will be confirmed and maintained by the processing step.
  // for now, launch the tests locally to realize 20x speed gain!
  // ~~also for now, utilize gnu parallel to do the process launching. Even on remote nodes.~~ scratch that. make own
  // scheduling system. Greedy is going to work well.
  // first collect launch metrics from persisted test context about the tests we are told to run. any new/renamed ones
  // wont be matches and we can just assume they will take the median amount of time to run.
  // use values that we provide in config for better establishing metrics, such as time it takes to go from remote
  // trigger initiation to initial test launch. So this could be assigned per machine. TODO eventually these can be
  // automatically determined.
  // estimate their total runtime by estimating CPU consumption (multiply cpu usage by time). This will amortize
  // effectively once there are enough tests.
  // determine how much benefit there will be had for more than one node and see if they are already online, and plan
  // accordingly (e.g. factor in added time of node startup in planning).
  const launchJobsList: LaunchJobsList = [];

  const testContext = loadTestContext();

  type TestContextTest = (typeof testContext)['timing']['test_execution'][string];

  function weightedRecentAverageWallTime(test: TestContextTest) {
    const durations = Object.values(test).map(e => e.durationMs).filter(e => e);
    return weightedAverageFromBackByLUT(durations);
  }

  for (const [_testFn, meta] of testRegistry) {
    const { name, filename: file, suite } = meta;
    if (!predicate(meta)) {
      console.error(`Skipping dispatch of test ${suite ? `${suite}:` : ""}${name} due to filter.`);
      continue;
    }

    const this_test_prev_records = testContext?.timing?.test_execution[`${suite ? `${suite}:` : ''}${name}`];
    if (this_test_prev_records && Object.keys(this_test_prev_records).length) {
      launchJobsList.push({
        testName: name, suite, file,
        testTimeEstimateMs: weightedRecentAverageWallTime(this_test_prev_records),
        // debug_prev_records: Object.values(this_test_prev_records).map(e => e.cpuTimeOverall).slice(-15)
      });
    } else {
      // assume given no data that a test will take 0.1s to run
      launchJobsList.push({ testName: name, suite, file, testTimeEstimateMs: 100 });
    }
  }

  // testName: ['node', ["-r", "source-map-support/register", "build/test/runner.js", tf.Automated, ...testSpec]],
  // const testSpec = [file, '__', testName];
  // console.error("launchAutomatedProcessTestsFromRegistryInParallel: launchCmdList", launchJobsList);
  launchJobsList.sort((a, b) => b.testTimeEstimateMs - a.testTimeEstimateMs);
  // ln('parallel test launch', 'sort order', launchJobsList.map(e => e.cpuTimeTotal));
  const totalThreads = Number(topt(tf.Concurrency)) || os.cpus().length;
  console.error(`launching on`, totalThreads, `processes`);
  // schedule logic, greedy: in longest to shortest order, distribute to nodes
  // type Schedule = { totalCPUSec: number, jobs: typeof launchJobsList }[];
  const schedArr =  Array.from({ length: totalThreads }, () => ({
    totalExpectedRuntimeMs: 0 as number,
    jobs: [] as LaunchJobsList
  }));
  const schedule_min_heap = new MinHeap('totalExpectedRuntimeMs', schedArr);

  for (const job of launchJobsList) {
    const { testTimeEstimateMs } = job;
    const next = schedule_min_heap.extractMin();
    if (next) {
      next.totalExpectedRuntimeMs += testTimeEstimateMs;
      next.jobs.push(job);
      schedule_min_heap.insert(next);
    } else {
      throw new Error('should never be able to pop an empty value out of the scheduling min heap');
    }
  }

  // ln('parallel test launch', 'parallel test launch schedule', schedule_min_heap.dump());
  console.error('parallel test launch', 'process expected runtimes', schedule_min_heap.dump().map(e => e.totalExpectedRuntimeMs));

  // final pre launch checks
  let testReportingPath: string[] | undefined;
  if (schedule_min_heap.dump().some(e => e.jobs.length)) {
    establishTestResultsDir().catch(e => { throw new Error(`Error establishing test results dir: ${e}`); });
    testReportingPath = getTestReportingPath();
  } else {
    throw new Error('Parallel launch: Received no tests to run, which is unusual.');
  }
  if (!testReportingPath) {
    throw new Error('Parallel launch: Did not obtain test reporting path, which is unusual.');
  }
  const testReportingId = testReportingPath.pop();
  if (!testReportingId) {
    throw new Error('Parallel launch: test reporting path exists but popping it yielded something falsy, which is very unusual.');
  }

  const finalSchedule = schedule_min_heap.dump().filter(jg => jg.jobs.length);
  console.error('finalSchedule', format(finalSchedule));

  // const testResults: TestResult[] = [];
  // const dispatchMetrics: TestProcessDispatchMetrics[] = [];

  // stuff the results in the schedule structure for returning

  return (await Promise.allSettled(finalSchedule.map(jobGroup => {
    const files = jobGroup.jobs.map(e => e.file);
    const testNames = jobGroup.jobs.map(e => (e.suite ? e.suite + ":" : '') + e.testName);
    const cmd: [string, string[]] = ['node', ["-r", "source-map-support/register", "build/test/dispatch/runner.js", tf.Automated, tf.ExactTestNameMatching, ...files, TestLaunchSeparator, ...testNames]];
    return spawnAsync(...cmd, console.error, {
      bufferStdout: true,
      shortenCmdArgs: true,
      hideCmd: true
    });
  }))).map((s, i) => {
    const schedule = finalSchedule[i];
    if (s.status === 'fulfilled') {
      const { duration, resources, stdout } = s.value;
      const dispatchResults = JSON.parse(stdout) as TestDispatchResult;
      return { schedule, dispatchResults, duration: hrTimeMs(duration), resources };
    } else {
      return { schedule, reason: s.reason };
    }
  });
  // this return needs to line up with DistributedResultSignature. (It does so far. was tricky)
}

type DistributedResultSignature = ({
  schedule: {
    totalExpectedCpuSec: number;
    jobs: LaunchJobsList
  }
} & ({
  duration: number;
  resources: SpawnResourceReport;
  testResults: TestDispatchResult;
} | {
  reason: PromiseRejectedResult['reason']
}))[];

// extracts metadata from complex schedule based launch results structure while reassembling for regular test processing (flat test results arr) 
export const processDistributedTestResults = (results: /* DistributedResultSignature */ Awaited<ReturnType<typeof launchAutomatedProcessTestsFromRegistryInParallel>>) => {
  const outputResults: TestResult[] = [];
  const distributed_metrics: { [key: string]: any }[] = [];
  for (const result of results) {
    if ('reason' in result) {
      console.error('Test dispatch failed with reason:', result.reason);
      continue;
    }
    const { testResults, ...rest } = result.dispatchResults;
    const { duration, schedule, resources } = result;
    console.error('processDistributedTestResults debug metrics dump', duration, schedule, resources, rest);
    distributed_metrics.push({
      duration, schedule, resources,
      ...rest
    });
    outputResults.push(...testResults);
  }
  return {
    outputResults,
    distributed_metrics
  }
};


