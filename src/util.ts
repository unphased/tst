import { renderBarRatioComparisonLowerIsBetter } from 'ts-utils/terminal';
import { hrTimeMs } from 'ts-utils';

export const renderHrTimeMs = (hrTimeDelta: [number, number]) => hrTimeMs(hrTimeDelta).toFixed(5) + "ms";
export const renderTruncFromMs = (ms: number) => {
  if (ms >= 10000) {
    const s = ms / 1000;
    const digits_to_truncate = Math.floor(Math.log10(s));
    const truncd = digits_to_truncate > 0 ? s.toFixed(6 - Math.min(6, digits_to_truncate)) : s.toFixed(6);
    return truncd + (truncd.length === 7 ? " s" : "s");
  } else {
    const digits_to_truncate = Math.floor(Math.log10(ms));
    const truncd = digits_to_truncate > 0 ? ms.toFixed(5 - digits_to_truncate) : ms.toFixed(5);
    return truncd + "ms";
  }
};
// tabularized constant width time string output providing readability between 0 and 1000000s!
export const renderTruncHrTime = (hrTimeDelta: [number, number]) => renderTruncFromMs(hrTimeMs(hrTimeDelta));

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


