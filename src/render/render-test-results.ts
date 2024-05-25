import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { spawnAsync } from '../process.js';
import { colors, renderHorizBar } from 'ts-utils/terminal';
import { groupBy, pp, red, sum, underline } from 'ts-utils';
import { build_html } from "../plotting/index.js";
import { ResourceMetrics, TestResult } from "../types.js";
import { renderPercentage, renderTruncFromMs } from "../util.js";
import { clearTestResultPages, pushTestResultPage } from "../web-server.js";
import { renderBorder } from "./border.js";
import { LaunchOptions } from "../config/launchOptions.js";
import { Simplify } from "type-fest";

// const results: TestResult[] = [];

export const recordResults = (results: TestResult[]) => {
  for (const result of results) {
    writeResultToDisk(result).catch(e => { console.error('error writing test result to disk!'); throw e; }); // no need to await
  }
};

const cpuUtil = (durationMs: number, userUs: number, systemUs: number) => {
  const totalUs = userUs + systemUs;
  const totalMs = totalUs / 1000;
  const cpu = totalMs / durationMs;
  const user = userUs / totalUs;
  const system = systemUs / totalUs;
  return { cpu, user, system };
}

type MakeRequired<T, K extends keyof T> = T extends unknown ? Omit<T, K> & Required<Pick<T, K>> : never;
type ResourceMetricsWithResources = Simplify<MakeRequired<ResourceMetrics[0], 'resources'>>[];

