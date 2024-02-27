import { SpawnSyncReturns, execSync } from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { colors } from '../terminal/colors.js';
import { bold, format, italic, pp, red } from '../utils.js';

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
// used to assert the amount of times some code got triggered
// export const Nce = (n: number, cb: () => void) => { }
// export const once = (cb: () => void) => { Nce(1, cb); }
export const assertions = {
  eq: <T>(a: T, b: T, ...message: any[]) => {
    if (a !== b) throw new Error(red(bold(italic('eq')) + ' expected ') + pp(a) + red(' to equal ') + pp(b) + '. ' + format(...message));
  },
  // eq with epsilon
  eqE: (a: number, b: number, epsilon: number) => {
    if (Math.abs(a - b) > epsilon) throw new Error(red(bold(italic('eqE')) + ' expected ') + pp(a) + red(' to equal ') + pp(b) + red(' within ') + pp(epsilon) + red('.'));
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
  is: (v: any, ...message: any[]) => {
    if (!v) throw new Error(red(bold(italic('is')) + ' expected ') + pp(v) + red(` to be truthy.`) + format(...message));
  },
  not: (v: any) => {
    if (v) throw new Error(red(bold(italic('not')) + ' expected ') + pp(v) + red(` to be falsy.`));
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
};

export type AssertionName = keyof typeof assertions;

