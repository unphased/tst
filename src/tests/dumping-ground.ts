import { exec, execSync } from 'child_process';
import { test } from '../main.js';
import { hrTimeMs, pathShortName, red } from 'ts-utils';
import { fileURLToPath } from 'url';
import { Writable, Readable } from 'stream';
import { stdoutColorizer } from '../process.js';
import { findContiguousSubsequenceSlidingWindow } from '../assertions.js';
import { Chainable } from '../util.js';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { enumerateFiles } from '../dispatch/runner.js';

// note carefully this specific code cannot be factored to a different file, it changea its semantics.
const isProgramLaunchContext = () => {
  // this cjs launch detection impl will need to change if we change compilation to target modules
  return fileURLToPath(import.meta.url) === process.argv[1];
}

export const arrowFnRequireModuleFalse = test('basicAsync', async ({a: {eq}}) => eq(isProgramLaunchContext(), false));
export const functionRequireModuleFalse = test('basicAsync', async function ({a: {eq}}) { eq(isProgramLaunchContext(), false) });

const timer_bench = (work: () => void) => {
  const start = process.hrtime();
  work();
  const delta = process.hrtime(start);
  return delta;
};

const timer_bench_async = async (work: () => Promise<void>) => {
  const start = process.hrtime();
  await work();
  const delta = process.hrtime(start);
  return delta;
};

export const node_stack_microbench = test('perf', ({ l, a: { is } }) => {
  // An attempt to determine how much overhead is involved to add a stack trace fetch to some code
  // First, get a baseline of just simple looping
  const ITER = 10000;
  l('grab stack * ' + ITER, hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      const stack = new Error().stack;
      // at least do *something* with it
      is(stack?.split?.('\n').length ?? 0 > 3);
    }
  })) / ITER, 'ms per call');
});

export const process_launch_microbench = test('perf', async ({ l, spawn, a: { eq } }) => {
  // get some idea of how much overhead is involved with various process launch methods
  let ITER = 100; l('spawnAsync * ' + ITER, hrTimeMs(await timer_bench_async(async () => {
    for (let i = 0; i < ITER; ++i) {
      const ret = await spawn('true', [], {ignoreStdinout: true, hideAllMeta: true, bypassResourceMetrics: true}); // prevent logging as it will ruin perf
      eq(0, ret.code);
    }
  })) / ITER, 'ms per call');
  ITER = 200; l('execSync * ' + ITER, hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      execSync('true');
    }
  })) / ITER, 'ms per call');
});
const fib = (n: number): number => n < 2 ? n : fib(n - 1) + fib(n - 2);
export const assertion_microbench = test('perf', ({ l, t, a: { eq } }) => {
  t('ringBufferLimitAssertionLogs', 20);
  // some testing I was doing to get a baseline of how quickly simple math code runs. Turned into a benchmark for test
  // runner augmented assertions.
  let ITER = 500000;
  l('fib(9) * ' + ITER, 'with assertion', hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      eq(fib(9), 34);
    }
  })) / ITER, 'ms per call');
  l('fib(3) * ' + ITER, 'with assertion', hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      eq(fib(3), 2);
    }
  })) / ITER, 'ms per call');
  l('fib(3) * ' + ITER, 'with logical and & operator equals', hrTimeMs(timer_bench(() => {
    let yep = true;
    for (let i = 0; i < ITER; ++i) {
      yep = yep && fib(3) === 2;
    }
  })) / ITER, 'ms per call');
  l('fib(3) * ' + ITER, 'with custom simple throwing assertion', hrTimeMs(timer_bench(() => {
    const assert_true = (val) => { if (!val) throw new Error('bad'); };
    for (let i = 0; i < ITER; ++i) {
      assert_true(fib(3) === 2);
    }
  })) / ITER, 'ms per call');
  l('fib(3) * ' + ITER, 'with custom fancier throwing assertion', hrTimeMs(timer_bench(() => {
    const assert_true = (val) => { if (!val) throw new Error('asserter saw a ' + red('failed') + ' condition: ' + val); };
    for (let i = 0; i < ITER; ++i) {
      assert_true(fib(3) === 2);
    }
  })) / ITER, 'ms per call');
  l('fib(3) * ' + ITER, 'with custom assertion taking args', hrTimeMs(timer_bench(() => {
    const assert_eq = (val, spec) => { if (val !== spec) throw new Error('asserter saw a ' + red('failed') + ' condition: ' + val + ' != ' + spec); };
    for (let i = 0; i < ITER; ++i) {
      assert_eq(fib(3), 2);
    }
  })) / ITER, 'ms per call');
  l('2=2 * ' + ITER, 'with assertion', hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      eq(2, 2);
    }
  })) / ITER, 'ms per call');
  ITER = 1000000;
  l('fib(9) * ' + ITER, 'w/o assertion', hrTimeMs(timer_bench(() => {
    const fib = (n: number) => n < 2 ? n : fib(n - 1) + fib(n - 2);
    for (let i = 0; i < ITER; ++i) {
      fib(9);
    }
  })) / ITER, 'ms per call');
});