export const renderResults = (results: TestResult[], TotalExecutionTimeMsReference: number, launch_options: LaunchOptions, only_print_table = false, output_receiver = console.log) => {
  const expand = launch_options.expand_test_suites_reporting;
  const output: string[] = [];
  const groupBySuite = new Map<string, TestResult[]>();
  for (const result of results) {
    // sanity assertion
    if (!result.name) {
      throw new Error(`(Likely a test execution related import sequencing problem) ${red("Missing name")} from this test: ${pp(result)}`);
    }
    const suite = result.suite || '';
    const existing = groupBySuite.get(suite) || groupBySuite.set(suite, []).get(suite);
    existing.push(result);
  }
  let first_failed_test: TestResult | undefined;
  // this duration total is the time the tests take to run in isolation, but the reference total time is the wall time
  // taken to execute everything that we're displaying here even when parallel/distributed.
  // one bar will be drawn to show the ratio between wall time and total test execution time.
  const totalDuration = sum(results.map(r => r.durationMs));
  // we will draw one bar for each test/suite, for tests, its going to be the ratio of runtime to the longest test
  // for suites, it's the ratio of runtime to 
  const maxDuration = Math.max(...results.map(r => r.durationMs));
  const maxSuiteDuration = Math.max(...Array.from(groupBySuite.values()).map(r => sum(r.map(rr => rr.durationMs))));
  for (const [ suite, res ] of Array.from(groupBySuite.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const res_sorted = res.sort((a, b) => a.name.localeCompare(b.name));
    const failed_tests = res_sorted.filter(r => r.failure);
    if (!first_failed_test && failed_tests.length) {
      first_failed_test = failed_tests[0];
    }
    const passed_count = res.length - failed_tests.length;
    const suite_summary_color = failed_tests.length ? (passed_count ? colors.yellow : colors.red) : colors.green;
    const prefix_string = suite_summary_color + (failed_tests.length ? 'Passed ' : 'PASSED ');
    const space_prefix_string = `${suite_summary_color} ${failed_tests.length ? 'Passed ' : 'PASSED '}`;
    const out_of_string = failed_tests.length ? ` out of ${suite_summary_color}${res.length}${colors.reset}` : '';
    // has leading space
    const test_s_out_of_suite_string = ` test${passed_count === 1 ? '' : 's'}${out_of_string} in suite '${suite}'`;
    const pass_char = "✔";
    const fail_char = "✘";
    if (suite === '') { }
    else if (expand) {
      output.push(`${prefix_string + passed_count + colors.reset + test_s_out_of_suite_string}:`);
    } else {
      const ct = res_sorted.reduce((acc, r) => {
        acc[r.failure ? 'f' : 'p']++;
        return acc;
      }, { p: 0, f: 0 });
      // has leading space
      const indicators = (ct.f ? `${colors.red} ${fail_char.repeat(ct.f)} ` : '') + (ct.p ? `${colors.green} ${pass_char.repeat(ct.p)} ` : '');
      const duration = sum(res.map(r => r.durationMs));
      output.push(`${renderHorizBar(duration/maxSuiteDuration)} ${renderTruncFromMs(duration, 5)} ${renderPercentage(cpuUtil(duration, sum(res.map(r => r.cpu.user)), sum(res.map(r => r.cpu.system))).cpu)} ${colors.reverse}${space_prefix_string}${passed_count} ${colors.reset} ${colors.reverse}${indicators}${colors.reset}${test_s_out_of_suite_string}`);
    }
    const results_to_show = (suite === '' || expand) ? res_sorted : failed_tests;
    for (const { durationMs, name, async, stack, failure, cpu, finalMemSample, resourceMetrics } of results_to_show) {
      // combine self and spawned cpu usage
      const rmr = resourceMetrics.filter(r => r.resources) as ResourceMetricsWithResources;
      const maxrss_spawned = rmr.map(r => r.resources.maxrss).reduce((a, b) => b > a ? b : a, 0);
      const maxrss_self = (finalMemSample ?? 0) / 1024;
      // cpu times in s!
      const spawnCount = resourceMetrics.length;
      const spawnWithRecMeasurement = rmr.length;
      const cpuUser_spawned = rmr.map(r => r.resources.user).reduce((a, b) => a + b, 0);
      const cpuSys_spawned = rmr.map(r => r.resources.sys).reduce((a, b) => a + b, 0);
      const cpuUser_self = cpu.user/1e6;
      const cpuSys_self = cpu.system/1e6;
      const wall_spawned = rmr.map(r => r.resources.wall).reduce((a, b) => a + b, 0);
      const wall_self = durationMs / 1000;
      const maxRss = spawnCount ? [maxrss_self, maxrss_spawned] : [maxrss_self];
      const cpuTimes = (spawnCount ? [wall_self, cpuUser_self, cpuSys_self, wall_spawned, cpuUser_spawned, cpuSys_spawned] : [wall_self, cpuUser_self, cpuSys_self]).map(n => n.toFixed(2));
      const oldDisplay = renderPercentage(cpuUtil(durationMs, cpu.user, cpu.system).cpu);

      // data we may want to show: 
      // - memory consumption total and fraction self/spawned. Maybe only makes sense if only running one test... maybe
      // show anyway though to help gain intuition for how GC takes place.
      // - cpu util percent taking everything into account
      // - spawn count and how many were actually measured, if not the same

      const cpuUtilAll = renderPercentage((cpuSys_self + cpuUser_self + cpuSys_spawned + cpuUser_spawned) / durationMs * 1000);

      output.push(`${renderHorizBar(durationMs / maxDuration, 5)} ${renderTruncFromMs(durationMs, 7)} ${cpuUtilAll} ${colors[failure ? 'red' : 'green'] + colors.reverse + (failure ? ` ${fail_char} FAIL ` : ` ${pass_char} PASS `) + colors.reset} ${async ? underline(name) : name} ${colors.dim + stack + colors.bold_reset} ${spawnCount ? spawnWithRecMeasurement !== spawnCount ? `${spawnCount} (${spawnWithRecMeasurement}): ` : `${spawnCount}: ` : ''}${maxRss.join(',')} ${cpuTimes.join(',')}`);
    }
  }

  output_receiver(renderBorder(output.join('\n'), `${results.length} tests in ${groupBySuite.size} suites`));

  const isOnlyConsistingOfNonSuiteTests = groupBySuite.size === 1 && groupBySuite.has('');
  if (expand === 'both' && !isOnlyConsistingOfNonSuiteTests) {
    output_receiver(''); // for a newline to separate two tables
    renderResults(results, TotalExecutionTimeMsReference, { ...launch_options, expand_test_suites_reporting: false }, true, output_receiver);
  }
  if (only_print_table) {
    return;
  }

  // We also render out at the end the outputs of the first of the failed tests. This is almost always what is desired
  // in practice. only showing one helps us to focus on it and putting it at the end gives the best chance of keeping it all visible.
  if (first_failed_test) {
    output_receiver(`${colors.red + colors.bold}Reporting on failed test ${colors.magenta + (first_failed_test.suite ? `${colors.italic + first_failed_test.suite + colors.italic_reset}:` : '') + underline(first_failed_test.name)} ${colors.fg_reset + colors.bold_reset + colors.dim + first_failed_test.stack + ' in ' + getTestReportingPath().slice(-1)[0] + colors.bold_reset}`); 
    for (const [time, log] of first_failed_test.logs) { output_receiver(time, log); }
    // report the assertions leading up to the failed one
    if (first_failed_test.assertionMetrics.assertionFailure) {
      // dump out all the assertion logs that we have. It's turning out the switch over to the ring buffer is more for
      // saving memory consumption and output verbosity than it is for saving time.
      const { logs } = first_failed_test.assertionMetrics;
      // TODO do a merge print to get the logs across assertion types in chronological order.
      // for now just print the number of logs we appear to have captured 
      output_receiver('Assertion instance counts captured:', Object.entries(logs).map(([a, v]) => `${a}: ${v?.buffer.length}`));
    }
    output_receiver('Test failure due to exception:', first_failed_test.failure);
    process.exitCode = 55; // mark exit code as failure (55 is arbitrary), still intend to exit cleanly by closing outstanding event listeners
    // note test watch launch still wouldnt actually exit until user interactively quits.
  } else {
    process.exitCode = 0;
  }

  // seems questionable to do this here instead of calling it separately but we can move it later.
  produceHtmlTestResults(results);
};

function produceHtmlTestResults(results: TestResult[]) {
  clearTestResultPages();
  for (const result of results) {
    for (const [group, embeds] of Object.entries(groupBy(result.embeds, 'group_id'))) {
      // Each test can produce zero, one or more html pages. the embeds can be established in any order, but group_id is used to group
      // into pages. 
      // console.error('group', group);
      const pages = build_html(embeds);
      for (const page of pages) {
        // TODO probably going to be fleshing out more code for integrating into these. But for now, will just do this in a dirty quick way.
        const script_to_inject_nav_if_applicable = `if (/^http:\\/\\/localhost/.test(location.href)) {
const el = document.createElement('div');
el.innerHTML = '<a href="..">Back</a>';
document.body.appendChild(el);
}`;
        const pg = Object.values(page).join('\n').replace('</body>', `</body><script>${script_to_inject_nav_if_applicable}</script>`);
        pushTestResultPage((result.suite ? result.suite + ':' : '') + result.name + (group ? ': ' + group : ''), pg);
      }
    }
  }
}

// TODO make more in depth testing to confirm the ring buffer behaviors

// TODO a test to confirm some side effects like memory consumption due to storage of test logs and test assertion
// logs. and confirming they plateau properly when the ring buffer is engaged. Maybe even to check that engaging ring
// buffer in the middle of the test can drop memory consumption. Eventually... GC is not deterministic. However we
// could certainly make a test that either only engages and does its check when launched with --expose-gc or, does
// that, AND launches a test in a subprocess where node is launched with that flag for us. since we can easily do test
// inception at this point anyway.

const writeResultToDisk = async (result: TestResult) => {
  const p = getTestReportingPath();
  // ln('parallel test launch', 'debug wRTD p', p);
  if (!p) { throw new Error('current_test_reporting_session_path not set.'); }
  if (result.suite) {
    p.push(result.suite);
  }
  await fsp.mkdir(path.resolve(...p), { recursive: true });
  await fsp.writeFile(path.resolve(...p, `${result.name}.json`), JSON.stringify(result, null, 2));
};

// when we save results for each test (immediately after running them) we compress the json result into files in the test reporting path.
// At some later interval, recompress the historical data to crunch it down more since it will have a lot of
// repetition.
// employing compression will drastically reduce disk thrash.
export function recompressResults() {
  const p = getTestReportingPath();
  // do a sanity check 
}

// another concept is to heuristically detect dumps of extensive listings of floating point values. Think about what
// heuristics i can apply to manipulate or tie back to code when encountering this kind of data to avoid recording it.

export const getTestReportingPath = () => current_test_reporting_session_path?.slice();
// i think we are fine with this as a singleton for now, it is updated on each launch and used by all test reporting

export let current_test_reporting_session_path: string[] | undefined;
export async function establishTestResultsDir(skip_cleanup = false) {
  const date = new Date().toISOString().replace(/:/g, '_');
  const p = ['test-results', date];
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  current_test_reporting_session_path = p;
  if (!skip_cleanup) {
    await cleanup_old_results(path.resolve('test-results'));
  }
}

const keep_results_for_days = 3;
export const cleanup_old_results = async (dir: string) => {
  // - checking mtime of test-results run dir suffices here but won't in the general case, beware
  // - recursion by find must be stopped so as not to fail due to attempting to traverse just-deleted dirs
  // - this is a hack to bring multiple dir removals under one process call
  const findArgs = [dir,
    '-maxdepth', '1', // only nuke at test dispatch granularity
    '-mindepth', '1', // so we dont delete the current run dir
    '-type', 'd',
    '-mtime', `+${keep_results_for_days}`,
    '-exec', 'echo', 'deleting old test results dir {}', ';',
    '-exec', 'rm', '-rf', '{}', ';'
  ];
  fs.existsSync(dir) && await spawnAsync('find', findArgs, console.error);
}

