import { lexAnsi } from 'ts-utils/terminal';
import { test } from '../main.js';
import { splitString } from "../render/border.js";
import { renderHrTimeMs, renderPercentage, renderTruncFromMs, renderTruncHrTime } from "../util.js";

export const renderPercentageChecks = test('time render', ({ l, a: { eq } }) => {
  eq(renderPercentage(0, l), "0.000%");
  eq(renderPercentage(0.1, l), "10.00%");
  eq(renderPercentage(0.01, l), "1.000%");
  eq(renderPercentage(0.001, l), "0.100%");
  eq(renderPercentage(0.0001, l), "0.010%");
  eq(renderPercentage(0.00001, l), ".0010%");
  eq(renderPercentage(0.000001, l), ".0001%");
  eq(renderPercentage(1e-7, l), ".0000%");

  eq(renderPercentage(-0.5, l), "-50.0%");

  eq(renderPercentage(0.2, l), "20.00%");
  eq(renderPercentage(0.3333, l), "33.33%");
  eq(renderPercentage(0.5, l), "50.00%");
  eq(renderPercentage(0.89, l), "89.00%");
  eq(renderPercentage(0.999, l), "99.90%");
  eq(renderPercentage(0.9999, l), "99.99%");
  eq(renderPercentage(0.99994, l), "99.99%");
  eq(renderPercentage(0.99995, l), "100.0%");
  eq(renderPercentage(0.99999, l), "100.0%");
  eq(renderPercentage(0.999999, l), "100.0%");
  eq(renderPercentage(1, l), "100.0%");
  eq(renderPercentage(2, l), "200.0%");
  eq(renderPercentage(2.001, l), "200.1%");
  eq(renderPercentage(2.0007, l), "200.1%");
  eq(renderPercentage(10, l), "1000 %");
  eq(renderPercentage(99.99, l), "9999 %");
  eq(renderPercentage(199.99, l), "19999%");

  eq(renderPercentage(0.09999, l), "9.999%");
  eq(renderPercentage(0.099994, l), "9.999%");
  eq(renderPercentage(0.099996, l), "10.00%");
  eq(renderPercentage(0.0999950001, l), "10.00%");
  // this is some weird ieee754 limitation, it won't round up even when I expect it should.
  eq(renderPercentage(0.099995, l), "9.999%");
});

export const renderPercentageGenerative = test('time render', ({ a: { eq } }) => {
  for (let i = 0; i < 100000; i++) {
    const num = Math.random();
    const scale = 10 ** (Math.ceil(Math.random() * 6) - 4);
    const perc = num * scale;
    const str = renderPercentage(perc);
    eq(str.length, 6);
    eq(str[5], '%');
  }
});

export const renderHrMsSanityChecks = test('time render', ({ a: { eq, is } }) => {
  const start = process.hrtime();
  const delta = process.hrtime(start);
  const render = renderHrTimeMs(delta);
  is(render.match(/[0-9.]ms$/));
  eq(renderHrTimeMs([0,      0]),       "0.00000ms");
  eq(renderHrTimeMs([0,      1]),       "0.00000ms");
  eq(renderHrTimeMs([0,      1000]),    "0.00100ms");
  eq(renderHrTimeMs([0,      1000000]), "1.00000ms");
  eq(renderHrTimeMs([1,      0]),       "1000.00000ms");
  // unconventional cases
  eq(renderHrTimeMs([0.1,    0]),       "100.00000ms");
  eq(renderHrTimeMs([0.001,  0]),       "1.00000ms");
  eq(renderHrTimeMs([0.0001, 100000]),  "0.20000ms");
});

