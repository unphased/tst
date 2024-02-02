import * as fs from 'fs';
import * as util from 'util';
import { resolve, join, dirname } from 'path';
import { tmpdir } from 'os';
import { colors } from './terminal/colors.js';
import { SpawnSyncReturns, execSync } from 'child_process';
import { TestAssertionMetrics, TestLogs } from './render-test-results.js';
import { getConfig } from './config.js';
import { fileURLToPath } from 'url';
import { SpawnResourceReport, spawnAsync, SpawnAsyncOpts } from './process.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// note carefully this specific code cannot be factored to a different file, as that would change its semantics.
const isProgramLaunchContext = () => {
  // this cjs launch detection impl will need to change if we change compilation to target modules
  return fileURLToPath(import.meta.url) === process.argv[1];
}

// used for instanceof check.
export const AsyncFunction = (async e => e).constructor;

// TODO: Have a mode that uses git (???) to work out an initial heuristic to use for displaying the tests that have
// been touched in the last X hours. This is probably even more streamlined than providing a manual control around
// which tests to enable autorun for.

// TODO Also consider schlepping this ring buffer contents after a run of a test, into a test 'ephemeris' file. This can be
// pulled up on demand and great for sanity checking even passing tests alongside any logging.
// TODO reconcile pp with format()
export const pp = (x: any) => colors.dark_grey_bg + (Buffer.isBuffer(x) ? x.toString('utf8') : (typeof x === 'string' ? x : util.inspect(x, { colors: true, depth: Infinity, compact: true }))) + colors.bg_reset;
export const red = (s: string) => colors.red + s + colors.fg_reset;
export const bold = (s: string) => colors.bold + s + colors.bold_reset;
export const italic = (s: string) => colors.italic + s + colors.italic_reset;

export const diffOfStrings = (a: string, b: string) => {
  // load the strings into unique tmpfiles
  const random = Math.random().toString(36).slice(2);
  const tempFileA = join(tmpdir(), random + 'nucleusDiffTempA.txt');
  const tempFileB = join(tmpdir(), random + 'nucleusDiffTempB.txt');

  fs.writeFileSync(tempFileA, a);
  fs.writeFileSync(tempFileB, b);
  try {
    // TODO sift wont be available in the general case
    const ret = execSync(`sift ${tempFileA} ${tempFileB}`);
    return ret;
  } catch (e) {
    const err = e as SpawnSyncReturns<Buffer>;
    console.log(err.stdout.toString('utf8'));
  } finally {
    fs.unlinkSync(tempFileA);
    fs.unlinkSync(tempFileB);
  }
}

// works for arrays as well. But arrays will check length since thats too easy to miss accidentally.
function isSubsetObject(subset, object) {
  // Check if both are objects
  if (typeof subset !== 'object' || typeof object !== 'object' || subset === null || object === null) {
    // TODO prolly have some holes here
    return false;
  }
  for (const key in subset) {
    // Ensure the key exists in the object
    if (!(key in object)) {
      return false;
    }
    // If the value is an object, recurse, else compare values
    if (typeof subset[key] === 'object' && subset[key] !== null) {
      if (!isSubsetObject(subset[key], object[key])) return false;
    }
    else if (subset[key] !== object[key]) {
      return false;
    }
  }
  if (Array.isArray(subset) && Array.isArray(object) && subset.length !== object.length) {
    return false;
  }
  return true;
}

// sliding window subsequence tester. This approach to implementation turns out the most efficient
export function findContiguousSubsequenceSlidingWindow<T>(needle: T[], haystack: T[]): false | number {
  if (needle.length === 0) return false;
  if (haystack.length < needle.length) return false;

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let foundMatch = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        foundMatch = false;
        break;
      }
    }
    if (foundMatch) {
      return i;
    }
  }
  return false;
}

// used to assert the amount of times some code got triggered
// export const Nce = (n: number, cb: () => void) => { }

// export const once = (cb: () => void) => { Nce(1, cb); }

