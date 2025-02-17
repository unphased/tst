import { dirname } from 'path';
import { format, format_opt } from 'ts-utils/node/format';
import { fileURLToPath } from 'url';
import { assertions } from './assertions.js';
import { LaunchOptions } from './config/launchOptions.js';
import { plotters } from "./plotting/plotters_index.js";
import { SpawnAsyncOpts, SpawnAsyncTestLogTraced, isBypassResourceMetrics, spawnAsync } from './process.js';
import { CleanupHandlers, Embeds, OverloadParams, ResourceMetrics, TestAssertionMetrics, TestLogs, TestMetadata, TestOptions } from "./types.js";

import * as os from 'node:os';
import * as stream from 'node:stream';
import * as zlib from 'node:zlib';
import { Simplify } from 'type-fest';

const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

// note carefully this specific code cannot be factored to a different file, as that would change its semantics.
const isProgramLaunchContext = () => {
  // this cjs launch detection impl will need to change if we change compilation to target modules
  return fileURLToPath(import.meta.url) === process.argv[1];
}

// used for instanceof check.
export const AsyncFunction = (async () => {}).constructor;

// type guard for async function
export const isAsyncFunction = (fn: any): fn is (...args: any[]) => Promise<any> => {
  return fn instanceof AsyncFunction;
};

