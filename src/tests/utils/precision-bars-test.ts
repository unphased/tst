import { test } from "../../main.js";
import { lexAnsi, renderBarRatioComparisonLowerIsBetter, renderHorizBar } from "ts-utils/terminal"

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

// there are 9 possible levels showable with a single bar. the bar comes in 8 states of fill, so there is a 9th first state
// representing 0. however if we have 3 chars for example, that makes for 25 states and not 27 states.
export const fine_grain_check = test('terminal precision bar rendering', ({t, l, a: {eq}}) => {
  const bars = '▏▎▍▌▋▊▉█';
  eq(renderHorizBar(0, 1), ' ');
  eq(renderHorizBar(1/9 - 0.0001, 1), ' ');
  eq(renderHorizBar(1/9 + 0.0001, 1), bars[0]);
});