export const renderTruncHrSanityChecks = test('time render', ({ a: { eq } }) => {
  eq(renderTruncHrTime([0,             0]),                "0.00000ms");
  eq(renderTruncHrTime([0,             1]),                "0.00000ms");
  eq(renderTruncHrTime([0,             10]),               "0.00001ms");
  eq(renderTruncHrTime([0,             100]),              "0.00010ms");
  eq(renderTruncHrTime([0,             999]),              "0.00100ms");
  eq(renderTruncHrTime([0,             994]),              "0.00099ms");
  eq(renderTruncHrTime([0,             995]),              "0.00100ms");
  eq(renderTruncHrTime([0,             1000]),             "0.00100ms");
  eq(renderTruncHrTime([0,             100000]),           "0.10000ms");
  eq(renderTruncHrTime([0,             1000000]),          "1.00000ms");
  eq(renderTruncHrTime([0,             10000000]),         "10.0000ms");
  eq(renderTruncHrTime([0,             100000000]),        "100.000ms");
  eq(renderTruncHrTime([0,             1000000000]),       "1000.00ms");
  eq(renderTruncHrTime([0,             9000000000]),       "9000.00ms");
  eq(renderTruncHrTime([0,             10000000000]),      "10.00000s");
  eq(renderTruncHrTime([0,             100000000000]),     "100.0000s");
  eq(renderTruncHrTime([0,             100000000000000]),  "100000.0s");
  eq(renderTruncHrTime([0,             999999900000000]),  "999999.9s");
  eq(renderTruncHrTime([0,             999999949999999]),  "999999.9s");
  eq(renderTruncHrTime([0,             999999951000000]),  "1000000.0s"); // again a flaw is here, but this is rare to hit
  eq(renderTruncHrTime([0,             1000000000000000]), "1000000 s");
  eq(renderTruncHrTime([10000000 - 1,  0]),                "9999999 s");
  eq(renderTruncHrTime([10000000,      0]),                "10000000s");
  eq(renderTruncHrTime([100000000 - 1, 0]),                "99999999s");
});

export const renderTruncHrSanityChecks7 = test('time render', ({ a: { eq } }) => {
  eq(renderTruncHrTime([0, 0],                7), "0.000ms");
  eq(renderTruncHrTime([0, 1],                7), "0.000ms");
  eq(renderTruncHrTime([0, 10],               7), "0.000ms");
  eq(renderTruncHrTime([0, 100],              7), "0.000ms");
  eq(renderTruncHrTime([0, 999],              7), "0.001ms"); // with 7 digits the low limit is 1us, which i think is at the limit
  eq(renderTruncHrTime([0, 499],              7), "0.000ms"); // 499 ns = just under half a microsecond
  eq(renderTruncHrTime([0, 500],              7), "0.001ms"); // half a microsecond
  eq(renderTruncHrTime([0, 1000],             7), "0.001ms");
  eq(renderTruncHrTime([0, 100000],           7), "0.100ms");
  eq(renderTruncHrTime([0, 1000000],          7), "1.000ms");
  eq(renderTruncHrTime([0, 10000000],         7), "10.00ms");
  eq(renderTruncHrTime([0, 99990000],         7), "99.99ms");
  eq(renderTruncHrTime([0, 100000000],        7), "0.1000s");
  eq(renderTruncHrTime([0, 1000000000],       7), "1.0000s");
  eq(renderTruncHrTime([0, 9000000000],       7), "9.0000s");
  eq(renderTruncHrTime([0, 10000000000],      7), "10.000s");
  eq(renderTruncHrTime([0, 100000000000],     7), "100.00s");
  eq(renderTruncHrTime([0, 100000000000000],  7), "100000s");
  eq(renderTruncHrTime([0, 1000000000000000], 7), "1000000s"); // this is fine as we're out of range of char range and i'd rather not truncate or fail
  eq(renderTruncHrTime([10000 - 1,   0],      7), "9999.0s");
  eq(renderTruncHrTime([9999, 949999999],     7), "9999.9s");
  eq(renderTruncHrTime([9999, 950000000],     7), "10000.0s"); // THIS IS NOT DESIRED, but I can't really bring myself to care
  eq(renderTruncHrTime([9999, 999999999],     7), "10000.0s"); // DITTO here (this issue only affects 9999.9s thru 10000s exclusive).
  eq(renderTruncHrTime([9999, 1000000000],    7), "10000 s");
  eq(renderTruncHrTime([10000,       0],      7), "10000 s");
  eq(renderTruncHrTime([100000 - 1,  0],      7), "99999 s");
  eq(renderTruncHrTime([100000,      0],      7), "100000s");
  eq(renderTruncHrTime([1000000 - 1, 0],      7), "999999s");
});

