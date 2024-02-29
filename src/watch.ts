import { setupWatchBuild } from '../watch/build.js';
import { discoverTests, runTests } from './dispatch/runner.js';
import { bindRepl, stopRepl } from '../repl.js';
import { recordResults, renderResults } from './render/render-test-results.js';
import { stopWatching } from '../watch/util.js';
import { fileURLToPath } from "url";
import { startServer, stopServer } from './web-server.js';
import { processTestResults } from './analyze-test-results.js';
import { parseTestLaunchingArgs, tf, topt } from './dispatch/util.js';
import { l } from '../log.js';

// note carefully this specific code cannot be factored to a different file, it changes its semantics.
const isProgramLaunchContext = () => {
  // this cjs launch detection impl will need to change if we change compilation to target modules
  return fileURLToPath(import.meta.url) === process.argv[1];
}

function cleanup() {
  stopWatching().catch((e) => { console.log("error stopping watch"); throw e; });
  stopServer();
  stopRepl();
}

isProgramLaunchContext() && (async () => {
  console.log("Hi from file watching test runner entry point test/watch.ts");
  // note test launch flag handling happens inside of here. Some config such as --automated may lead to unexpected behavior (e.g. repl still made for test watch).

  const testSpecification = parseTestLaunchingArgs(process.argv.slice(2));
  l("test launch spec:", testSpecification.files, testSpecification.testPredicate.toString());
  const { registry, ...metrics } = await discoverTests(testSpecification.files);
  const { testResults, ...metrics2 } = await runTests(registry, testSpecification.testPredicate);
  // there is a slight change in behavior now that I have test output writing to files broken out, which is if tests
  // fail outside of the runner (e.g. exception in I/O handler) then now we may never write any of the results to
  // disk instead of the ones that already completed.
  recordResults(testResults);
  const all_metrics = { ...metrics, ...metrics2 };
  processTestResults(testResults, all_metrics);
  renderResults(testResults);

  startServer();
  // there is no need to apply automated test launch state to this repl launch because automated should never be used
  // with test-watch(-loop).
  setupWatchBuild(cleanup);
  bindRepl({
    q: { long: 'quit', desc: 'Quit',
      action: () => { console.log("Bye!"); process.exitCode = 115; cleanup(); }},
    r: { long: 'run', desc: '(Re-)Run specified tests (run all if no tests are specified)',
      action: () => { console.log("Unimplemented"); }},
    // ra: { long: 'run-all', desc: '(Re-)Run all tests',
    //   action: async () => { await stopWatching(); await runTests(); renderResults(); setupWatchBuild(cleanup); }},
    l: { long: 'list', desc: 'List all tests without running anything. Note if this was launched with a file filter, it cannot catch all of them.', action: () => { console.log("Not implemented yet"); }},
    t: { long: 'test', desc: 'provide test launch specification', config_value_key: "test_spec"},
    e: { long: 'expand', desc: 'toggle expansion of test suite individual test results', config_key: 'test_reporting_expand_suites', action: () => renderResults()},
    p: { long: 'print', desc: 'toggle the immediate display of test logging during test runs', config_key: 'echo_test_logging' }
  }, { appName: 'test-watch', quiet: true });
  process.on('exit', () => {
    console.log("test watch cleanly exiting");
  });
})().catch((e) => {
  console.error("Error in test watch launch:", e);
  throw e;
});