// wrap assertion logic with call counting and logging
const augmentedAssertions = (assertionMetrics: TestAssertionMetrics, options: TestOptions): typeof assertions => {
  const ret = {} as typeof assertions; // returning same shape as our collection of assertions.
  for (const [name, fn] of Object.entries(assertions) as [keyof typeof assertions, any][]) {
    const asyn = isAsyncFunction(fn);
    let amln = assertionMetrics.logs[name];
    const logging_code_block = (args_: any[]) => {
      if (!amln)
        amln = assertionMetrics.logs[name] = {
          buffer: Array(options.ringBufferLimitAssertionLogs),
          ringBufferOffset: options.ringBufferLimitAssertionLogs ? 0 : undefined,
          // compressed_stream: zlib.createBrotliCompress({params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 3}})
        };
      if (options.ringBufferLimitAssertionLogs && (amln.ringBufferOffset === undefined || amln.buffer.length !== options.ringBufferLimitAssertionLogs)) {
        console.error('ring buffer size changing to', options.ringBufferLimitAssertionLogs, 'from', amln.buffer.length)
        // Here is latch condition to convert to ring buffer (TODO make it correct for the updating ring buffer size case...)
        if (options.ringBufferLimitAssertionLogs < amln.buffer.length) { // shorten to target ringbuf size
          amln.buffer = amln.buffer.slice(-options.ringBufferLimitAssertionLogs);
          amln.ringBufferOffset = 0;
        } else if (options.ringBufferLimitAssertionLogs === amln.buffer.length) {
          amln.ringBufferOffset = 0;
        } else {
          amln.ringBufferOffset = amln.buffer.length;
          amln.buffer.length = options.ringBufferLimitAssertionLogs; // leaves holes in array. should be fine.
        }
      }
      const value = JSON.stringify([process.hrtime(), args_]);
      if (typeof amln.ringBufferOffset === 'number') {
        amln.buffer[amln.ringBufferOffset++] = value;
        amln.ringBufferOffset %= amln.buffer.length;
      } else {
        // amln.compressed_stream.write(value + '\n');
        amln.buffer.push(value);
      }
      const aa = assertionMetrics.assertionCounts;
      aa[name] = (aa[name] || 0) + 1;
    }
    if (asyn) {
      ret[name] = ((async (...args) => {
        logging_code_block(args);
        try {
          await fn(...args);
        } catch (e) {
          // record failures
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }) as any);
    } else {
      ret[name] = (((...args) => {
        logging_code_block(args);
        try {
          fn(...args);
        } catch (e) {
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }) as any);
    }
  }
  return ret;
};

const metricsCopyMaker = (assertionMetrics: TestAssertionMetrics, logs: TestLogs) => {
  return () => ({
    logs: logs.slice(),
    assertionMetrics: JSON.parse(JSON.stringify(assertionMetrics)) as TestAssertionMetrics,
  });
};

const asyncSpawnTestTracedMaker = (resourceMetrics: ResourceMetrics, logger: (...args: any[]) => void) => {
  return (async (command: string, args: string[], options?: SpawnAsyncOpts) => {
    if (options && isBypassResourceMetrics(options)) {
      const ret = await spawnAsync(command, args, logger, options);
      resourceMetrics.push({ command: [command, ...args], return: ret });
      return ret;
    }
    const ret = await spawnAsync(command, args, logger, options);
    const { resources } = ret;
    resourceMetrics.push({ resources, command: [command, ...args], return: ret });
    return ret;
  }) as SpawnAsyncTestLogTraced;
};

const htmlPlotBuilderEmbedder = (embeds: Embeds) => {
  const counterWrapper = { counter: 0 };
  return <T extends keyof typeof plotters>(plotType: T, plots: OverloadParams<typeof plotters[T]>[0], group_id?: string) => {
    const embed_or_page = plotters[plotType](plots as any) // TODO unravel this any. fun puzzle.
    embeds.push({ ...embed_or_page, group_id: group_id ?? ((counterWrapper.counter++).toString() || '')});
    return plots; // for chainability which can often be handy
  };
}

// produces interface with which to define a test accessed through param of test function
export const testParamMaker = (config: LaunchOptions, logs: TestLogs, assertionMetrics: TestAssertionMetrics, options: TestOptions, resourceMetrics: ResourceMetrics, embeds: Embeds, cleanupHandlers: CleanupHandlers) => {
  function logger_with_opts(x:any[], opts?: Parameters<typeof format_opt>[1]) {
    const formatted = format_opt(x, opts);
    const t = process.hrtime();
    logs.push([t, formatted]);
    config.echo_test_logging && console.log(t, formatted);
  }
  function logger(...x: any[]) {
    logger_with_opts(x);
  }

  // this is verbatim from type-fest.
  type ConditionalKeys<Base, Condition> = NonNullable<{
    // Map through all the keys of the given base type.
    [Key in keyof Base]:
    // Pick only keys with types extending the given `Condition` type.
    Base[Key] extends Condition
    // Retain this key since the condition passes.
        ? Key
    // Discard this key since the condition fails.
        : never;
  }[keyof Base]>;
  type BoolTestOptionsKeys = ConditionalKeys<TestOptions, boolean>;

  function setTestOption<K extends BoolTestOptionsKeys>(key: K): void;
  function setTestOption<K extends keyof TestOptions>(key: K, value: TestOptions[K]): void;
  function setTestOption<K extends keyof TestOptions>(key: K, value?: TestOptions[K]): void {
    options[key] = (value === undefined ? true : value) as TestOptions[K];
    // behaviors to configure test functionality in response to configs being set will be performed here synchronously
    // (but don't, may violate principle of least surprise)
  }

  return {
    /**
     * Main logger - logs to test output with timestamp. Auto-inserts spaces between arguments and newline at end.
     * @example l('Starting process', process.pid)
     */
    l: logger,
    /**
     * Low-level logger - same as `l` but accepts formatting options
     * @param opts Formatting options (see ts-utils/format)
     */
    lo: logger_with_opts,
    /**
     * Test option setter - configure test parameters like timeouts, buffers, etc.
     * @example t('ringBufferLimitAssertionLogs', 1000) // Keep last 1k assertion logs
     */
    t: setTestOption,
    /**
     * Assertions collection - contains all assertion methods (eq, lt, includes, etc.)
     * @type {typeof assertions}
     * @example a.eq(1+1, 2), a.lt(performance.now(), 1000)
     */
    a: augmentedAssertions(assertionMetrics, options),
    /**
     * Metrics snapshot - get current test metrics/logs for making meta-assertions
     * @returns Frozen copy of current test state
     */
    m: metricsCopyMaker(assertionMetrics, logs),
    /**
     * Process spawner - launches subprocesses with resource tracking
     * @returns Promise with process results + resource usage
     */
    spawn: asyncSpawnTestTracedMaker(resourceMetrics, logger),
    /**
     * Plot builder - creates visual embeddings for HTML reports
     * @param plotType Type of plot from plotters registry
     * @param data Data to visualize
     * @param group_id Optional group ID for organizing multiple plots
     */
    plot: htmlPlotBuilderEmbedder(embeds),
    /**
     * Failure cleanup registry - add cleanup handlers that only run if test fails
     * @param fn Cleanup function to register
     */
    failure_cleanup: (fn: () => void) => { 
      cleanupHandlers.failedCleanupHandlers.push(fn);
    },
    // cleanup fn, something that will run at end of test as long as test execution reaches this point. So the
    // convention is to put this immediately before or after the creation of whatever resource this is cleaning up!
    cleanup: (fn: () => void) => { // on cleanup handler, always runs
      cleanupHandlers.alwaysCleanupHandlers.push(fn);
    }
  }
}

export type TFun = (params: ReturnType<typeof testParamMaker>) => void;
export const testFnRegistry = new Map<TFun | ((...args: Parameters<TFun>) => Promise<void>), TestMetadata>();

// Test registration interface. Handles argument sugaring with the following two degrees of freedom:
// - First arg can be a suite name
// - Last arg can be an options object
//
// Examples of intended call schemes, mirrored by the exported overloads:
// - export const name_of_test = test('name of test suite', () => { ... })
// - export const name_of_test = test('name of test suite', async () => { ... })
// - exoprt const name_of_test = test(() => { ... })
// - exoprt const name_of_test = test(async () => { ... })
// - export const name_of_test = test(['name of test suite',] [async] () => { ... }, { timeout: 1000, priority: 1, etc. })

// This currently just gives the containing dir and the file name, which is a good simple holding pattern here.
// Not sure if we even need anything further refined, because this emits a terminal hyperlink that has the completely
// full file in a url.
let incrementingHyperlinkId = 0
export function parseFileLineColFromStackLineMakeHyperlink(stack_line?: string) {
  // stacks are already being rendered as file urls in ESM. We just need to inject a hostname into it.
  // console.error('pFLCFSLMH', stack_line);
  const m = stack_line.match(/at\s+(?:async\s+)?(?:[\w<>.]+\s+)?\((?:file:\/\/)?(.*)\)|at\s+file:\/\/(.*)$|at\s+([-\w/.]+:\d+:\d+)$/);
  // TODO: This regex is now unmaintainable so possibly we need to share code with the unit test...
  if (!m) {
    console.error('stack:', format(stack_line));
    throw new Error('Failure to parse stack line for file location!');
  }
  const filePath = m[1] || m[2] || m[3];
  if (!filePath) return 'Failure to resolve location assuming file url from stack!';
  const fileURLWithHostname = 'file://' + os.hostname() + filePath;
  const content = stack_line?.match(/[^/]+\/[^/]+\.[tj]s:\d+:\d+/)?.[0];
  const final_hyperlink = `\u001b]8;id=${incrementingHyperlinkId++};${fileURLWithHostname}\u001b\\${content}\u001b]8;;\u001b\\`;
  // console.error('final_hyperlink', final_hyperlink, JSON.stringify(final_hyperlink));
  return content ? final_hyperlink : 'Failure to resolve code location content!';
}

type TFunOrAsync = TFun | ((...a: Parameters<TFun>) => Promise<void>);

export function test(suite: string, fn: TFunOrAsync, opts?: TestOptions): TFun;
export function test(fn: TFunOrAsync, opts?: TestOptions): TFun;
export function test(fn_or_suite_name: (TFunOrAsync) | string, fn_or_opts?: (TFunOrAsync | TestOptions), opts?: TestOptions) {
  const suite = typeof fn_or_suite_name === 'string' && fn_or_suite_name;
  let func: TFunOrAsync | undefined;
  let meta_assembly: Record<string, any> = { stack: parseFileLineColFromStackLineMakeHyperlink(new Error().stack?.split('\n')[2]) };
  if (suite) {
    if (!fn_or_opts || typeof fn_or_opts !== 'function') {
      throw new Error(`A test suite name (${suite}) was provided without a test function. Got a second arg of type ${typeof fn_or_opts}.`);
    }
    func = fn_or_opts;
    meta_assembly = { ...meta_assembly, suite: fn_or_suite_name, ...opts };
  } else {
    func = fn_or_suite_name as TFun;
    meta_assembly = { ...meta_assembly, ...opts };
  }
  // console.error('test tracing test():', meta_assembly);
  testFnRegistry.set(func, meta_assembly as TestMetadata);
  return func;
}

export { diffOfStrings } from './assertions.js';
export { ProcessError, execAsync, spawnAsync, stdoutColorizer } from './process.js';