// with 6 digits I want to bring in us to the party otherwise the precision stops at 10us
export const renderTruncHrSanityChecks6 = test('time render', ({ a: { eq } }) => {
  eq(renderTruncHrTime([0, 0],          6), "0.00ns");
  eq(renderTruncHrTime([0, 10],         6), "10.0ns");
  eq(renderTruncHrTime([0, 100],        6), "100 ns");
  eq(renderTruncHrTime([0.000001, 0],   6), "1.00us");
  eq(renderTruncHrTime([0.00001, 0],    6), "10.0us");
  eq(renderTruncHrTime([0.00009, 0],    6), "90.0us");

  eq(renderTruncHrTime([0.0009, 0],     6), "900 us");
  eq(renderTruncHrTime([0.009, 0],      6), "9.00ms");
  eq(renderTruncHrTime([0.09, 0],       6), "90.0ms");

  eq(renderTruncHrTime([0.9, 0],        6), "900 ms");
  eq(renderTruncHrTime([1, 0],          6), "1.000s");
  eq(renderTruncHrTime([10, 0],         6), "10.00s");
  eq(renderTruncHrTime([100, 0],        6), "100.0s");

  eq(renderTruncHrTime([1000, 0],       6), "1000 s");
  eq(renderTruncHrTime([9900, 0],       6), "9900 s");
  eq(renderTruncHrTime([9999.9, 0],     6), "10000 s"); // yep so the mechanism of this hole is always the same -- log10 is correct but nudging from rounding in the toFixed operation pushes us over.
  eq(renderTruncHrTime([10000, 0],      6), "10000s");
  eq(renderTruncHrTime([90000, 0],      6), "90000s");
  eq(renderTruncHrTime([900000, 0],     6), "900000s"); // sanity check that going over still looks minimally bad
});

export const renderTruncHrSanityChecks5 = test('time render', ({ a: { eq } }) => {
  eq(renderTruncHrTime([0.0009, 0],           5), "900us");
  eq(renderTruncHrTime([0.009, 0],            5), "9.0ms");
  eq(renderTruncHrTime([0.01, 0],             5), "10 ms");
  eq(renderTruncHrTime([0.05, 0],             5), "50 ms");
  eq(renderTruncHrTime([0.09, 0],             5), "90 ms");
  eq(renderTruncHrTime([0.9, 0],              5), "900ms");
  eq(renderTruncHrTime([1, 0],                5), "1.00s");
  eq(renderTruncHrTime([10, 0],               5), "10.0s");
  eq(renderTruncHrTime([100, 0],              5), "100 s");
  eq(renderTruncHrTime([1000, 0],             5), "1000s");

  eq(renderTruncHrTime([0, 0],                5), "0.0ns"); // using ns for 5 chars, since it was easy to formulate, but it will never really show up in usage
  eq(renderTruncHrTime([0, 100],              5), "100ns");
  eq(renderTruncHrTime([0, 1000],             5), "1.0us");
  eq(renderTruncHrTime([0, 10000],            5), "10 us");
  eq(renderTruncHrTime([0, 49499],            5), "49 us");
  eq(renderTruncHrTime([0, 49500],            5), "50 us");
  eq(renderTruncHrTime([0, 50000],            5), "50 us");
  eq(renderTruncHrTime([0, 100000],           5), "100us");
  eq(renderTruncHrTime([0, 449999],           5), "450us");
  eq(renderTruncHrTime([0, 1000000],          5), "1.0ms");
  eq(renderTruncHrTime([0, 999999],           5), "1000us"); // sigh still have this gap, damn rounding
  eq(renderTruncHrTime([0, 999499],           5), "999us");
  eq(renderTruncHrTime([0, 5000000],          5), "5.0ms");
  eq(renderTruncHrTime([0, 10000000],          5), "10 ms");
});

export const renderTruncHrSanityCheckStrlenExhaustive = test('time render', ({ l, a: { eq } }) => {
  let count = 0;
  const lut_len = 1000; // hardly matters what the length of the cycle is unless trivially small. when too large it merely wastes entropy and memory.
  const max_steps = 10000; // increment the double by up to this many integer steps of UINT_MAX, yeah... doubles need a lot to tick up...
  const randomLUT = Array.from({ length: lut_len }, () => Math.floor(Math.random() * max_steps));
  function* iterateFloatsInRangeRandomRandom(start, end) {
    if (start >= end) {
      throw new Error("Start must be less than end");
    }

    const buffer = new ArrayBuffer(8);
    const float64 = new Float64Array(buffer);
    const uint32 = new Uint32Array(buffer);

    // assigns random value to lower 32 bits
    // window.crypto.getRandomValues(new Uint32Array(uint32.buffer, 4, 1));
    // this started as stepping through doubles one bit at a time, but brother in christ does that not even move the
    // needle. So all I actually do now is apply the random incrementation to the higher 32 bits, leaving the lower 32 as whatever it was set from the initial start double value
    float64[0] = start;

    let lutidx = 0;
    while (float64[0] <= end) {
      count++;
      const steps = randomLUT[lutidx++];
      l(steps, float64[0]);
      yield float64[0];
      uint32[1] += steps;
      if (lutidx === lut_len) lutidx = 0;
    }
  }

  // sparsely sampling some very small sections of the real number line
  for (const width of [5, 6, 7, 8, 9]) {
    for (const num of iterateFloatsInRangeRandomRandom(1e-300, 1e-299)) eq(renderTruncFromMs(num, width).length, width, renderTruncFromMs(num, width));
    for (const num of iterateFloatsInRangeRandomRandom(1e-8, 1e-7)) eq(renderTruncFromMs(num, width).length, width, renderTruncFromMs(num, width));
    for (const num of iterateFloatsInRangeRandomRandom(0.001, 0.0010001)) eq(renderTruncFromMs(num, width).length, width, renderTruncFromMs(num, width));
  }

  l('count seen', count);
});

