import { renderBarRatioComparisonLowerIsBetter } from 'ts-utils/terminal';
import { hrTimeMs, kvString } from 'ts-utils';

export const renderHrTimeMs = (hrTimeDelta: [number, number]) => hrTimeMs(hrTimeDelta).toFixed(5) + "ms";

// against my better judgement... an impl allowing more precision to be shown by allowing microseconds
const renderTruncFromMsNuanced = (ms: number, width: number) => {
  if (width < 5) throw new Error("Width must be at least 5 to render fixed width");
  const digits_place = ms < 1e-6 ? -6 : Math.floor(Math.log10(ms)); // this just clamps to ns zone for absurdly small numbers that may come in
  const positioning = (digits_place + 30) % 3; // modulo 3, so now 0 = ones, 1 = tens, 2 = hundreds
  const suffix_zone = Math.min(3, Math.floor(digits_place / 3) + 2); // div 3, shifted, so 0 = ns, 1 = us, 2 = ms, 3 = s
  const factor = [1e6, 1e3, 1, 1e-3][suffix_zone];
  const suffix = ['ns', 'us', 'ms', 's'][suffix_zone]
  if (width === 5) { // 5 is unique. it only gives space for 3 digits usually, and that includes the decimal point
    const prec = suffix_zone === 3 ? [2,1,0][positioning] : [1,0,0][positioning];
    const has_space_gap = suffix_zone === 3 ? positioning === 2 : positioning === 1;
    const dbg = kvString({digits_place, positioning, suffix_zone, suffix, factor, ms, width});
    return digits_place > 5 ? (ms * 1e-3).toFixed(0) + 's' : (ms * factor).toFixed(prec) + (has_space_gap ? " " : "") + suffix;
  } else if (width === 6) { // with 4 digits available, something reasonable can still be done
    const dbg = kvString({digits_place, positioning, suffix_zone, suffix, factor, ms, width});
    const prec = suffix_zone === 3 ? [3,2,1][positioning] : [2,1,0][positioning];
    const has_space_gap = suffix_zone === 3 ? false : positioning === 2;
    return digits_place > 5 ? (ms * 1e-3).toFixed(0) + (digits_place === 6 ? ' s' : 's') : (ms * factor).toFixed(prec) + (has_space_gap ? " " : "") + suffix;
  } else {
    throw new Error("Width must be 5 or 6 to work in renderTruncFromMsNuanced");
  }
};

export const renderTruncFromMs = (ms: number, width = 9) => {
  if (width < 7) return renderTruncFromMsNuanced(ms, width);
  const displaySeconds = 10 ** (width - 5);
  if (ms >= displaySeconds) {
    const s = ms / 1000;
    const digits_to_truncate = Math.floor(Math.log10(s));
    const truncd = digits_to_truncate > 0 ? s.toFixed(width - 3 - Math.min(width - 3, digits_to_truncate)) : s.toFixed(width - 3);
    return truncd + (truncd.length === (width - 2) ? " s" : "s");
  } else {
    const digits_to_truncate = Math.floor(Math.log10(ms));
    const truncd = digits_to_truncate > 0 ? ms.toFixed(width - 4 - digits_to_truncate) : ms.toFixed(width - 4);
    return truncd + "ms";
  }
};
// tabularized constant width time string output providing readability between 0 and 1000000s!
export const renderTruncHrTime = (hrTimeDelta: [number, number], width = 9) => renderTruncFromMs(hrTimeMs(hrTimeDelta), width);

export function renderPercentage(num: number, l?: (...args: any[]) => void) {
  if (num === 0) return "0.000%";
  // if (num >= 0.99995) return "100.0%";
  const perc = num * 100;
  const rendered = perc.toFixed(4);
  if (perc > 0 && perc < 0.01) {
    return rendered.slice(1) + "%";
  }
  const digits_left_of_decimal = rendered.indexOf('.');
  // resolve rounding via toFixed as much as necessary to get correct rounding.
  const rendered2 = perc.toFixed(Math.max(0, 4 - digits_left_of_decimal));
  l && l(perc, rendered, rendered2);
  if (rendered2.length > 5) { // e.g. 9.9997 rounded up into 10.000
    return rendered2.slice(0, 5) + "%"; // trunc it
  }

  if (rendered2.length === 4 && rendered2.indexOf('.') === -1) {
    return rendered2 + " %";
  }
  return rendered2 + '%';
}

export function renderVisualPercentageLowerIsBetter(actual: number, reference: number, width: number) {
  return renderBarRatioComparisonLowerIsBetter(actual, reference, width) + " " + renderPercentage(actual / reference);
}

// type guard
function isArray<T>(arg: T | T[]): arg is T[] {
  return Array.isArray(arg);
}

// debating if i should rename this to Drill or something.
export class Chainable<T> {
  private object: T;

  constructor(object: T) {
    this.object = object;
  }

  // the R suffix indicates a notion of "raw" where it will not return a Chainable instance, just the thing inside
  // (which is drilled down into the structure by however many levels were chained).
  objR<K extends keyof T, V extends T[K]>(
    key: K,
    objToMerge?: V
  ) {
    const entry: Partial<T[K]> = this.object[key] || {};
    const merged = objToMerge ? { ...entry, ...objToMerge } : entry;
    this.object[key] = merged as Required<T>[K];
    return this.object[key] as Required<T>[K];
  }

  obj<K extends keyof T, V extends T[K]>(
    key: K,
    objToMerge?: V
  ) {
    return new Chainable(this.objR(key, objToMerge));
  }

  arrR<K extends keyof T>(
    key: K,
    ...elements: NonNullable<T[K]> extends (infer R)[] ? R[] : never
  ) {
    if (!this.object[key] || !Array.isArray(this.object[key])) {
      this.object[key] = [] as T[K];
    }
    (this.object[key] as any).push(...elements);
    return this.object[key];
  }

  arr<K extends keyof T>(
    key: K,
    ...elements: NonNullable<T[K]> extends (infer R)[] ? R[] : never
  ) {
    return new Chainable(this.arrR(key, ...elements));
  }

  // unfortunately this way of chaining prevents native syntax since we hace to stay in a chain of Chainable return
  // values. so sub is used to perform array indexing.
  subR<I extends number>(index: I): T extends (infer U)[] ? U : never {
    if (Array.isArray(this.object)) {
      return this.object[index] as T extends (infer U)[] ? U : never;
    } else {
      throw new Error('Operation `sub` is not valid on non-array types.');
    }
  }

  sub(index: number) {
    return new Chainable(this.subR(index));
  }

  // Method to access the encapsulated object, if direct manipulation or retrieval is necessary.
  getRaw(): T {
    return this.object;
  }
}