const assertions = {
  eq: <T>(a: T, b: T, ...message: any[]) => {
    if (a !== undefined && b === undefined) throw new Error(red(bold(italic('eq')) + ' was called with undefined second arg, please confirm...')); 
    if (a !== b) throw new Error(red(bold(italic('eq')) + ' expected ') + pp(a) + red(' to equal ') + pp(b) + ': ' + format(...message));
  },
  lt: (a: number, b: number) => {
    if (a >= b) throw new Error(red(bold(italic('lt')) + ' expected ') + pp(a) + red(' to be less than ') + pp(b) + red('.'));
  },
  gt: (a: number, b: number) => {
    if (a <= b) throw new Error(red(bold(italic('gt')) + ' expected ') + pp(a) + red(' to be greater than ') + pp(b) + red('.'));
  },
  eqO: (a: any, b: any) => {
    const aa = JSON.stringify(a);
    const bb = JSON.stringify(b);
    if (aa !== bb) throw new Error(red(bold(italic('eqO')) + ' expected ') + pp(a) + red(' to equal ') + pp(b) + red('.') + ' Delta: ' + diffOfStrings(aa, bb));
  },
  includes: (a: any[], spec: any) => {
    if (!a) throw new Error(red(bold(italic('includes')) + ' expected ') + pp(a) + red(" to include ") + pp(spec));
    if (spec instanceof RegExp) {
      if (!a.some(e => spec.test(e))) {
        throw new Error(red(bold(italic('includes')) + " expected ") + pp(a) + red(" to include a match for ") + pp(spec) + red(" by performing regex tests."));
      }
    } else if (!a.includes(spec)) {
      throw new Error(red(bold(italic('includes')) + " expected ") + pp(a) + red(" to include ") + pp(spec));
    }
  },
  includesO: (a: any, spec: any) => {
    const v = isSubsetObject(spec, a);
    if (!v) throw new Error(red(bold(italic('includesO')) + ' expected ') + pp(a) + red(' to include ') + pp(spec));
  },
  match: (v: any, spec: RegExp) => {
    if (!spec.test(v)) throw new Error(red(bold(italic('match')) + ' expected ') + pp(v) + red(` to match ${pp(spec)}.`));
  },
  is: (v: any) => {
    if (!v) throw new Error(red(bold(italic('is')) + ' expected ') + pp(v) + red(` to be truthy.`));
  },
  subseq: <T>(a: T[], spec: T[]) => {
    if (false === findContiguousSubsequenceSlidingWindow(spec, a)) {
      throw new Error(red(bold(italic('subseq')) + " expected ") + pp(a) + red(" to include ") + pp(spec) + red(" as a contiguous subsequence."));
    }
  },
  throws: (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return;
    }
    throw new Error(red(bold(italic('throws')) + " expected ") + fn.toString().split('\n').map(l => colors.dark_grey_bg + l + colors.bg_reset).join('\n') + red(" to throw!"));
  },
  throwsA: async (fnA: () => Promise<void>, expected_message?: string | string[]) => {
    try {
      await fnA();
    } catch (e: any) {
      if (expected_message) {
        if (typeof expected_message === 'string') {
          if (!(e.message || e).includes(expected_message)) {
            throw new Error(`expected error message or thrown string to include "${expected_message}", but got "${e}" instead.`);
          }
        } else if (Array.isArray(expected_message)) {
          if (!expected_message.some(m => (e.message || e).includes(m))) {
            throw new Error(`expected error message or thrown string to include one of "${pp(expected_message)}", but got "${e}" instead.`);
          }
        }
      }
      return;
    }
    throw new Error(red(bold(italic('throwsA')) + " expected ") + fnA.toString().split('\n').map(l => colors.dark_grey_bg + l + colors.bg_reset).join('\n') + red(" to throw!"));
  }
}
export type AssertionName = keyof typeof assertions;

