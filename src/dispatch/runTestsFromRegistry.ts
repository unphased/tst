import { getConfig } from '../../config/instrumenterRuntimeConfig.js';
import { l } from "../../log.js";
import { colors } from '../../terminal/colors.js';
import { hrTimeMs, italic, pp, red } from "../../utils.js";
import { AsyncFunction, TFun, TestMetadata, testParamMaker } from '../index.js';
import { Embeds, ErrorSpec, ResourceMetrics, TestAssertionMetrics, TestLogs, TestOptions, TestResult } from '../types.js';
import { tf, topt } from './util.js';

// note carefully that the parallel async flag will cause only async tests to launch in parallel (queued for after sync
// cb's run), and it's liable to wreak havoc on measured test runtimes. So, when those metrics matter at all, this is
// the wrong feature to use. It's in here because it's interesting as a quirky way to launch the tests to glean
// information about performance (albeit hard to interpret), and possibly very mildly help catch really weird bugs.
export async function runTestsFromRegistry(testRegistry: Map<TFun | ((...args: Parameters<TFun>) => Promise<void>), TestMetadata>, predicate: (t: TestMetadata) => boolean, parallel_async?: boolean) {
  const globalConfig = getConfig();
  if (topt(tf.ForceDisableLogging)) {
    if (globalConfig.get('echo_test_logging')) {
      l('Automated runTestsFromRegistry: test logger echo was true from config, and configured to force it to false! (config setting not changed)');
    }
    globalConfig.config.echo_test_logging = false;
  }
  if (topt(tf.ForceEnableLogging) && !globalConfig.get('echo_test_logging')) {
    l('runTestsFromRegistry: test logger echo was false from config, and configured to force it to true! (config setting not changed)');
    globalConfig.config.echo_test_logging = true;
  }

  const promList: Promise<TestResult>[] = [];

  // TODO possibly refactor this to a direct implementation with a Promise and calling resolve and reject under the
  // different conditions. may be more efficient and not significantly worse in readability.
  async function launchTest(
    testFn: TFun | ((...args: Parameters<TFun>) => Promise<void>),
    suite: string | undefined,
    name: string,
    file: string,
    stack: string
  ): Promise<TestResult> {
    const asyn = isAsyncVoidTFun(testFn);
    const startCpuUsage = process.cpuUsage();
    const logs: TestLogs = [];
    const options: TestOptions = {};
    const assertionMetrics: TestAssertionMetrics = {
      logs: {},
      assertionCounts: {},
      assertionFailure: false
    };
    const resourceMetrics: ResourceMetrics = [];
    const embeds: Embeds = [];
    const testParam = testParamMaker(globalConfig, logs, assertionMetrics, options, resourceMetrics, embeds);

    console[topt(tf.Automated) ? 'error' : 'log'](`${colors.blue}Running ${asyn ? 'async ' : ''}test ${magenta(asyn ? ul(name) : name)}${suite ? ` from suite '${suite}'` : ''} ${colors.dim + stack + colors.bold_reset}`);
    const testFailureHeader = `${colors.red}Failure${colors.fg_reset} in test ${colors.red}${suite ? italic(suite + ':') : ''}${ul(name)}${colors.fg_reset}`;
    const start = process.hrtime();
    try {
      if (isAsyncVoidTFun(testFn)) {
        await testFn(testParam);
      } else {
        testFn(testParam);
      }
      const end = process.hrtime(start);
      const cpu = process.cpuUsage(startCpuUsage);
      const finalMemSample = process.memoryUsage.rss(); // this memory value is not the full story but I figure it doesnt hurt to sample it here
      const durationMs = hrTimeMs(end);

      // perform various implicit assertions on the results
      if (!options.exemptFromAsserting && options.assertionCount !== 0 && Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0) === 0) {
        throw new Error(`Rejecting test ${red((suite ? italic(`${suite}:`) : "") + name)} for not performing any assertions.`);
      }
      if (options.assertionCount && Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0) !== options.assertionCount) {
        throw new Error(`Rejecting test ${suite ? `${suite}:` : ""}${name} for performing ${Object.values(assertionMetrics.assertionCounts).reduce((a, b) => a + b, 0)} assertions, when it reports expecting to perform ${options.assertionCount}.`);
      }

      const should_have_failed = options.fails ? new Error(`Expected test to fail ${options.fails === true ? '' : `with an ${renderErrorSpec(options.fails)} Error `}due to specification of "fails" test option.`) : false;
      if (should_have_failed) { console.error(testFailureHeader, should_have_failed); }
      return { ...options, durationMs, name, async: asyn, file, stack, suite, logs, assertionMetrics, resourceMetrics, cpu, finalMemSample, embeds, failure: should_have_failed };
    } catch (e) {
      const end = process.hrtime(start);
      const cpu = process.cpuUsage(startCpuUsage);
      const finalMemSample = process.memoryUsage.rss(); // this memory value is not the full story but I figure it doesnt hurt to sample it here
      const durationMs = hrTimeMs(end);
      const err = e as Error;
      !options.fails && console.error(testFailureHeader, err);
      return { ...options, durationMs, name, async: asyn, file, stack, suite, logs, assertionMetrics, resourceMetrics, cpu, finalMemSample, embeds, failure: options.fails ? compatibleFailure(options.fails, err) : err };
    }
  }

  const resultCollection: TestResult[] = [];
  for (const [testFn, meta] of testRegistry) {
    const { name, filename, suite, stack } = meta;
    if (!predicate(meta)) {
      l(`Skipping test ${suite ? `${suite}:` : ""}${name} due to filter.`);
      continue;
    }
    if (parallel_async && isAsyncVoidTFun(testFn)) {
      promList.push(launchTest(testFn, suite, name, filename, stack));
    } else {
      resultCollection.push(await launchTest(testFn, suite, name, filename, stack));
    }
  }
  if (promList.length) {
    const res = await Promise.all(promList);
    resultCollection.push(...(res));
  }
  return resultCollection;
}

// returns false (indicating a test result of pass when we confirm a compatible failure, yeah i know it's confusing) if matching,
// and a meta-error indicating mismatched errors otherwise.
const compatibleFailure = (spec_err: ErrorSpec, err: Error) => {
  let compatible = false;
  if (spec_err === true) { compatible = !!err; }
  else if (typeof spec_err === 'string') { compatible = err.message.includes(spec_err); }
  else if (spec_err instanceof RegExp) { compatible = spec_err.test(err.message); }
  else if (Array.isArray(spec_err)) { compatible = spec_err.some(e => compatibleFailure(e, err)); }

  if (compatible) return false;
  return Error(`Test failed as expected, but with an incompatible error: ${pp(err)} does not match error spec ${pp(spec_err)}`);
};

const renderErrorSpec = (fails: ErrorSpec) => Array.isArray(fails) ? `one of [${fails.map(renderErrorSpec).join(', ')}]` : fails instanceof RegExp ? `matching ${red(fails.toString())}` : `'${fails}'`;
// type guard, a really sloppy one, only use with known TFun's.

export function isAsyncVoidTFun(func: any): func is (...args: Parameters<TFun>) => Promise<void> {
  return func instanceof AsyncFunction;
}
export const ul = (str: string) => colors.underline + str + colors.underline_reset;
export const magenta = (str: string) => colors.magenta + str + colors.fg_reset;

