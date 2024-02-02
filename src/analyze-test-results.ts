import { existsSync, readFileSync, writeFileSync } from 'fs';
import "../context/index.js";
import { getResults, getTestReportingPath } from './render-test-results.js';

// test results upon submission (completion) is being written immediately to filesystem under a launch session dir. That's a backup semi user friendly source of truth, but we will duplicate all that information (and possibly more analysis geared information) in a single test context file that is persistent across launches.

// Reminder, this should be only run by test coordinating environment. It performs no data access locking.
export const processTestResults = () => {
  // Establishes a test context database. This is a similar concept to the instrumentation context, where we're
  // populating a giant nested KV store that for test execution scheduling purposes is persistent to drive various scheduling heuristics.

  if (!existsSync('test-context.json')) {
    writeFileSync('test-context.json', JSON.stringify({}));
  }

  const testContext = JSON.parse(readFileSync('test-context.json').toString('utf8'));
  const testRunDateId = getTestReportingPath();
  // write results with a different structure chosen for making analysis more convenient
  for (const res of getResults()) {
    const testName = (res.suite ? res.suite + ':' : '') + res.name;
    testContext.obj('timing').obj('execution').obj(testName).obj(testRunDateId)['durationMs'] = res.durationMs;
    // TODO generically make all result fields not related to name/file/suite be saved in this same way so i dont need to
    // maintain this when adding new metrics
  }
  writeFileSync('test-context.json', JSON.stringify(testContext));
};
