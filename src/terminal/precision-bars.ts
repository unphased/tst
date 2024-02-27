import { test } from "tst"
import { bgBlue, green, inverse, red } from "ts-utils"
import { lexAnsi } from "./ansi-parse.js"

// uses "unicode block elements" and such glyphs to render progress bars and other arbitrary time based division type stuff.

// lookup strings, low to high value
const full_block = '█'
const left_block = '▏▎▍▌▋▊▉█'
const bottom_block = '▁▂▃▄▅▆▇█'

// low level bar rendering
export const renderHorizBar = (ratio: number, width: number) => {
  const chars_width = ratio * width;
  const blocks = Math.floor(chars_width);
  const remaining = Math.ceil((chars_width - blocks) * 7);
  let so_far = full_block.repeat(blocks);
  if (so_far.length >= width) {
    return so_far;
  }
  so_far += (remaining > 0 ? left_block[remaining] : ' ');
  if (so_far.length >= width) {
    return so_far;
  }
  return so_far + ' '.repeat(width - so_far.length);
}

// a bar that has definable fixed width for showing how much a scalar is above or below a given expected value
export const renderBarRatioComparisonLowerIsBetter = (actual: number, expectation: number, width: number, slop = 0.08) => {
  const ratio = actual / expectation;
  if (ratio < 1 - slop) {
    return bgBlue(green(renderHorizBar(ratio, width)));
  } 
  // the rest has ratio >= 1. Invert the ratio
  if (ratio < 1 + slop) {
    if (ratio > 1) {
      return bgBlue(inverse(renderHorizBar(1/ratio, width)));
    }
    return bgBlue(renderHorizBar(ratio, width));
  }
  return bgBlue(inverse(red(renderHorizBar(1/ratio, width))));
}

export const visual_check_comparison = test('terminal precision bar rendering', ({ t, l, a: { eq } }) => {
  t('exemptFromAsserting', true);
  const WIDTH = 20;
  for (let i = 1; i <= 200; i *= 1.05) {
    const r = renderBarRatioComparisonLowerIsBetter(i, 10, WIDTH);
    const ansi = lexAnsi(r);
    l(r, i/10, ansi);
    eq(ansi.cleaned.length, 1);
    eq(ansi.cleaned[0].length, WIDTH);
  }
});

// a bar that shows comparisons for a whole vector, with only 8 points of resolution, consuming only 1 character per item

export const visual_check = test('terminal precision bar rendering', ({ t, l, a: { eq } }) => {
  t('exemptFromAsserting', true);
  l(renderHorizBar(0.5, 10) + '<<<');
  l(renderHorizBar(0.5, 5) + '<<<');
  const MAX = 100;
  for(let i = 0; i <= MAX; i += 1) {
    const r = renderHorizBar(i/MAX, 10);
    l(r + '<<<', i);
    eq(r.length, 10, 'length of bar');
  }
  for (let i = 0; i <= 50; i += 1) {
    const r = renderHorizBar(i/50, 3)
    l(r + '<<<', i);
    eq(r.length, 3, 'length of bar');
  }
})
