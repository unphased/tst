// BE AWARE of import related sequencing dangers. Mainly that we cannot define any tests (call the test() registrar) from ... not sure... this file specifically.

import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config.js';
import { e, l } from "../log.js";
import { colors } from './terminal/colors.js';
import { processTestResults } from './analyze-test-results.js';
import { AsyncFunction, TFun, TestMetadata, TestOptions, compatibleFailure, italic, red, testAsyncFnRegistry, testFnRegistry, testParamMaker, ResourceMetricsPerTest } from './index.js';
import { TestAssertionMetrics, TestLogs, clearResults, establishTestResultsDir, getResults, renderHrTimeMs, renderResults, submitResult } from './render-test-results.js';
import { ResourceMonitoringWorkerLaunch } from './resource-monitoring.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// slightly awkward (kind of belongs somewhere else, in fact it is defined in utils) but this test system uses it, so i
// reimplement it here.
const hrTimeMs = (hrTimeDelta: [number, number]) => hrTimeDelta[0] * 1000 + hrTimeDelta[1] / 1000000;

// tLC contains command line set flag values
export type TestLaunchFlagConfig = Partial<typeof testLaunchConfigFlags>;
const testLaunchConfig: TestLaunchFlagConfig = {};

const testLaunchConfigFlags = {
  'PARALLEL': true, // launch automated tests in parellel within processes. Consume results over stdin for processing.
  '_automated_': true, // automated test launches must communicate exclusively through stdout. Skips processing, the
  // parent we report to will handle that. Suitable for launching via ssh etc. Note launching from npm will cause
  // extra garbage at the top, but usually we can handle that as well by emitting json output in a single line.

  // PARALLEL and _automated_ combined occurs on remote nodes, and the effects are combined. it will launch tests in
  // parallel usually on a remote node, receive results from them over stdin, and submit combined results over stdout.
  '_force_disable_test_logging_': true,
  '_print_logs': true, // overrides echo_test_logging config setting being false, forcing it always to be true for the run
};

const parseTestLaunchingArgs = (args?: string[]) => {
  // - first, go from the beginning looking through args in the first group for flags.
  // any that are handled will be removed from further processing.
  // - then, a series of file names implicitly under src/. We filter the modules we will import by this list
  // - after that: a __ separator
  // - lastly, a series of either flags or test suite/name specifiers.
  // flags broadly control behavior, and specifiers are used to target tests.
  // Specifiers are like suite:test where suite and colon are optional, and test name is optional if a suite is
  // specified. TODO possibly enable specifying suite without colon. We can check for that anyhow.

  // Examples of specifiers:
  // suite1:footest suite2: 'test 4'
  
  // initially, these defs are programmatically generated.
  // specifiers are precise by default:
  // after the positional '__' delimiter, all args are treated as specifiers. Each
  // specifier can have any number spaces in it, but colons are used to split suite and name.

  // if no separator is provided then all args will be treated as specifiers. Note it is a double underscore separator
  // and not a double dash as usual, because npm is a piece of shit and eats up double hyphen preventing us from using
  // it. Similarly, flags as mentioned above are not implemented with hyphens due to node trying to eat them up,
  // though TODO we should be able to switch back to regular looking flags and just make use of `--` lol.

  if (args && args.length) {
    let flag: true | undefined;
    while ((flag = testLaunchConfigFlags[args[0]])) {
      testLaunchConfig[args[0]] = flag;
      l("test launch argparse: set", args[0], "to", flag);
      if (flag !== true) {
        throw new Error(`Found a test launch flag (${args[0]}) with value=${flag} of unsupported type=${typeof flag}`);
      }
      args.shift();
    }
  }

  if (!args || !args.length) {
    return { files: [], specifiers: [] };
  }

  const idxSeparator = args.indexOf('__');
  const files = idxSeparator === -1 ? [] : args.slice(0, idxSeparator);
  const specifiers = (idxSeparator === -1 ? args : args.slice(idxSeparator + 1)).map(e => {
    const [s, t] = e.split(':'); return (t !== undefined ? { s, t } : { t: s });
  });
  return { files, specifiers };
}