// test params wrap everything needed; this is the best way to keep test-specific state tracking impl simple, and 
// also keeps imports simple, as well as aiding test helper method discovery. Assertions are moved here to keep the
// interface uniform but also to inject logging for them!

// Config (the subset that doesnt need to be specified prior to test launch) is also provided as an interface here, 
// time will tell if this is a mistake... it certainly is insane. 

export type TestOptionsInitial = { // these are the test options that affect the scheduling/launch of tests. So far empty
};

// these are the options that can be set during text execution, ideally near the beginning, which can either be:
// - adequately responded to immediately once they are set (e.g. conversion from regular log buffering into ring buffering), or
// - persisted to test context so that the information can be leveraged in future executions without being a big
// problem (e.g. priority)

type ErrorSpec = true | RegExp | string | (string | RegExp)[];

export type TestOptions = {
  /* NOT IMPLEMENTED YET */ timeout?: number,
  /* NOT IMPLEMENTED YET */ priority?: number, // higher priority tests run first
  /* NOT IMPLEMENTED sequential?: boolean, */ // if async test, serialize its execution (usually for quickly preventing its prints from getting interlaced)??? I should be able to design around this ever being a concern
  /* IMPL IN TESTING */ ringBufferLimitAssertionLogs?: number,
  // size limit to apply for ring buffer log storage. Maybe if this isn't set these will not use ring buffers and need
  // to store everything? Seems like a sane default. When i have a use case hitting limits, i can decide then if i want
  // to implement with streams (probably yes just for the cool factor). But I already know that ring buffer as an
  // option will be great for many of my test approaches.
  /* NOT IMPL YET */ ringBufferLimitLogs?: number,
  exemptFromAsserting?: boolean, // do not treat as failure if no assertions are made in the test.
  fails?: ErrorSpec, // invert the result. This is used to test intentionally failing (e.g. validating test machinery).
  assertionCount?: number, // expected number of assertion calls including final failed ones. Will be implicitly checked as a final assertion.
  /* NOT IMPL YET */ maxRSS?: number, // max resident set size in bytes. If test execution exceeds this threshold, test will fail.
  /* NOT IMPL YET */ maxUserCPUSecs?: number, // max user CPU seconds. If test execution exceeds this threshold, test will fail.
  /* NOT IMPL YET */ maxSysCPUSecs?: number, // max system CPU seconds. If test execution exceeds this threshold, test will fail.
};

const format = (...x: any[]) => x.map(item => Buffer.isBuffer(item) ?
  colors.blue + item.toString('utf8') + colors.fg_reset :
    typeof item === 'string' ?
    item.includes('\x1b') ? item : colors.green + item + colors.fg_reset
    : util.inspect(item, { depth: 7, colors: true })
).join(' ');