export const assertion_with_ringbuffer_microbench = test('perf', ({ l, t, a: { eq } }) => {
  t('ringBufferLimitAssertionLogs', 20);
  const ITER = 500000;
  l('fib(3) * ' + ITER, 'with assertion', hrTimeMs(timer_bench(() => {
    for (let i = 0; i < ITER; ++i) {
      eq(fib(3), 2);
    }
  })) / ITER, 'ms per call');
});

export const simple_transform = test('transform stream', async ({ a: { eqO } }) => {
  // Readable stream
  const readStream = Readable.from(['hello world\nfoo bar baz\n']);

  // Writable stream
  const output: string[] = [];
  const writeStream = new Writable({
    write(chunk, encoding, callback) {
      output.push(chunk.toString());
      callback();
    }
  });

  // Pipe them together
  readStream.pipe(stdoutColorizer()).pipe(writeStream);

  // Verify output
  const x = await new Promise((resolve, _reject) => {
    writeStream.on('finish', () => {
      resolve(output);
    });
  });
  eqO(x, ['\x1b[48;5;19mhello world\x1b[0K\n\x1b[48;5;19mfoo bar baz\x1b[0K\n\x1b[m']);
});

export const pathShortNameTest = test('utils', ({ a: { eq } }) => {
  eq(pathShortName('foo/bar/baz', 1), 'baz');
  eq(pathShortName('foo/bar/baz', 2), 'bar/baz');
  eq(pathShortName('foo/bar/baz', 3), 'foo/bar/baz');
  eq(pathShortName('foo/bar/baz', 4), 'foo/bar/baz');
  eq(pathShortName('foo/bar/baz/index.ts', 1), 'baz/index.ts');
  eq(pathShortName('foo/bar/baz/index.ts', 2), 'bar/baz/index.ts');
  eq(pathShortName('foo/bar/baz/index.ts', 3), 'foo/bar/baz/index.ts');
  eq(pathShortName('foo/bar/baz/index.ts', 4), 'foo/bar/baz/index.ts');
});

export const stdout_transform_spawn = test('transform stream', async ({ a: { eqO } }) => {
  const output: string[] = [];
  const writeStream = new Writable({
    write(chunk, encoding, callback) {
      output.push(chunk.toString());
      callback();
    }
  });

  const child = exec('echo "hello world"');
  child.stdout?.pipe(stdoutColorizer()).pipe(writeStream);
  child.on('error', (err) => {
    throw err;
  });
  child.stdout?.on('error', (err) => {
    throw err;
  });
  const x = await new Promise((resolve, _reject) => {
    writeStream.on('finish', () => {
      resolve(output);
    });
  });
  eqO(x, ['\x1b[48;5;19mhello world\x1b[0K\n\x1b[m']);
});

function findContiguousSubsequenceBacktrack<T>(needle: T[], haystack: T[]): false | number {
  if (needle.length === 0) return false;
  if (haystack.length < needle.length) return false;

  let startIndex = 0;
  let needleIndex = 0;

  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] === needle[needleIndex]) {
      if (needleIndex === 0) {
        startIndex = i; // Mark the start of a potential match
      }
      needleIndex++;
      if (needleIndex === needle.length) {
        return startIndex; // Found a complete match
      }
    } else if (needleIndex > 0) {
      // Reset and retry from the next element after the initial start of the potential match
      i = startIndex;
      needleIndex = 0;
    }
  }
  return false;
}

function findContiguousSubsequenceFunctional<T>(needle: T[], haystack: T[]): false | number {
  if (needle.length === 0) return false;
  if (haystack.length < needle.length) return false;

  const window_range = haystack.length - needle.length + 1
  for (let i = 0; i < window_range; i++) {
    if (haystack.slice(i, i + needle.length).every((elem, j) => elem === needle[j])) {
      return i;
    }
  }
  return false;
}

