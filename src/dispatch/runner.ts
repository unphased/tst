
import * as fs from 'fs';
import * as path from 'path';
import { hrTimeMs } from 'ts-utils';
import { fileURLToPath } from 'url';
import * as util from 'util';
import { processTestResults } from '../analyze-test-results.js';
import { establishTestResultsDir, recordResults, renderResults } from '../render/render-test-results.js';
import { TestDispatchResult } from '../types.js';
import { renderVisualPercentageLowerIsBetter } from '../util.js';
import { launchAutomatedProcessTestsFromRegistryInParallel, processDistributedTestResults } from './automated.js';
import { runTestsFromRegistry } from './runTestsFromRegistry.js';
import { trigger_dynamic_imports } from './trigger_dynamic_imports.js';
import { parseTestLaunchingArgs, tf, topt } from './util.js';
import { LaunchOptions } from 'src/config/launchOptions.js';

// import { ResourceMonitoringWorkerLaunch } from './resource-monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const discoverTests = async (testFiles: ReturnType<typeof parseTestLaunchingArgs>['files']) => {
  const startf = process.hrtime();
  const files = fs.readdirSync(
    path.join(__dirname, '..'), // to reach src/ TODO make more robust, maybe use projectDir helper?
    { recursive: true, encoding: 'utf8' }
  ).filter(f => path.resolve(__dirname, "..", f) !== __filename); // filter out self, importing that will break us
  const fileDiscoveryDuration = hrTimeMs(process.hrtime(startf));
  const start = process.hrtime();
  const files_filtered = files
    .filter(f => f.match(/\.[jt]s$/)) // importing non js/ts files will fail -- i got some config json and log files under build
    .filter(f => !f.match(/\/payload\/|^workers\//))
    // gluing multiple filters into one regex:
    // 1. importing code under instrument/payload (not ever meant to be tested or run here) will break likely due to
    //    browser deps but also pollute global state
    // 2. workers should never be directly imported
    .filter(f => testFiles.length === 0 || testFiles.includes(f)); // apply specified file import filter

  if (!files_filtered.length) {
    console.error('Please confirm... Prior to filtering, the file list was:', files);
    throw new Error('Zero files remain after filtering');
  }

  console.error(`discoverTests: ${files_filtered.length} files to import: ${files_filtered.join(', ')}`);

  const fileFilteringDuration = hrTimeMs(process.hrtime(start));
  const { registry, stats } = await trigger_dynamic_imports(files_filtered);

  return { registry, fileFilteringDuration, fileDiscoveryDuration, ...stats };
}

export const runTests = async (
  registry: Awaited<ReturnType<typeof trigger_dynamic_imports>>['registry'],
  predicate: ReturnType<typeof parseTestLaunchingArgs>['testPredicate'],
  launch_opts?: LaunchOptions
) => {
  // putting worker thread self-resource monitoring on the backburner, since it should be equally reliable to launch tests
  // one at a time using my own asyncSpawn /usr/bin/time container and obtain metrics: Will come back and implement
  // this approach as well... later.
  // ResourceMonitoringWorkerLaunch(50);

  // Arg handling for test launching is designed around test discovery approach to improve launch
  // speed.  To specify a specific test or tests you want to run (on a given node) we derive the
  // source file(s) we found these tests in, from the parent runner instance, and then specify them
  // based on the suite and name.

  establishTestResultsDir().catch(e => { throw new Error(`Error establishing test results dir: ${e}`); });
  const start = process.hrtime();
  const testResults = await runTestsFromRegistry(registry, launch_opts, predicate, topt(tf.AsyncParallelTestLaunch));
  const testExecutionDuration = hrTimeMs(process.hrtime(start));

  return { testResults, testExecutionDuration };
};

const runParallelTests = async (registry: Awaited<ReturnType<typeof trigger_dynamic_imports>>['registry'], predicate: ReturnType<typeof parseTestLaunchingArgs>['testPredicate']) => {
  const start = process.hrtime();
  // note establishTestResultsDir is called from launchAutomatedProcessTestsFromRegistryInParallel
  const structuredResults = await launchAutomatedProcessTestsFromRegistryInParallel(registry, predicate);
  return { structuredResults, parallelExecutionDuration: process.hrtime(start) };
};

const runTestsDirectly = async (testSpecification: ReturnType<typeof parseTestLaunchingArgs>, launch_opts?: LaunchOptions) => {
  // 'core' of discoverTests
  const { registry, stats } = await trigger_dynamic_imports(testSpecification.files);
  const start = process.hrtime();
  const testResults = await runTestsFromRegistry(registry, launch_opts, testSpecification.testPredicate, topt(tf.AsyncParallelTestLaunch));
  return { testResults, testExecutionDuration: process.hrtime(start), ...stats };
};

// note carefully this specific code cannot be factored to a different file, it changes its semantics.
const isProgramLaunchContext = () => {
  return fileURLToPath(import.meta.url) === process.argv[1];
}

/* Overview for the original intent behind the schedule tree:
 * Consider a scenario of launching tests across many machines with low speed network between some groups or all machines.
 * A schedule of work distributed across these nodes is shaped like a tree and that's how we reach them.
 *** OK, sooooo. The above seems suboptimal and overly complex... all intermediate nodes would be performing transfers.
 *** Realistically, sticking to hub/spoke model when going over the network between machines is the only reasonable
 *** approach. Consider that the combined output would be a larger payload. compression may make an impact but it's just a questionable approach.
*/

isProgramLaunchContext() && void (async () => {
  const testSpecification = parseTestLaunchingArgs(process.argv.slice(2));
  console.error("test launch spec:", testSpecification.files, testSpecification.testPredicate.toString());
  let metricsForEcho: { [k: string]: any } = {};
  let metricsEasyRead = '';

  let testCount: number = 0;
  let launch_opts = {echo_test_logging: false, expand_test_suites_reporting: true};
  if (topt(tf.ForceEnableLogging)) { launch_opts.echo_test_logging = true; }
  if (topt(tf.ForceDisableLogging)) { console.assert(!topt(tf.ForceEnableLogging)); launch_opts.echo_test_logging = false; }
  if (topt(tf.Parallel) && !topt(tf.Automated)) {
    // === root parallel launch
    // - discover tests as specified by easy test spec protocol
    // - perform scheduling logic
    // - spawn processes launching tests accordingly, awaiting their output (this one has some depth to it... but is
    // mostly transparent at this level whether it is launching locally or on remote nodes.)
    // - collate and record test results and recursive output metrics
    // - render test report
    const { registry, ...discoveryMetrics } = await discoverTests(testSpecification.files);
    const { structuredResults, ...parallelLaunchMetrics } = await runParallelTests(registry, testSpecification.testPredicate);
    const { outputResults, distributed_metrics } = processDistributedTestResults(/* (complex types lining up here) */ structuredResults)
    testCount = outputResults.length;
    recordResults(outputResults);
    metricsForEcho = { ...discoveryMetrics, ...parallelLaunchMetrics, distributed_metrics };
    const maxProcessRuntime = Math.max(...distributed_metrics.map(dm => dm.duration));
    metricsEasyRead = `Actual process runtimes\n${distributed_metrics.map(dm => renderVisualPercentageLowerIsBetter(dm.duration, maxProcessRuntime, 20) + ' ' + dm.duration + ' ' + dm.schedule.jobs.map(j => j.testName)).join('\n')}\nExpected runtimes\n${distributed_metrics.map(dm => renderVisualPercentageLowerIsBetter(maxProcessRuntime, dm.schedule.totalExpectedRuntimeMs, 50) + ' ' + dm.schedule.totalExpectedRuntimeMs + ' ' + dm.schedule.jobs.map(j => j.testName)).join('\n')}`;
    processTestResults(outputResults, metricsForEcho);
    renderResults(outputResults, launch_opts);
  } else if (!topt(tf.Automated) && !topt(tf.Parallel)) {
    // === launching without any parallelism (to run all in one process) This is a least-complex happy path and also the OG path.
    // - discover tests as specified by easy test spec protocol
    // - run tests
    // - record results and metrics
    // - render test report
    const { registry, ...metrics } = await discoverTests(testSpecification.files);
    const { testResults, ...metrics2 } = await runTests(registry, testSpecification.testPredicate, launch_opts);
    // there is a slight change in behavior now that I have test output writing to files broken out, which is if tests
    // fail outside of the runner (e.g. exception in I/O handler) then now we may never write any of the results to
    // disk instead of the ones that already completed.
    testCount = testResults.length;
    recordResults(testResults);
    metricsForEcho = { ...metrics, ...metrics2 };
    processTestResults(testResults, metricsForEcho);
    renderResults(testResults, launch_opts);
  } else if (topt(tf.Automated) && topt(tf.Parallel)) {
    // === this is a mid tree node. takes complex (json?) input which specifies a launch schedule.
    // - parse complex launch schedule
    // - spawn processes launching tests accordingly, awaiting their output
    // - recursive automated test run ("medium", possibly recursive complexity) collation takes place here and sent to stdout
    await dispatchLaunches(testSpecification);
  } else { // Here is the case of automated and non parallel
    // === this is a leaf node parallel launch which does actual test launching and also uses easy test spec protocol
    // - launch tests via direct test spec protocol (in practice for now, at first, this is identical to above easy
    // test spec protocol, but in future when that gets fleshed out to be easier it will diverge)
    // - simple collation takes place to send to stdout.
    const { testResults, ...metrics } = await runTestsDirectly(testSpecification, launch_opts);
    metricsForEcho = metrics;
    testCount = testResults.length;
    const dispatchResult: TestDispatchResult = { testResults, ...metrics };
    console.log(JSON.stringify(dispatchResult));
  }
  console.error(`Test launch complete, ${testCount} tests, metrics:`, util.inspect(metricsForEcho, { colors: true, depth: 8 }), `\n${metricsEasyRead}`);
})();


