import { SpawnSyncReturns, execSync } from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { colors } from 'ts-utils/terminal';
import { bold, italic, red } from 'ts-utils';
import { format, pp2 } from 'ts-utils/node/format'
import { deepStrictEqual, notDeepStrictEqual } from 'assert';

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
};
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

// helper type guard
function isStringArray(a: any): a is string[] {
  return Array.isArray(a) && a.every(e => typeof e === 'string');
}

// this is a nice example of overload functional types being assignable to objects.
function includes(a: string[], spec: RegExp): void;
function includes<T>(a: T[], spec: T): void;
function includes(a: any, spec: any) {
  if (!a || !a.length) throw new Error(red(bold(italic('includes')) + ' expected ') + pp2(a) + red(" to include ") + pp2(spec) + ' but it cannot, on account of being falsy or empty.');
  if (isStringArray(a) && spec instanceof RegExp) {
    if (!a.some((e: string) => spec.test(e))) {
      throw new Error(red(bold(italic('includes')) + " expected ") + pp2(a) + red(" to include a match for ") + pp2(spec) + red(" by performing regex tests."));
    }
  } else if (!a.includes(spec)) {
    throw new Error(red(bold(italic('includes')) + " expected ") + pp2(a) + red(" to include ") + pp2(spec));
  }
}

const setDiff = <T>(a: T[], b: T[]) => {
  const as = new Set(a);
  const bs = new Set(b);
  const b_not_has_from_a = new Set([...as].filter(x => !bs.has(x)));
  const a_not_has_from_b = new Set([...bs].filter(x => !as.has(x)));
  let str = '';
  if (b_not_has_from_a.size > 0) {
    str += ` In the first set, but not in the second: ${pp2([...b_not_has_from_a])}`;
  }
  if (a_not_has_from_b.size > 0) {
    str += ` In the second set, but not in the first: ${pp2([...a_not_has_from_b])}`;
  }
  return str;
};

// TODO make a variant of this that treats the keys of a map or object as the set to compare
// type Container<T> = T[] | Set<T> | Map<any, T>;
function sameSet<T>(a: T[], b: T[]) {
  if (a.length !== b.length) throw new Error(red(bold(italic('sameSet')) + ' expected ') + pp2(a) + red(' to equal ') + pp2(b) + red(` as sets but they have different lengths (${italic(a.length.toString())} != ${italic(b.length.toString())}).`) + ` Difference:${setDiff(a, b)}`);

  let failedToFind: T | undefined;
  if (!a.every(e => {
    const ret = b.includes(e);
    if (!ret) {
      failedToFind = e;
    }
    return ret;
  })) throw new Error(red(bold(italic('sameSet')) + ' expected ') + pp2(a) + red(' to equal ') + pp2(b) + red(' as sets: ') + pp2(failedToFind) + ' was not found in the latter.');
}

// TODO Explore some assertions to use to assert the amount of times some code got triggered?
// export const Nce = (n: number, cb: () => void) => { }
// export const once = (cb: () => void) => { Nce(1, cb); }

