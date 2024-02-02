import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { TestOptions, pp, red, test, AssertionName } from './index.js';
import { getConfig } from '../config.js';
import { convertAnsiHtml } from '../terminal/ansihtml.js';
import { colors } from '../terminal/colors.js';
import { hrTimeMs, spawnAsync, sum } from '../utils.js';
import { fileURLToPath } from 'url';
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export const renderHrTimeMs = (hrTimeDelta: [number, number]) => hrTimeMs(hrTimeDelta).toFixed(5) + "ms";
const renderTruncFromMs = (ms: number) => {
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

export const renderHrMsSanityChecks = test('time render', ({a: {eq, is}}) => {
  const start = process.hrtime();
  const delta = process.hrtime(start);
  const render = renderHrTimeMs(delta);
  is(render.match(/[0-9.]ms$/));
  eq(renderHrTimeMs([0, 0]), "0.00000ms");
  eq(renderHrTimeMs([0, 1]), "0.00000ms");
  eq(renderHrTimeMs([0, 1_000]), "0.00100ms");
  eq(renderHrTimeMs([0, 1_000_000]), "1.00000ms");
  eq(renderHrTimeMs([1, 0]), "1000.00000ms");
  // unconventional cases
  eq(renderHrTimeMs([0.1, 0]), "100.00000ms");
  eq(renderHrTimeMs([0.001, 0]), "1.00000ms");
  eq(renderHrTimeMs([0.0001, 100_000]), "0.20000ms");
});

export const renderTruncHrSanityChecks = test('time render', ({a: {eq}}) => {
  eq(renderTruncHrTime([0, 0]), "0.00000ms");
  eq(renderTruncHrTime([0, 1]), "0.00000ms");
  eq(renderTruncHrTime([0, 10]), "0.00001ms");
  eq(renderTruncHrTime([0, 100]), "0.00010ms");
  eq(renderTruncHrTime([0, 999]), "0.00100ms");
  eq(renderTruncHrTime([0, 994]), "0.00099ms");
  eq(renderTruncHrTime([0, 995]), "0.00100ms");
  eq(renderTruncHrTime([0, 1_000]), "0.00100ms");
  eq(renderTruncHrTime([0, 100_000]), "0.10000ms");
  eq(renderTruncHrTime([0, 1_000_000]), "1.00000ms");
  eq(renderTruncHrTime([0, 10_000_000]), "10.0000ms");
  eq(renderTruncHrTime([0, 100_000_000]), "100.000ms");
  eq(renderTruncHrTime([0, 1_000_000_000]), "1000.00ms");
  eq(renderTruncHrTime([0, 9_000_000_000]), "9000.00ms");
  eq(renderTruncHrTime([0, 10_000_000_000]), "10.00000s");
  eq(renderTruncHrTime([0, 100_000_000_000]), "100.0000s");
  eq(renderTruncHrTime([0, 100_000_000_000_000]), "100000.0s");
  eq(renderTruncHrTime([0, 1_000_000_000_000_000]), "1000000 s");
  eq(renderTruncHrTime([10_000_000 - 1, 0]), "9999999 s");
  eq(renderTruncHrTime([10_000_000, 0]), "10000000s");
  eq(renderTruncHrTime([100_000_000 - 1, 0]), "99999999s");
});

export const renderTruncHrSanityCheckStrlenExhaustive = test('time render', ({l, a: {eq}}) => {
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

  // Example Usage
  for (const num of iterateFloatsInRangeRandomRandom(1e-300, 1e-299)) eq(renderTruncFromMs(num).length, 9);
  l('a');
  for (const num of iterateFloatsInRangeRandomRandom(0.00000001, 0.0000001)) eq(renderTruncFromMs(num).length, 9);
  l('b');
  for (const num of iterateFloatsInRangeRandomRandom(0.001, 0.0010001)) eq(renderTruncFromMs(num).length, 9);

  l('count seen', count);
});

function renderPercentage(num: number, l?: (...args: any[]) => void) {
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

export const renderPercentageChecks = test('time render', ({l, a: {eq}}) => {
  eq(renderPercentage(0, l),         "0.000%");
  eq(renderPercentage(0.1, l),       "10.00%");
  eq(renderPercentage(0.01, l),      "1.000%");
  eq(renderPercentage(0.001, l),     "0.100%");
  eq(renderPercentage(0.0001, l),    "0.010%");
  eq(renderPercentage(0.00001, l),   ".0010%");
  eq(renderPercentage(0.000001, l),  ".0001%");
  eq(renderPercentage(0.0000001, l), ".0000%");
  
  eq(renderPercentage(-0.5, l),      "-50.0%");

  eq(renderPercentage(0.2, l),       "20.00%");
  eq(renderPercentage(0.3333, l),    "33.33%");
  eq(renderPercentage(0.5, l),       "50.00%");
  eq(renderPercentage(0.89, l),      "89.00%");
  eq(renderPercentage(0.999, l),     "99.90%");
  eq(renderPercentage(0.9999, l),    "99.99%");
  eq(renderPercentage(0.99994, l),   "99.99%");
  eq(renderPercentage(0.99995, l),   "100.0%");
  eq(renderPercentage(0.99999, l),   "100.0%");
  eq(renderPercentage(0.999999, l),  "100.0%");
  eq(renderPercentage(1, l),         "100.0%");
  eq(renderPercentage(2, l),         "200.0%");
  eq(renderPercentage(2.001, l),     "200.1%");
  eq(renderPercentage(2.0007, l),    "200.1%");
  eq(renderPercentage(10, l),        "1000 %");
  eq(renderPercentage(99.99, l),     "9999 %");
  eq(renderPercentage(199.99, l),    "19999%");

  eq(renderPercentage(0.09999, l),    "9.999%");
  eq(renderPercentage(0.099994, l),   "9.999%");
  eq(renderPercentage(0.099996, l),   "10.00%");
  eq(renderPercentage(0.0999950001, l), "10.00%");
  // this is some weird ieee754 limitation, it won't round up even when I expect it should.
  eq(renderPercentage(0.099995, l),   "9.999%");
});

export const renderPercentageGenerative = test('time render', ({a: {eq}}) => {
  for (let i = 0; i < 100000; i++) {
    const num = Math.random();
    const scale = 10 ** (Math.ceil(Math.random() * 6) - 4);
    const perc = num * scale;
    const str = renderPercentage(perc);
    eq(str.length, 6);
    eq(str[5], '%');
  }
});

export type TestLogs = [[number, number], string][];
export type TestAssertionMetrics = {
  logs: {
    [key in AssertionName]?: {
      ringBufferOffset?: number; // undefined: keep using as array (continue to push). number: index into the array now used as ring buffer
      buffer: [[number, number], string][];
    }
  },
  assertionCounts: {
    [key in AssertionName]?: number;
  };
  assertionFailure: boolean;
};
export type TestResult = {
  durationMs: number;
  name: string;
  file: string;
  logs: TestLogs;
  assertionMetrics: TestAssertionMetrics;
  cpu: {
    user: number;
    system: number;
  };
  stack?: string;
  suite?: string;
  failure?: false | Error;
  finalMemSample?: NodeJS.MemoryUsage;
} & TestOptions;

const results: TestResult[] = [];

export const submitResult = (result: TestResult) => {
  results.push(result);
  writeResultToDisk(result); // no need to await
};

export const clearResults = () => {
  results.length = 0;
}

export const getResults = () => results;

function splitString(str: string, n: number, zero_width_starts: number[], zero_width_lengths: number[]) {
  const result: string[] = [];
  let j = 0 // iterates zw items
  for (let i = 0; i < str.length;) {
    let nn = n;
    for (; zero_width_starts[j] < i + nn; j++) {
      nn += zero_width_lengths[j];
    }
    result.push(str.slice(i, i + nn));
    i += nn;
  }
  return result;
}
export const splitStringBasic = test('splitString', ({a: {eqO}}) => {
  const str = "1234567890abc";
  const split = splitString(str, 5, [], []);
  eqO(split, ["12345", "67890", "abc"]);
  const str2 = "foo\x1b[31mbar\x1b[mbaz abc def ghi jkl mno pqr";
  const ansi2 = convertAnsiHtml(str2);
  const split2 = splitString(str2, 8, ansi2.idxs[0], ansi2.lens[0]);
  eqO(split2, ["foo\x1b[31mbar\x1b[mba", "z abc de", "f ghi jk", "l mno pq", "r"]);
  const str3 = "foobarba\x1b[31mz abc def gh\x1b[mi jkl mno pq\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[m\x1b[mr";
  const ansi3 = convertAnsiHtml(str3);
  const split3 = splitString(str3, 5, ansi3.idxs[0], ansi3.lens[0]);
  eqO(split3, ['fooba',
  'rba\x1B[31mz ',
  'abc d',
  'ef gh',
  '\x1B[mi jkl',
  ' mno ',
  'pq\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[m\x1B[mr']);
});

export const splitStringHardcoreBoundsCheck = test('splitString', ({l, a: {eq, is}}) => {
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
    for (let j = 0; j < str.length; j+= Math.ceil((Math.random() * Math.random()) * 40)) {
      const ansi_code_rand = ansi_code_set[Math.floor(Math.random() * ansi_code_set.length)];
      combined += str.slice(lastJ, j) + '\x1b[' + ansi_code_rand + 'm';
      lastJ = j;
    }
    const a = convertAnsiHtml(combined);
    for (let j = 3; j < 80; j += Math.ceil(Math.random() * Math.random() * (10 + j/4))) {
      const split = splitString(combined, j, a.idxs[0], a.lens[0]);
      eq(split.join(''), combined);
      is(split.every((s, i) => convertAnsiHtml(s).cleaned[0].length === j || (i === split.length - 1 && convertAnsiHtml(s).cleaned[0].length === a.cleaned[0].length % j)));
      count_checks+= split.length + 1;
    }
    // console.log(util.inspect(split.map((s, i) => { const a = convertAnsiHtml(s); return {s, a, l: a.cleaned[0].length }; }), { colors: true, depth: Infinity, compact: true }));
  }
  l('checks performed:', count_checks);
});

// - simpler interface, just give multiline str
// - works out wrapped line indentation ahead of time, it helps readability
// - works out ansi escape code styling continuation in wrapped lines
function fancySplitString(str: string, horizLimit: number) {
  // note, assumes robust splitString functionality as guaranteed by stringent unit testing above. There will be a
  // significant amount of styling and extra characters inserted based on wrap width.
  
}

const drawBorder = (content: string, heading_summary: string) => {
  const ansi = convertAnsiHtml(content);
  const maxContentWidth = Math.max(...ansi.cleaned.map(line => line.length));

  const left_margin = '┃';
  const horiz_padding = ' '; // not border styled
  const right_margin = '┃';
  const horiz_margin_tot = left_margin.length + right_margin.length + 2 * horiz_padding.length;

  let horizLimit = 78; // a sane default
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // Do a bit of formatting. Mostly to implement wrapping within the border. And handle correct line deletion amount
    // for re-rendering.
    const horizontal = process.stdout?.columns;
    horizLimit = horizontal - horiz_margin_tot; // for border
  }

  const working_width = Math.min(maxContentWidth, horizLimit);
  const width_tot = working_width + horiz_margin_tot;

  // perform wrapping on raw content, must handle ansi codes as zerolength
  const wrapped_nested = content.split('\n').map((line, i) => ansi.cleaned[i].length > horizLimit ? splitString(line, horizLimit, ansi.idxs[i], ansi.lens[i]) : line); // Array made of both strings (lines, not long enough to wrap) and inner arrays (which are wrapped lines).
  // the last entry in each wrapped line is the only one out of those that needs to be padded with spaces to the right.

  // build lengths in same shape first
  const lengths = wrapped_nested.map((e, i) => Array.isArray(e) ? [ ...Array(e.length - 1).fill(horizLimit), ansi.cleaned[i].length % horizLimit ] : ansi.cleaned[i].length);
  // console.log('wrapped_nested, lengths, w_t, hL, mCW:', wrapped_nested, lengths, width_tot, horizLimit, maxContentWidth);

  const border_style = colors.medium_grey_bg + colors.yellow;
  const heading = ` Test Results (${heading_summary}) `;
  const corners = '┏┓┗┛';
  const heading_padding = '━'; // repeated in the heading border
  const heading_full_width = heading_padding.repeat(Math.ceil(width_tot / heading_padding.length)).slice(0, width_tot - 2);
  const heading_left_len = Math.floor((width_tot - heading.length) / 2) - 1;
  const heading_right_len = width_tot - heading_left_len - heading.length - 2; // 2 because above var has 1 subtracted
  const heading_left = corners[0] + heading_full_width.slice(0, heading_left_len);
  const heading_right = heading_full_width.slice(0, heading_right_len) + corners[1];
  const heading_line = border_style + heading_left + colors.bold + heading + colors.bold_reset + heading_right + colors.reset;
  const bottom_line = border_style + corners[2] + heading_full_width + corners[3] + colors.reset;
  let output = heading_line;
  const wnf = wrapped_nested.flat();
  const lf = lengths.flat();
  output += '\n' + (wnf.map((l, i) => border_style + left_margin + colors.reset + horiz_padding + l + ' '.repeat(working_width - lf[i]) + horiz_padding + border_style + right_margin + colors.reset).join('\n'));
  output += '\n' + bottom_line;
  return output;
}

