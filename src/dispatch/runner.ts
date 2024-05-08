import * as fs from 'fs';
import * as path from 'path';
import { hrTimeMs } from 'ts-utils';
import { fileURLToPath } from 'url';
import * as util from 'util';
import { processTestResults } from '../analyze-test-results.js';
import { LaunchOptions } from '../config/launchOptions.js';
import { establishTestResultsDir, recordResults, renderResults } from '../render/render-test-results.js';
import { TestDispatchResult } from '../types.js';
import { renderVisualPercentageLowerIsBetter } from '../util.js';
import { launchAutomatedProcessTestsFromRegistryInParallel, processDistributedTestResults } from './automated.js';
import { runTestsFromRegistry } from './runTestsFromRegistry.js';
import { trigger_dynamic_imports } from './trigger_dynamic_imports.js';
import { parseTestLaunchingArgs, tf, topt } from './util.js';
import { startServer } from '../web-server.js';

// import { ResourceMonitoringWorkerLaunch } from './resource-monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type EnumerateFilesOptions = {
  include_dirs?: true;
  follow_symlinks?: true;
}

// error type guard
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

export async function enumerateFiles(location: string, filter = (_path) => true, options: EnumerateFilesOptions = {}) {
  let entries: fs.Dirent[] | undefined;
  try {
    entries = await fs.promises.readdir(location, { withFileTypes: true });
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOTDIR') {
      return [location];
    } else {
      console.error('enumerateFiles: error reading directory:', location);
      throw e;
    }
  }
  const output = entries
    .filter(entry => entry.isFile() && (options.follow_symlinks ? true : !entry.isSymbolicLink()) && filter(entry))
    .map(entry => path.join(location, entry.name));
  const subDirs = entries.filter(entry => entry.isDirectory() && (options.follow_symlinks ? true : !entry.isSymbolicLink()) && filter(entry));
  if (options.include_dirs) {
    output.push(...subDirs.map(d => path.join(location, d.name)))
  }
  for (const subDir of subDirs) {
    output.push(...await enumerateFiles(path.join(location, subDir.name), filter, options));
  }
  return output;
}