export const assertions = {
  // TODO switch the protocol here to throw special errors that wrap a hrtime as well so that the timing for failed
  // tests won't include the time taken to generate these errors (some of which do spawns etc).
  /**
   * Strict equality assertion (===)
   * @param a Actual value
   * @param b Expected value
   * @param message Optional error message parts
   * @throws When values are not strictly equal
   */
  eq: <T>(a: T, b: T, ...message: any[]) => {
    if (a !== b) throw new Error(red(bold(italic('eq')) + ' expected ') + pp2(a) + red(' to equal ') + pp2(b) + '. ' + format(...message));
  },
  /**
   * Assert two arrays contain the same values (order doesn't matter)
   * @param a First array
   * @param b Second array
   * @throws When arrays have different elements
   */
  sameSet,
  
  /**
   * Numeric equality with epsilon tolerance
   * @param a Actual number
   * @param b Expected number 
   * @param epsilon Allowed difference
   * @throws When numbers differ beyond epsilon
   */
  eqE: (a: number, b: number, epsilon: number) => {
    if (Math.abs(a - b) > epsilon) throw new Error(red(bold(italic('eqE')) + ' expected ') + pp2(a) + red(' to equal ') + pp2(b) + red(' within ') + pp2(epsilon) + red('.'));
  },
  ne: <T>(a: T, b: T) => {
    if (a === b) throw new Error(red(bold(italic('ne')) + ' expected ') + pp2(a) + red(' to not equal ') + pp2(b) + red('.'));
  },
  lt: (a: number, b: number, ...message: any[]) => {
    if (a >= b) throw new Error(red(bold(italic('lt')) + ' expected ') + pp2(a) + red(' to be less than ') + pp2(b) + red('.') + message.length ? format(...message) : '');
  },
  gt: (a: number, b: number, ...message: any[]) => {
    if (a <= b) throw new Error(red(bold(italic('gt')) + ' expected ') + pp2(a) + red(' to be greater than ') + pp2(b) + red('.') + message.length ? format(...message) : '');
  },
  eqO: <T>(a: T, b: T, ...message: any[]) => {
    // unfortunately due to the expense of generating the message, I cannot just outsource it to deepStrictEqual's throw.
    try {
      deepStrictEqual(a, b);
    } catch (e) {
      throw new Error(red(bold(italic('eqO')) + ' expected ') + pp2(a) + red(' to (deep) equal ') + pp2(b) + red('. ') + format(...message) + '\nDelta: ' + diffOfStrings(format(a), format(b)).toString());
    }
  },
  neO: (a: any, b: any) => {
    try {
      notDeepStrictEqual(a, b);
    } catch (e) {
      throw new Error(red(bold(italic('neO')) + ' expected ') + pp2(a) + red(' to not equal ') + pp2(b) + red('.'));
    }
  },
  /**
   * Assert value exists in array or string
   * @param a Array/string to check
   * @param spec Value to find or RegExp for strings
   * @throws When value not found
   */
  includes,
  includesO: (a: any, spec: any) => {
    const v = isSubsetObject(spec, a);
    if (!v) throw new Error(red(bold(italic('includesO')) + ' expected ') + pp2(a) + red(' to include ') + pp2(spec));
  },
  match: (v: string | Buffer, spec: RegExp) => {
    if (!spec.test(v.toString())) throw new Error(red(bold(italic('match')) + ' expected ') + pp2(v) + red(` to match ${pp2(spec)}.`));
  },
  is: (v: any, ...message: any[]) => {
    if (!v) throw new Error(red(bold(italic('is')) + ' expected ') + pp2(v) + red(` to be truthy. `) + format(...message));
  },
  not: (v: any, ...message: any[]) => {
    if (v) throw new Error(red(bold(italic('not')) + ' expected ') + pp2(v) + red(` to be falsy. `) + format(...message));
  },
  subseq: <T>(a: T[], spec: T[]) => {
    if (false === findContiguousSubsequenceSlidingWindow(spec, a)) {
      throw new Error(red(bold(italic('subseq')) + " expected ") + pp2(a) + red(" to include ") + pp2(spec) + red(" as a contiguous subsequence."));
    }
  },
  /**
   * Assert synchronous function throws an error
   * @param fn Function to execute
   * @throws When function does not throw
   * @example a.throws(() => { throw new Error() })
   */
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
            throw new Error(`expected error message or thrown string to include one of "${pp2(expected_message)}", but got "${e}" instead.`);
          }
        }
      }
      return;
    }
    throw new Error(red(bold(italic('throwsA')) + " expected ") + fnA.toString().split('\n').map(l => colors.dark_grey_bg + l + colors.bg_reset).join('\n') + red(" to throw!"));
  }
};

export type AssertionName = keyof typeof assertions;