async function runTestsFromRegistry(testRegistry: Map<TFun | (() => Promise<void>), TestMetadata>, opts? : { filter: { s?: string,  t?: string }[]; } & TestLaunchFlagConfig) {
  const filter = opts?.filter;
  const config = getConfig();
  if (opts?._automated_ && opts?._force_disable_test_logging_) {
    // !!! special override of echo_test_logs to false for automated test runs
    if (config.get('echo_test_logging')) {
      l('Automated runTestsFromRegistry: test logger echo was true from config, and configured to force it to false! (config setting not changed)');
    }
    config.config.echo_test_logging = false
  }
  if (opts?._print_logs && !config.get('echo_test_logging')) {
    l('runTestsFromRegistry: test logger echo was false from config, and configured to force it to true! (config setting not changed)');
    config.config.echo_test_logging = true;
  }

  for (const [testFn, { name, filename: file, suite, stack }] of testRegistry) {
    const asyn = testFn instanceof AsyncFunction;
    if (filter?.length && !filter?.some(f => (f.s ? f.s === suite : true) && (f.t ? f.t === name : true))) {
      continue;
    }
    const startCpuUsage = process.cpuUsage();
    const start = process.hrtime();
    const logs: TestLogs = [];
    const options: TestOptions = {};
    const assertionMetrics: TestAssertionMetrics = {
      logs: {},
      assertionCounts: {},
      assertionFailure: false
    };
    const resourceMetrics: ResourceMetricsPerTest = [];
    const testParam = testParamMaker(config, logs, assertionMetrics, options, resourceMetrics);

    console[opts?._automated_ ? 'error' : 'log'](`${colors.blue}Running ${asyn ? 'async ' : ''}test ${colors.magenta + (asyn ? colors.underline : '') + name + colors.reset}${suite ? " from suite '" + suite + "'" : ''} ${colors.dim + stack + colors.reset}`);
    const testFailureHeader = colors.red + "Failure" + colors.reset + " in test " + colors.red + (suite ? colors.italic + suite + ':' + colors.italic_reset : '') + colors.underline + name + colors.reset;
    try {
      if (asyn) {
        await testFn(testParam);
      } else {
        testFn(testParam);
      }
      const end = process.hrtime(start);
      const cpu = process.cpuUsage(startCpuUsage);
      const finalMemSample = process.memoryUsage(); // this memory value is not the full story but I figure it doesnt hurt to sample it here
      const durationMs = hrTimeMs(end);

      // perform various implicit assertions on the results
      if (!options.exemptFromAsserting && options.assertionCount !== 0 && Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0) === 0) {
        throw new Error("Rejecting test " + red((suite ? italic(suite + ":") : "") + name) + " for not performing any assertions.");
      }
      if (options.assertionCount && Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0) !== options.assertionCount) {
        throw new Error("Rejecting test " + (suite ? suite + ":" : "") + name + ` for performing ${Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0)} assertions, when it reports expecting to perform ${options.assertionCount}.`);
      }

      const should_have_failed = options.fails ? new Error(`Expected test to fail ${options.fails === true ? '' : "with an " + options.fails + " Error "}due to specification of "fails" test option.`) : false;
      if (should_have_failed) { console.error(testFailureHeader, should_have_failed); }
      submitResult({ ...options, durationMs, name, file, stack, suite, logs, assertionMetrics, cpu, finalMemSample, failure: should_have_failed });
    } catch (e) {
      const end = process.hrtime(start);
      const cpu = process.cpuUsage(startCpuUsage);
      const finalMemSample = process.memoryUsage(); // this memory value is not the full story but I figure it doesnt hurt to sample it here
      const durationMs = hrTimeMs(end);
      const err = e as Error;
      !options.fails && console.error(testFailureHeader, err);
      submitResult({ ...options, durationMs, name, file, stack, suite, logs, assertionMetrics, cpu, finalMemSample, failure: options.fails ? compatibleFailure(options.fails, err) : err });
    }
  }
}

