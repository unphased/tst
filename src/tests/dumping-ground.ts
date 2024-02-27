import { exec, execSync } from 'child_process';
import { test } from '../index.js';
import { hrTimeMs, red } from 'ts-utils';
import { fileURLToPath } from 'url';
import { Writable } from 'stream';
import { stdoutColorizer } from '../../process.js';

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
const fib = (n: number) => n < 2 ? n : fib(n - 1) + fib(n - 2);
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