export const basic = test('contiguous subsequence', ({l, a: { is, eq }}) => {
  const methods = [
    findContiguousSubsequenceBacktrack,
    findContiguousSubsequenceSlidingWindow,
    findContiguousSubsequenceFunctional,
  ]
  const needle = [1, 2, 3];
  const haystack = [0, 1, 2, 3, 4, 5];
  methods.forEach((method) => {
    is(method(needle, haystack));
  });
  
  const n = [ 'abcd', 'efgh', 'ij' ];
  const h = [ 'abcd', 'efgh', 'ij', '', '' ];
  methods.forEach((method) => {
    eq(0, method(n, h));
  });

  const haystack2 = ['a', 'b', 0, 1, 2, 1, 2, 0, 2, 3, 4, 1, 2, 1, 2, 2, 3, 2, 1, 2, 3, 1, 2, 3, 1, 'z'];
  methods.forEach((method) => {
    is(method(needle, haystack2));
  });
  const needle2 = [1, 2, 1, 2, 0, 2, 3, 4, 1, 2, 1, 2, 2, 3, 2, 1, 2, 3, 1, 2, 3, 2];
  methods.forEach((method) => {
    is(!method(needle2, haystack2));
  });

  const large_haystack = [...Array(1000000).keys()];
  const large_needle = [...Array(1000).keys()].map(e => e + 234923);
  methods.forEach((method) => {
    const start = process.hrtime();
    is(method(large_needle, large_haystack));
    l(hrTimeMs(process.hrtime(start)), method);
  });
});

export const regex_alternation_with_capture_grp = test('regex', ({ l, a: {eq} }) => {
  const re = /(\(.*\))|file:\/\/.*:\d+/;
  eq(re.exec('file://abc/def/ghi:123')[1], undefined);
  eq(re.exec('file://abc/def/ghi:123 blah')[1], undefined);
  eq(re.exec('(abc/def/ghi:123) blah').index, 0);
});
export const sanity_check_unicode_string_lengths = test('string length', ({ l, plot: p, t, a: { eq } }) => {
  const str = "✔✔✔✔✔✔✔✔";
  eq(str.length, 8);
});

export const enumerateFilesTest = test('files', async ({l, a: {eq, sameSet}}) => {
  const target = os.homedir() + '/util/chatgpt_automation';
  const files = await enumerateFiles(target, () => true, { include_dirs: true });
  const files2 = fs.readdirSync(target, { recursive: true, encoding: 'utf8' }).map(e => target + '/' + e);
  l('files length', files.length);
  l('files2 length', files2.length);

  for (const file of files2) {
    if (files.indexOf(file) === -1) {
      l('missing from first set:', file);
    }
  }
  sameSet(files, files2);
});

export const enumerateFilesRel = test('files', async ({l, a: {eq, sameSet}}) => {
  const targets = [ 'build', '././build', './build/config/..'  ];
  for (const targ of targets) {
    const target = path.join(...targ.split('/'));
    const files = await enumerateFiles(target, () => true, { include_dirs: true });
    // NOTE HERE THAT enumerateFiles includes given dir relative to cwd, while readdirsync does not!
    const files2 = fs.readdirSync(target, { recursive: true, encoding: 'utf8' }).map(e => target + '/' + e);
    l('files length', files.length);
    l('files2 length', files2.length);

    for (const file of files2) {
      if (files.indexOf(file) === -1) {
        l('missing from first set:', file);
      }
    }
    sameSet(files, files2);
  }
});

export const enumerateFilesWithAFile = test('files', async ({l, a: {eqO}}) => {
  const file = '/etc/hosts';
  eqO(await enumerateFiles(file), [file]);
});

// silly js promises test
export const nodePromisesChainedThens = test('promises', async ({l, a: {eq}}) => {
  const prom = new Promise((res) => {
    setTimeout(() => { res('foo'); }, 100);
  }).then(res => {
    console.assert(res === 'foo', `not res === 'foo'`);
    throw 'haha';
    return 'bar';
  }).catch((e) => {
    console.error('Error!', e);
    return 'errored';
  }).then(res => {
    console.assert(res === 'bar', `res to be bar, was "${res}"`);
    return 'baz';
  });

  const val = await prom;
  eq(val, 'baz');

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  eq('foo 100', await new Promise((res) => {
    setTimeout(() => { res('foo'); }, 100);
  }).then(async (res) => {
    await sleep(100);
    return res + ' 100';
  }));
});

// export const confirmNode22EmitsRedStdErr = test('node', async ({l, a: {eqO}}) => {
//   // hmm i have to run this in a pty though. use tmux i guess
// });