// - checking mtime of test-results run dir suffices here but won't in the general case, beware
// - recursion by find must be stopped so as not to fail due to attempting to traverse just-deleted dirs
// - this is a hack to bring multiple dir removals under one process call
export const runTests = async (args?: string[]) => {
  const testSpecification = parseTestLaunchingArgs(args);
  l("runTests: tests to launch, parsed:", testSpecification);

  // putting worker thread self-resource monitoring on the backburner, since it should be equally reliable to launch tests
  // one at a time using my own asyncSpawn /usr/bin/time container and obtain metrics: Will come back and implement
  // this approach as well... later.
  // ResourceMonitoringWorkerLaunch(50);

  // Arg handling for test launching is designed around test discovery approach to improve launch
  // speed.  To specify a specific test or tests you want to run (on a given node) we derive the
  // source file(s) we found these tests in, from the parent runner instance, and then specify them
  // based on the suite and name.

  // console.log("Hi from micro test launcher, I am defined in", __filename);
  // assign for this process call the path (timestamp) of local filesystem test result records

  // no need to await the old log folders cleanup tbh. (that's what awaiting this would do).
  // also, even in automated mode we preserve default behavior of logging to results file on result submission. Note
  // that the results dir timestamp name will not match up (but will be temporally close modulo machine time deltas)
  // TODO actually add into the protocol the time-as-id from the parent so children can use it in these logs.
  establishTestResultsDir();

  clearResults(); // empty local results memory structure so we don't get duplicate data

  const files = fs.readdirSync(path.join(__dirname, '..'), { recursive: true, encoding: 'utf8' }).filter(f => path.resolve(__dirname, "..", f) !== __filename); // filter out self, importing that will break us
  const start = process.hrtime();
  const files_filtered = files
    .filter(f => f.match(/\.[jt]s$/)) // importing non js/ts files will fail -- i got some config json and log files under build
    .filter(f => !f.match(/^instrument\/payload\/|^workers\//))
    // gluing multiple filters into one regex:
    // 1. importing code under instrument/payload (not ever meant to be tested or run here) will break likely due to
    //    browser deps but also pollute global state
    // 2. workers should never be directly imported
    .filter(f => testSpecification.files.length === 0 || testSpecification.files.includes(f)); // apply specified file import filter

  if (!files_filtered.length) {
    e('Zero files remain after filtering. Please confirm... Prior to filtering, the file list was:', files);
  }

  l("runTests: files to actually import:", files_filtered);

  await Promise.all(files_filtered.map(file => import(path.join(__dirname, "..", file)).then(exports => {
      // l("imported", exports, 'from', file);
      for (const [name, fn] of Object.entries(exports)) {
        const asyn = fn instanceof AsyncFunction;
        const got = (asyn ? testAsyncFnRegistry.get(fn as (...args: Parameters<TFun>) => Promise<void>) : testFnRegistry.get(fn as TFun)) as TestMetadata;
        if (typeof fn === 'function' && typeof got === 'object') {
          got.name = name || fn.name;
          if (!got.name) {
            e(`Test function ${fn} from ${file} has no name`);
          }
          got.filename = file;
          // console.error('test tracing runTests():', got);
          // } else {
          // console.log(`The export ${name} from ${file} is not a registered test`);
        }
      }
    }).catch(err => {
      throw new Error(`dynamic import failed on ${file}: ${err}`);
    }))
  );
  const imported = process.hrtime(start);

  // do a helpful check to see if test filters would hit anything
  if (testSpecification.specifiers.length
    && ![ ...testFnRegistry, ...testAsyncFnRegistry ].filter(([_testFn, { name, suite, stack }]) => testSpecification.specifiers.some(f => (f.s ? f.s === suite : true) && (f.t ? f.t === name : true))).length) {
    // not sure if this is the best logic, but when we match nothing... just attempt to reinterpret all specifiers
    // already parsed as tests as suite names.
    testSpecification.specifiers.forEach(e => (e.s = e.t, e.t = ''));
    l('attempted test/suite name swap in test specification due to having specs that match nothing we imported:', testSpecification.specifiers);
  }

  if (testLaunchConfig._automated_) {
    // done from here so we have latest symbols imported. Note file filter would be applied.
    launchAutomatedProcessTestsFromRegistry(new Map<TFun | (() => Promise<void>), TestMetadata>([ ...testFnRegistry, ...testAsyncFnRegistry ]), { ...testLaunchConfig, filter: testSpecification.specifiers });
  } else {
    // sync loop for sync tests
    runTestsFromRegistry(testFnRegistry, { ...testLaunchConfig, filter: testSpecification.specifiers }); // no need to await a loop that will only call sync functions
    await runTestsFromRegistry(testAsyncFnRegistry, { ...testLaunchConfig, filter: testSpecification.specifiers });
  }
  const resultsTime = process.hrtime(start);
  console.error("Global test timing: imports", renderHrTimeMs(imported), "test execution", renderHrTimeMs(resultsTime.map((x, i) => x - imported[i]) as [number, number]));
  if (!testLaunchConfig._automated_) { // since automated children are reporting to parent, they should not perform this processing.
    processTestResults();
  }
};

// note carefully this specific code cannot be factored to a different file, it changes its semantics.
const isProgramLaunchContext = () => {
  return fileURLToPath(import.meta.url) === process.argv[1];
}

isProgramLaunchContext() && (async () => {
  await runTests(process.argv.slice(2));
  // a little unclean but cant put my finger on why right now. But the config will def be set during the first part of runTests().
  if (testLaunchConfig._automated_) {
    // result array promise (rap)
    console.log(JSON.stringify(getResults()));
  } else {
    renderResults();
  }
  console.error("On demand test launch complete.");
})();
// Used to launch tests in processes in headless mode. For now, this receives the tests loaded in after the file filtering is done

export async function launchAutomatedProcessTestsFromRegistry(
  testRegistry: Map<TFun | (() => Promise<void>), TestMetadata>,
  opts?: { filter?: { s?: string; t?: string; }[]; } & TestLaunchFlagConfig) {
  // not sure how we want to do this eventually, but starting out with local launch and then spreading to other nodes over SSH should be solid
  // when we have a remote node, we assume the repo is already present and synchronized starting from the initial run.
  // Subsequently we trace and transfer only the deltas that have changed for each new run.
  // All of this will be confirmed and maintained by the processing step.
  // for now, launch the tests locally to realize 20x speed gain!
  // also for now, utilize gnu parallel to do the process launching. Even on remote nodes.
  // first collect launch metrics from persisted test context about the tests we are told to run. any new/renamed ones
  // wont be matches and we can just assume they will take the median amaount of time to run.
  // use values that we provide in config for better establishing metrics, such as time it takes to go from remote
  // trigger initiation to initial test launch. So this could be assigned per machine. TODO eventually these can be
  // automatically determined.
  // estimate their total runtime by estimating CPU consumption (multiply cpu usage by time). This will amortize
  // effectively once there are enough tests.
  // determine how much benefit there will be had for more than one node and see if they are already online, and plan
  // accordingly (e.g. factor in added time of node startup in planning).
  // const parallel_launch_cmd = `parallel ${}`
  // launch the tests in parallel, using stderr to get a concurrent preview (it will be a bit jumbled but still serves
  // a nice way to see progress)
  // spawnAsync("", );
}

