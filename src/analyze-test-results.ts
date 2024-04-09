import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getTestReportingPath } from './render/render-test-results.js';
import { TestLaunchMetrics, TestResult } from './types.js';
import { Chainable } from './util.js';

type TestContextStructure = {
  timing: {
    test_orchestration: {
      [testRunDateId: string]: TestLaunchMetrics;
    };
    test_launch: {
      parent_testRunDateId: string; // FK to the orchestration values
      processes: {
        [testRunDateNotReallyAsAnId: string]: TestLaunchMetrics;
      }
    };
    test_execution: {
      [testName: string]: {
        [testRunDateId: string]: {
          durationMs: number;
          cpuTimeOverall: number;
        };
      };
    };
  };
};

// test results upon submission (completion) is being written immediately to filesystem under a launch session dir. That's a backup semi user friendly source of truth, but we will duplicate all that information (and possibly more analysis geared information) in a single test context file here that is persistent across launches.

const testContextFile = 'test-context.json';
// Reminder, this should be only run by a designated test coordinating environment. It performs no data access locking.
export const processTestResults = (results: TestResult[], metrics: { [key: string]: any }) => {
  // Establishes a test context database. This is a similar concept to the instrumentation context, where we're
  // populating a giant nested KV store that for test execution scheduling purposes is persistent to drive various scheduling heuristics.

  const testContext = loadTestContext();
  pruneTestContext(testContext);
  const testRunDateId = getTestReportingPath()?.pop();

  if (testRunDateId) {
    // write results with a different structure chosen for making analysis more convenient
    for (const res of results) {
      const testName = (res.suite ? `${res.suite}:` : '') + res.name;
      const testrecord = new Chainable(testContext).obj('timing').obj('test_execution').obj(testName).objR(testRunDateId);
      testrecord.durationMs = res.durationMs;
      const spawnCpuSec = res.resourceMetrics.reduce((a, b) => b.resources ? b.resources?.sys + b.resources?.user + a: a, 0);
      const selfCpuSec = (res.cpu.user + res.cpu.system) / 1e6;
      testrecord.cpuTimeOverall = selfCpuSec + spawnCpuSec;
      // TODO generically make all result fields not related to name/file/suite be saved in this same way so i dont need to
      // maintain this when adding new metrics
    }
    // testContext.obj('timing').obj('test_orchestration').obj(testRunDateId, metrics);
    // console.error('test context', 'metrics for processTestResults', metrics);
    writeFileSync(testContextFile, JSON.stringify(testContext));
  } else {
    throw new Error('testRunDateId not found');
  }
};

export const loadTestContext = () => {
  if (!existsSync(testContextFile)) { writeFileSync(testContextFile, '{}'); }
  return JSON.parse(readFileSync(testContextFile).toString('utf8')) as TestContextStructure;
};

const timeFromDateFilename = (datefilename: string) => {
  // date string built as such: new Date().toISOString().replace(/:/g, '_')
  const normalizedString = datefilename.replace(/_/g, ':');
  return new Date(normalizedString).getTime();
}

// a param mutator
const pruneTestContext = (tc: TestContextStructure) => {
  const duration_ms = 1000 * 60 * 60 * 24 * 7; // 7 days
  const logging_pruned_entries: { [time: string]: number } = {};
  const shape: number[] = [];
  let shapeIndex = 0
  for (const testName in tc?.timing?.test_execution) {
    for (const testRunDateId in tc.timing.test_execution[testName]) {
      shape[shapeIndex] = shape[shapeIndex] + 1 || 1;
      if (Date.now() - timeFromDateFilename(testRunDateId) > duration_ms) {
        logging_pruned_entries[testRunDateId] = logging_pruned_entries[testRunDateId] + 1 || 1;
        delete tc.timing.test_execution[testName][testRunDateId];
      }
    }
    shapeIndex++;
  }
  console.error('test context', 'shape', shape);
  console.error('test context', 'pruned (should basically be a count of test results for each date entry we pruned)', logging_pruned_entries);
};

