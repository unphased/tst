import { dirname } from 'path';
import { format } from 'ts-utils';
import { fileURLToPath } from 'url';
import { assertions } from './assertions.js';
import { LaunchOptions } from './config/launchOptions.js';
import { PlotData } from './plotting/index.js';
import { plotters } from "./plotting/plotters_index.js";
import { SpawnAsyncOpts, SpawnAsyncTestLogTraced, isBypassResourceMetrics, spawnAsync } from './process.js';
import { Embeds, ResourceMetrics, TestAssertionMetrics, TestLogs, TestOptions } from "./types.js";
import { TestMetadata } from './types.js';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

// note carefully this specific code cannot be factored to a different file, as that would change its semantics.
const isProgramLaunchContext = () => {
  // this cjs launch detection impl will need to change if we change compilation to target modules
  return fileURLToPath(import.meta.url) === process.argv[1];
}

// used for instanceof check.
export const AsyncFunction = (async () => {}).constructor;

// wrap assertion logic with call counting and logging
const augmentedAssertions = (assertionMetrics: TestAssertionMetrics, options: TestOptions) => {
  const ret = {} as typeof assertions; // returning same shape as our collection of assertions.
  for (const [name, fn] of Object.entries(assertions) as [keyof typeof assertions, (...args: any[]) => void][]) {
    const asyn = fn instanceof AsyncFunction;
    let amln = assertionMetrics.logs[name];
    const loggerbody = (args_: any[]) => {
      if (!amln) amln = assertionMetrics.logs[name] = { buffer: [] };
      if (options.ringBufferLimitAssertionLogs !== undefined && (amln.ringBufferOffset === undefined || amln.buffer.length !== options.ringBufferLimitAssertionLogs)) {
        console.error('ring buffer limit changed to', options.ringBufferLimitAssertionLogs, 'from', amln.buffer.length)
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
      const value: [[number, number], string] = [process.hrtime(), JSON.stringify(args_)];
      if (typeof amln.ringBufferOffset === 'number') {
        amln.buffer[amln.ringBufferOffset++] = value;
        amln.ringBufferOffset %= amln.buffer.length;
      } else {
        amln.buffer.push(value);
      }
      const aa = assertionMetrics.assertionCounts;
      aa[name] = (aa[name] || 0) + 1;
    }
    if (asyn) {
      ret[name] = async (...args) => {
        loggerbody(args);
        try {
          await fn(...args);
        } catch (e) {
          // record failures
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }
    } else {
      ret[name] = (...args) => {
        loggerbody(args);
        try {
          fn(...args);
        } catch (e) {
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }
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

const htmlPlotBuilderEmbedder = (embeds: Embeds) => (plotType: keyof typeof plotters, plots: PlotData[], group_id?: string) => {
  embeds.push({ ...(plotters[plotType](plots)), group_id: group_id ?? '' });
  return plots; // for chainability which can often be handy
};

// produces interface with which to define a test accessed through param of test function
export const testParamMaker = (config: LaunchOptions, logs: TestLogs, assertionMetrics: TestAssertionMetrics, options: TestOptions, resourceMetrics: ResourceMetrics, embeds: Embeds) => {
  const logger = (...x: any[]) => {
    const formatted = format(...x);
    logs.push([process.hrtime(), formatted]);
    config.echo_test_logging && console.error(process.hrtime(), formatted);
  };

  return {
    // the logger you must use from a test
    l: logger,
    // Test option setter. Is the name too terse? We'll find out later.
    // This design makes it possible to colocate test specific configuration to the test itself, which should aid readability
    t: function setTestOption<K extends keyof TestOptions>(key: K, value: TestOptions[K]): void {
      options[key] = value;
      // behaviors to configure test functionality in response to configs being set will be performed here synchronously
    },
    // assertions accessed through here
    a: augmentedAssertions(assertionMetrics, options),
    // obtains metrics and logs from the currently executing test in a read only way, so you can make assertions on the
    // assertions or logging your test already did, which may be helpful for black box testing among other things.
    m: metricsCopyMaker(assertionMetrics, logs),
    // spawnAsync for use by test, allows for simple resource tracking implementation
    spawn: asyncSpawnTestTracedMaker(resourceMetrics, logger),
    // html embed consumer for plots etc. When no disjoint groups are specified they get combined into a single page.
    p: htmlPlotBuilderEmbedder(embeds),
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
export function parseFileLineColFromStackLineMakeHyperlink(stack_line?: string) {
  // stacks are already being rendered as file urls in ESM. We just need to inject a hostname into it.
  const fileURL = stack_line.match(/file:\/\/.*.[tj]s:\d+:\d+/)[0]; // strip the leading "   at "
  if (!fileURL) return 'Failure to resolve location assuming file url from stack!';
  const fileURLWithHostname = fileURL.replace('file://', 'file://' + os.hostname());
  const content = stack_line?.match(/[^/]+\/[^/]+\.[tj]s:\d+:\d+/)?.[0];
  const final_hyperlink = `\u001b]8;;${fileURLWithHostname}\u001b\\${content}\u001b]8;;\u001b\\`;
  console.error('final_hyperlink', final_hyperlink, JSON.stringify(final_hyperlink));
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