const cpuUtil = (durationMs: number, userUs: number, systemUs: number) => {
  const totalUs = userUs + systemUs;
  const totalMs = totalUs / 1000;
  const cpu = totalMs / durationMs;
  const user = userUs / totalUs;
  const system = systemUs / totalUs;
  return { cpu, user, system };
}

export const renderResults = (output_receiver = console.log) => {
  const config = getConfig();
  const expand = config.get('test_reporting_expand_suites');
  const output: string[] = [];
  const groupBySuite = new Map<string, TestResult[]>();
  for (const result of results) {
    // sanity assertion
    if (!result.name) {
      throw new Error(`(Likely a test execution related import sequencing problem) ${red("Missing name")} from this test: ${pp(result)}`);
    }
    const suite = result.suite || '';
    const existing = groupBySuite.get(suite) || groupBySuite.set(suite, []).get(suite) as TestResult[];
    existing.push(result);
  }
  let first_failed_test: TestResult | undefined;
  for (const [ suite, res ] of Array.from(groupBySuite.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const res_sorted = res.sort((a, b) => a.name.localeCompare(b.name));
    const failed_tests = res_sorted.filter(r => r.failure);
    if (!first_failed_test && failed_tests.length) {
      first_failed_test = failed_tests[0];
    }
    const passed_count = res.length - failed_tests.length;
    const suite_summary_color = failed_tests.length ? (passed_count ? colors.yellow : colors.red) : colors.green;
    const prefix_string = suite_summary_color + (failed_tests.length ? 'Passed ' : 'PASSED ');
    const space_prefix_string = suite_summary_color + ' ' + (failed_tests.length ? 'Passed ' : 'PASSED ');
    const out_of_string = failed_tests.length ? " out of " + suite_summary_color + res.length + colors.reset : '';
    // has leading space
    const test_s_out_of_suite_string = ` test${passed_count === 1 ? '' : 's'}${out_of_string} in suite '${suite}'`;
    const pass_char = "✔";
    const fail_char = "✘";
    if (suite === '') { }
    else if (expand) {
      output.push(prefix_string + passed_count + colors.reset + test_s_out_of_suite_string + ':');
    } else {
      const ct = res_sorted.reduce((acc, r) => {
        acc[r.failure ? 'f' : 'p']++;
        return acc;
      }, { p: 0, f: 0 });
      // has leading space
      const indicators = (ct.f ? colors.red + ' ' +  fail_char.repeat(ct.f) + ' ' : '') + (ct.p ? colors.green + ' ' + pass_char.repeat(ct.p) + ' ' : '');
      const duration = sum(res.map(r => r.durationMs));
      output.push(`${renderTruncFromMs(duration)} ${renderPercentage(cpuUtil(duration, sum(res.map(r => r.cpu.user)), sum(res.map(r => r.cpu.system))).cpu)} ` + colors.reverse + space_prefix_string + passed_count + ' ' + colors.reset + ' ' + colors.reverse + indicators + colors.reset + test_s_out_of_suite_string);
    }
    const results_to_show = (suite === '' || expand) ? res_sorted : failed_tests;
    for (const { durationMs, name, file, stack, failure, cpu } of results_to_show) {
      output.push(`${renderTruncFromMs(durationMs)} ${renderPercentage(cpuUtil(durationMs, cpu.user, cpu.system).cpu)} ${colors[failure ? 'red' : 'green'] + colors.reverse + (failure ? ` ${fail_char} FAIL ` : ` ${pass_char} PASS `) + colors.reset} ${name} ${colors.dim + stack + colors.bold_reset}`);
    }
  }

  output_receiver(drawBorder(output.join('\n'), results.length + ' tests in ' + groupBySuite.size + ' suites'));

  // We also render out at the end the outputs of the first of the failed tests. This is almost always what is desired
  // in practice. only showing one helps us to focus on it and putting it at the end gives the best chance of keeping it all visible.
  if (first_failed_test) {
    output_receiver(colors.red + colors.bold + `Reporting on failed test ${colors.magenta + (first_failed_test.suite ? colors.italic + first_failed_test.suite + colors.italic_reset + ":" : '') + colors.underline + first_failed_test.name + colors.underline_reset} ${colors.fg_reset + colors.bold_reset + colors.dim + first_failed_test.stack + colors.bold_reset}`); 
    first_failed_test.logs.forEach(([time, log]) => output_receiver(time, log));
    // report the assertions leading up to the failed one
    if (first_failed_test.assertionMetrics.assertionFailure) {
      // dump out all the assertion logs that we have. It's turning out the switch over to the ring buffer is more for
      // saving memory consumption and output verbosity than it is for saving time.
      const { logs } = first_failed_test.assertionMetrics;
      // TODO do a merge print to get the logs across assertion types in chronological order.
      // for now just print the number of logs we appear to have captured 
      output_receiver('Assertion logs captured:', Object.entries(logs).map(([a, v]) => a + ': ' + v.buffer.length));
    }
    output_receiver('Test failure due to exception:', first_failed_test.failure);
    process.exitCode = 55; // mark exit code as failure (55 is arbitrary), still intend to exit cleanly by closing outstanding event listeners
    // note test watch launch still wouldnt actually exit until user interactively quits.
  } else {
    process.exitCode = 0;
  }
};

// a trivial test that is used as a guinea pig for the following test to easily control whether it fails or not
export const simpleFileExists = test('test fails', ({l, a: {eq}}) => {
  const projDir = path.resolve(__dirname, '..', '..');
  l('projDir:', projDir);
  eq(false, fs.existsSync(path.resolve(projDir, 'some-file.fail')));
});

// also tests the test specification file filter, test launching itself, etc.
export const specialExitCodeWasSetOnTestFailure = test('test fails', async ({l, a: {eq}}) => {
  // need to launch test runner to confirm failing test (failing for real) sets an exit code.
  let projDir = path.resolve(__dirname, '..')
  // launch this with node under build/, even if executing under raw typescript. Should be the most robust approach.
  const dirname = projDir.split(path.sep).pop();
  if (dirname !== 'build') {
    eq('src', dirname);
    projDir = path.resolve(projDir, '..', 'build');
  }
  eq('build', projDir.split(path.sep).pop());
  // go make the test fail
  execSync('touch ' + path.resolve(projDir, '..', 'some-file.fail'));
  // launch from built tree, in no frills mode (e.g. without source-map-support) (BE SURE TO ONLY LAUNCH A SUBSET OF
  // TESTS, if launching THIS SAME OWN TEST it will infinite loop.)
  // TODO change the test launch filename filter to be derived and not hardcoded
  try {
    eq((await spawnAsync(
      'node', [path.join(projDir, 'test', 'runner.js'), 'test/render-test-results.js', '__', 'simpleFileExists'],
      l, { doNotRejectOnFail: true }
    )).code, 55);
  } finally {
    execSync('rm ' + path.resolve(projDir, '..', 'some-file.fail'));
  }
});

export const test_failure_assertion_log_correctness = test('test fails', ({l, t, a: {eq, eqO}, m}) => {
  const eqBuf = (mm: ReturnType<typeof m>) => mm.assertionMetrics.logs.eq?.buffer;
  eq(2, 2);
  const m1 = m();
  eq(eqBuf(m1)?.length, 1);
  eq(eqBuf(m1)?.[0][1], '[2,2]');

  new Array(1000).fill(null).forEach((_, i) => eq(i, i));

  const m2 = m();
  eq(eqBuf(m2)?.length, 1003); // must count the two assertions we made above ;) This test is entertainingly self-referential like this.
  eq(eqBuf(m2)?.[458][1], '[455,455]');

  t('ringBufferLimitAssertionLogs', 50);
  const m3 = m();
  eq(eqBuf(m3)?.length, 1005); // as we haven't made any more assertions so the resize for ring buffer should not have taken place
  // It is at this exact point that now we have resized the ring buffer and the oldest logs purged.
  // Note this insertion of 1005 also is the initial ring buffer wrap value!
  const m4 = m();
  eq(eqBuf(m4)?.length, 50); // sanity check. this check wont make it into the m4 ring buffer snapshot.
  eq(m4.assertionMetrics.logs.eq?.ringBufferOffset, 1); // confirm have wrapped and is set to insert in position 1 next.

  // to confirm the content we'll need to consider all the stuff that's taken place till the last metrics snapshot:
  // We had 3 eq assertions made since we resized to 50. The last of which was wrapped back.
  eqO(eqBuf(m4)?.slice(48).map(log => log[1]), ["[1003,1003]",'["[455,455]","[455,455]"]']);
  eq(eqBuf(m4)?.[0][1], '[1005,1005]');
  eqBuf(m4)?.slice(1,48).forEach((log, i) => eq(log[1], `[${i + 953},${i + 953}]`, i));
});

// TODO make more in depth testing to confirm the ring buffer behaviors

// TODO a test to confirm some side effects like memory consumption due to storage of test logs and test assertion
// logs. and confirming they plateau properly when the ring buffer is engaged. Maybe even to check that engaging ring
// buffer in the middle of the test can drop memory consumption. Eventually... GC is not deterministic. However we
// could certainly make a test that either only engages and does its check when launched with --expose-gc or, does
// that, AND launches a test in a subprocess where node is launched with that flag for us. since we can easily do test
// inception at this point anyway.

const writeResultToDisk = async (result: TestResult) => {
  let p = getTestReportingPath();
  if (!p) { throw new Error('current_test_reporting_session_path not set.'); }
  if (result.suite) {
    p = p.slice(0);
    p.push(result.suite);
  }
  await fsp.mkdir(path.resolve(...p), { recursive: true });
  await fsp.writeFile(path.resolve(...p, result.name + '.json'), JSON.stringify(result, null, 2));
};
// a bit silly but the same date string used to identify a given test run can be extracted out of this.

export const getTestReportingPath = () => current_test_reporting_session_path;
// i think we are fine with this as a singleton for now, it is updated on each launch and used by all test reporting

export let current_test_reporting_session_path: string[] | undefined;
export async function establishTestResultsDir() {
  const date = new Date().toISOString().replace(/:/g, '_');
  const p = ['test-results', date];
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  current_test_reporting_session_path = p;
  await cleanup_old_results(path.resolve('test-results'));
}
const keep_results_for_days = 3;
export const cleanup_old_results = async (dir: string) => await spawnAsync('find', [dir, '-maxdepth', '1', '-type', 'd', '-mtime', '+' + keep_results_for_days, '-exec', 'echo', 'deleting old test results dir {}', ';', '-exec', 'rm', '-rf', '{}', ';'], console.error);