// wrap assertion logic with call counting and logging
const augmentedAssertions = (assertionMetrics: TestAssertionMetrics, options: TestOptions) => {
  const ret = {} as any; // returning same shape as our collection of assertions.
  for (const [name, fn] of Object.entries(assertions)) {
    const asyn = fn instanceof AsyncFunction;
    const amln = assertionMetrics.logs[name] || (assertionMetrics.logs[name] = { buffer: [] });
    const loggerbody = (args: any[]) => {
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
      const value = [process.hrtime(), JSON.stringify(args)];
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
      ret[name] = async (...args: any[]) => {
        loggerbody(args);
        try {
          await (fn as (...a: any[]) => Promise<void>)(...args);
        } catch (e) {
          // record failures
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }
    } else {
      ret[name] = (...args: any[]) => {
        loggerbody(args);
        try {
          (fn as (...a: any[]) => void)(...args);
        } catch (e) {
          assertionMetrics.assertionFailure = true;
          throw e;
        }
      }
    }
  }
  return ret as typeof assertions;
};

const metricsCopyMaker = (assertionMetrics: TestAssertionMetrics, logs: TestLogs) => {
  return () => ({
    logs: logs.slice(),
    assertionMetrics: JSON.parse(JSON.stringify(assertionMetrics)),
  });
};

type ResourceMetricsPerTest = {
  resources: SpawnResourceReport,
  command: string[];
}[];

const asyncSpawnTestTracedMaker = (resourceMetrics: ResourceMetricsPerTest, logger: (...args: any[]) => void) => {
  return async (command: string, args: string[], options?: SpawnAsyncOpts) => {
    const ret = await spawnAsync(command, args, logger, options);
    const { resources } = ret;
    resourceMetrics.push({ resources, command: [command, ...args] });
    return ret;
  }
};

// produces interface with which to define a test accessed through param of test function
export const testParamMaker = (config: ReturnType<typeof getConfig>, logs: TestLogs, assertionMetrics: TestAssertionMetrics, options: TestOptions, resourceMetrics: ResourceMetricsPerTest) => {
  const logger = (...x: any[]) => {
    const formatted = format(...x);
    logs.push([process.hrtime(), formatted]);
    config.get('echo_test_logging') && console.log(process.hrtime(), formatted);
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
    spawn: asyncSpawnTestTracedMaker(resourceMetrics, logger)
  }
}

export type TFun = (params: ReturnType<typeof testParamMaker>) => void;
export type TestMetadata = {
  name: string,
  filename: string,
  suite?: string,
  stack: string,
} & TestOptions;

export const testFnRegistry = new Map<TFun, TestMetadata>();
export const testAsyncFnRegistry = new Map<(...args: Parameters<TFun>) => Promise<void>, TestMetadata>();

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

// TODO Note i want this to do two replacements -- 
// (1) when source-map-support is enabled, stacks map to true source path, so we cull up to proj_root/src/
// (2) when running raw built js without source mapping, the stack will be under proj_root/build/ so we cull there.
// Don't forget, __dirname will always be under build/!
function parseFileLineColFromStackLine (stack_line?: string) {
  return stack_line?.match(/[^/]+\/[^/]+\.[tj]s:\d+:\d+/)?.[0] ?? ''
}

export function test(suite: string, fn: TFun, opts?: TestOptions): TFun;
export function test(fn: TFun, opts?: TestOptions): TFun;
export function test(fn_or_suite_name: (TFun) | string, fn_or_opts?: (TFun | TestOptions), opts?: TestOptions) {
  const suite = typeof fn_or_suite_name === 'string' && fn_or_suite_name;
  let func: TFun | undefined;
  let meta_assembly: Record<string, any> = { stack: parseFileLineColFromStackLine(new Error().stack?.split('\n')[2]) };
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
  (func instanceof AsyncFunction ? testAsyncFnRegistry : testFnRegistry).set(func, meta_assembly as TestMetadata);
  return func;
}

// this test is broken for now under the non source map case.
export const parseStackLine = test('test helpers', ({l, a: {is}}) => {
  const stack = new Error().stack?.split('\n');
  l('stack', stack, 'src loc', resolve(__dirname, '..', '..', 'src'));
  l('---:', parseFileLineColFromStackLine(stack?.[1]));
  is(parseFileLineColFromStackLine(stack?.[1]).match(/test\/index.[tj]s:\d+:\d+$/));
});

// returns false (indicating a test result of pass when we confirm a compatible failure, yeah i know it's confusing) if matching,
// and a meta-error indicating mismatched errors otherwise.
export const compatibleFailure = (spec_err: ErrorSpec, err: Error) => {
    let compatible = false;
    if (spec_err === true) { compatible = !!err; }
    else if (typeof spec_err === 'string') { compatible = err.message.includes(spec_err); }
    else if (spec_err instanceof RegExp) { compatible = spec_err.test(err.message); }
    else if (Array.isArray(spec_err)) { compatible = spec_err.some(e => compatibleFailure(e, err)); }

    if (compatible) return false;
    return Error(`Test failed as expected, but with an incompatible error: ${pp(err)} does not match error spec ${pp(spec_err)}`);
};