export const splitStringBasic = test('splitString', ({ a: { eqO } }) => {
  const str = "1234567890abc";
  const split = splitString(str, 5, [], []);
  eqO(split, ["12345", "67890", "abc"]);
  const str2 = "foo\x1b[31mbar\x1b[mbaz abc def ghi jkl mno pqr";
  const ansi2 = lexAnsi(str2);
  const split2 = splitString(str2, 8, ansi2.idxs[0], ansi2.lens[0]);
  eqO(split2, ["foo\x1b[31mbar\x1b[mba", "z abc de", "f ghi jk", "l mno pq", "r"]);
  const str3 = "foobarba\x1b[31mz abc def gh\x1b[mi jkl mno pq\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[mr";
  const ansi3 = lexAnsi(str3);
  const split3 = splitString(str3, 5, ansi3.idxs[0], ansi3.lens[0]);
  eqO(split3, ['fooba',
    'rba\x1B[31mz ',
    'abc d',
    'ef gh',
    '\x1B[mi jkl',
    ' mno ',
    'pq\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[mr']);
});

export const splitStringHardcoreBoundsCheck = test('splitString', ({ l, a: { eq, is } }) => {
  let count_checks = 0;
  // just generate random combos.
  for (let i = 0; i < 100; i++) {
    // random string
    const str = Array.from({ length: 300 }, () => Math.random().toString(36).charAt(2)).join('');
    // intersperse random ansi codes inside every random number of chars
    // (with a heavier towards smaller value distribution). all kindsa garbage.
    const ansi_code_set = ['31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41'];
    let combined = '';
    let lastJ = 0;
    for (let j = 0; j < str.length; j += Math.ceil((Math.random() * Math.random()) * 40)) {
      const ansi_code_rand = ansi_code_set[Math.floor(Math.random() * ansi_code_set.length)];
      combined += `${str.slice(lastJ, j)}\x1b[${ansi_code_rand}m`;
      lastJ = j;
    }
    const a = lexAnsi(combined);
    for (let j = 3; j < 80; j += Math.ceil(Math.random() * Math.random() * (10 + j / 4))) {
      const split = splitString(combined, j, a.idxs[0], a.lens[0]);
      eq(split.join(''), combined);
      is(split.every((s, i) => lexAnsi(s).cleaned[0].length === j || (i === split.length - 1 && lexAnsi(s).cleaned[0].length === a.cleaned[0].length % j)));
      count_checks += split.length + 1;
    }
    // console.log(util.inspect(split.map((s, i) => { const a = convertAnsiHtml(s); return {s, a, l: a.cleaned[0].length }; }), { colors: true, depth: Infinity, compact: true }));
  }
  l('checks performed:', count_checks);
});

export const confirmAnsiLexingOnHyperlinks = test('ansi lexing', ({ l, a: { eq, eqO } }) => {
  const href = 'https://example.com';
  const content = 'foo'
  const url = `\x1b]8;;${href}\x1b\\${content}\x1b]8;;\x1b\\`;
  const str = `abc${url}def`;
  const ansi = lexAnsi(str);
  eq(ansi.cleaned[0], "abcfoodef", 'culling hyperlink escape seqs');
  eq(ansi.idxs[0][0], 3, 'first escape starts after "abc"');
  eq(ansi.lens[0][0], `\x1b]8;;${href}\x1b\\`.length, 'hyperlink content beginner section length');
  eq(ansi.idxs[0][1], 32, 'start pos of second escape');
  eq(ansi.lens[0][1], 7, 'length of hyperlink content ending section')
  l(ansi);
});