export const discoverTests = async (targetDir: string, js_files_only: boolean, specifiedTestFiles: ReturnType<typeof parseTestLaunchingArgs>['files']) => {
  const startf = process.hrtime();
  console.error('############ pwd, targetDir:', process.cwd(), targetDir);
  const files = (await enumerateFiles(targetDir))
  // const files = fs.readdirSync(targetDir, { recursive: true, encoding: 'utf8' })
    .filter(f => path.resolve(f) !== __filename); // filter out self, importing that will break us
  const fileDiscoveryDuration = hrTimeMs(process.hrtime(startf));
  const start = process.hrtime();
  const js_ts_re = js_files_only ? /\.js$/ : /\.[jt]s$/;
  const files_filtered = files
    .filter(f => f.match(js_ts_re)) // importing non js/ts files will fail -- i got some config json and log files under build
    .filter(f => !f.match(/\/payload\/|\/static\/|^workers\//))
    // gluing multiple filters into one regex:
    // 1. importing code under instrument/payload (not ever meant to be tested or run here) will break likely due to
    //    browser deps but also pollute global state
    // 2. workers should never be directly imported
    .filter(f => specifiedTestFiles.length === 0 || specifiedTestFiles.includes(f)); // apply specified file import filter

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

  void establishTestResultsDir();
  const start = process.hrtime();
  const testResults = await runTestsFromRegistry(registry, launch_opts, predicate, topt(tf.AsyncParallelTestLaunch));
  const testExecutionDuration = hrTimeMs(process.hrtime(start));

  return { testResults, testExecutionDuration };
};

const runParallelTests = async (registry: Awaited<ReturnType<typeof trigger_dynamic_imports>>['registry'], predicate: ReturnType<typeof parseTestLaunchingArgs>['testPredicate']) => {
  const start = process.hrtime();
  // note establishTestResultsDir is called from launchAutomatedProcessTestsFromRegistryInParallel
  const structuredResults = await launchAutomatedProcessTestsFromRegistryInParallel(registry, predicate);
  return { structuredResults, parallelExecutionDuration: hrTimeMs(process.hrtime(start)) };
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
export const LaunchTests = async (rootPath?: string, launchOpts?: LaunchOptions, args?: string[]) => {
  const testSpecification = parseTestLaunchingArgs(args ?? process.argv.slice(2), rootPath);
  console.error("test launch spec (files, predicate):", testSpecification.files, testSpecification.testPredicate.toString());
  let metricsForEcho: { [k: string]: any } = {};
  let metricsEasyRead = '';

  let testCount: number = 0;
  const default_launch_opts: LaunchOptions = {echo_test_logging: false, expand_test_suites_reporting: true };
  const launch_opts = { ...default_launch_opts, ...launchOpts };
  if (topt(tf.ForceEnableLogging)) { launch_opts.echo_test_logging = true; }
  if (topt(tf.ForceDisableLogging)) { console.assert(!topt(tf.ForceEnableLogging)); launch_opts.echo_test_logging = false; }


  const fileSearchDir = topt(tf.TargetDir);
  // by default we provide no dir to search within for ts/js code to import. In this case, we are self testing this
  // on library, and will not be running from a bundle, so I assume also that __dirname is (tst)/src/build/dispatch. Hence
  // .. added to go to build.
  if (fileSearchDir) {
    console.error('discoverTests: enumerating JavaScript/TypeScript code under the fileSearchDir', fileSearchDir);
  } else {
    throw new Error(`discoverTests: no fileSearchDir specified`);
  }

  if (topt(tf.Parallel) && !topt(tf.Automated)) {
    // === root parallel launch
    // - discover tests as specified by easy test spec protocol
    // - perform scheduling logic
    // - spawn processes launching tests accordingly, awaiting their output (this one has some depth to it... but is
    // mostly transparent at this level whether it is launching locally or on remote nodes.)
    // - collate and record test results and recursive output metrics
    // - render test report
    const { registry, ...discoveryMetrics } = await discoverTests(fileSearchDir, topt(tf.ImportJsOnly), testSpecification.files);
    const { structuredResults, ...parallelLaunchMetrics } = await runParallelTests(registry, testSpecification.testPredicate);
    const { outputResults, distributed_metrics } = processDistributedTestResults(/* (complex types lining up here) */ structuredResults)
    testCount = outputResults.length;
    recordResults(outputResults);
    metricsForEcho = { ...discoveryMetrics, ...parallelLaunchMetrics, distributed_metrics };
    const maxProcessRuntime = Math.max(...distributed_metrics.map(dm => dm.duration));
    metricsEasyRead = `Actual process runtimes\n${distributed_metrics.map(dm => renderVisualPercentageLowerIsBetter(dm.duration, maxProcessRuntime, 20) + ' ' + dm.duration + ' ' + dm.schedule.jobs.map(j => j.testName)).join('\n')}\nExpected runtimes\n${distributed_metrics.map(dm => renderVisualPercentageLowerIsBetter(maxProcessRuntime, dm.schedule.totalExpectedRuntimeMs, 50) + ' ' + dm.schedule.totalExpectedRuntimeMs + ' ' + dm.schedule.jobs.map(j => j.testName)).join('\n')}`;
    processTestResults(outputResults, metricsForEcho);
    renderResults(outputResults, parallelLaunchMetrics.parallelExecutionDuration, launch_opts);
  } else if (!topt(tf.Automated) && !topt(tf.Parallel)) {
    // === launching without any parallelism (to run all in one process) This is a least-complex happy path and also the OG path.
    // - discover tests as specified by easy test spec protocol
    // - run tests
    // - record results and metrics
    // - render test report
    const { registry, ...metrics } = await discoverTests(fileSearchDir, topt(tf.ImportJsOnly), testSpecification.files);
    const { testResults, ...metrics2 } = await runTests(registry, testSpecification.testPredicate, launch_opts);
    // there is a slight change in behavior now that I have test output writing to files broken out, which is if tests
    // fail outside of the runner (e.g. exception in I/O handler) then now we may never write any of the results to
    // disk instead of the ones that already completed.
    testCount = testResults.length;
    recordResults(testResults);
    metricsForEcho = { ...metrics, ...metrics2 };
    processTestResults(testResults, metricsForEcho);
    renderResults(testResults, metrics2.testExecutionDuration, launch_opts);
  } else if (topt(tf.Automated) && topt(tf.Parallel)) {
    // === this is a mid tree node. takes complex (json?) input which specifies a launch schedule.
    // - parse complex launch schedule
    // - spawn processes launching tests accordingly, awaiting their output
    // - recursive automated test run ("medium", possibly recursive complexity) collation takes place here and sent to stdout
    // await dispatchLaunches(testSpecification);
    console.error('UNIMPLEMENTED');
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
  if (launch_opts.web_server) {
    startServer();
  }
};

if (isProgramLaunchContext()) {
  console.error('runner executing file:', __filename);
  // launch tests by discovering them through however it is we find ourselves executing, so we can launch as TS via TSX.
  const launchPath = path.resolve(__dirname, '..');
  console.error('launching via:', launchPath);
  void (LaunchTests)(launchPath);
}

