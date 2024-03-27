import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parseFileLineColFromStackLineMakeHyperlink, test } from '../main.js';
import { fileURLToPath } from 'url';
import { TestLaunchFlags, TestLaunchSeparator } from "../dispatch/flags.js";
import { timedMs } from 'ts-utils';
import { deepStrictEqual } from 'assert';
import equal from 'deep-equal';
const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

// a trivial test that is used as a guinea pig for the following test to easily control whether it fails or not
export const simpleFileExists = test('test', ({ l, a: { eq } }) => {
  const projDir = path.resolve(__dirname, '..');
  l('projDir:', projDir);
  eq(false, fs.existsSync(path.resolve(projDir, 'some-file.fail')));
});

// useful helper for performing inception
const getBuildProjDir = () => {
  let projDir = path.resolve(__dirname, '..');
  let x = '';
  while (x = projDir.split(path.sep).pop(), x !== 'build' && x !== 'src') {
    projDir = path.resolve(projDir, '..');
  }
  // console.error('debug projDir:', projDir);
  return projDir;
};
// by virtue of being an inception test (executes test runner), also tests the test specification file filter, test launching itself, etc.
export const specialExitCodeSetOnFailureInception = test('test', async ({ l, spawn, a: { eq } }) => {
  // need to launch test runner to confirm failing test (failing for real) sets an exit code.
  // launch this with node under build/, even if executing under raw typescript. Should be the most robust approach.
  const projDir = getBuildProjDir();
  // go make the test fail
  execSync(`touch ${path.resolve(projDir, 'some-file.fail')}`);
  // launch from built tree, in no frills mode (e.g. without source-map-support) (BE SURE TO ONLY LAUNCH A SUBSET OF
  // TESTS, if launching THIS SAME OWN TEST it will infinite loop.)
  // TODO change the test launch filename filter to be derived and not hardcoded
  try {
    eq((await spawn(
      'node', [path.join(projDir, 'dispatch', 'runner.js'), TestLaunchFlags.ExactTestNameMatching, 'tests/self.js', TestLaunchSeparator, 'test:simpleFileExists'],
      { doNotRejectOnFail: true }
    )).code, 55);
  } finally {
    execSync(`rm ${path.resolve(projDir, 'some-file.fail')}`);
  }
});

export const trivial_failure = test('test fails', async ({ t }) => {
  t('fails', true);
  throw new Error('intentional fail');
});

export const trivial_failure2 = test('test fails', ({ t }) => {
  t('fails', 'intentional');
  throw new Error('intentional fail');
});

export const trivial_failure3 = test('test fails', ({ t }) => {
  t('fails', /intentional fail/);
  throw new Error('intentional failure');
});
// note this has a footgun i ran into, if you call throws from a sync function, there won't be proper handling.

export const throwing = test('test fails', async ({ l, t, a: { throwsA } }) => {
  t('fails', 'to throw');
  await throwsA(async () => { l('move along nothing to see here'); });
});

export const correct_assertion_count = test('test fails', ({ t, a: { eq } }) => {
  t('assertionCount', 2);
  eq(1, 1);
  eq(2, 2);
});
export const incorrect_assertion_count_should_fail = test('test fails', ({ t, a: { eq } }) => {
  // this tests the assertion count check is working. "fails" handling happens after assertion counting meta assertion
  // occurs.
  t('fails', true);
  t('assertionCount', 2);
  eq(1, 1);
});

export const zero_assertion_count_should_not_fail = test('test fails', ({ t }) => {
  t('assertionCount', 0);
});

export const assertionCount_overrides_exemption_from_asserting = test('test fails', ({ t }) => {
  t('assertionCount', 1);
  t('exemptFromAsserting', true);
  t('fails', true);
});

export const test_name_collision = test('same test name', ({ l, t }) => {
  t('exemptFromAsserting', true);
  l('test_name_collision from self');
});

export const test_failure_assertion_log_correctness = test('test fails', ({ t, a: { eq, eqO }, m }) => {
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
  eqO(eqBuf(m4)?.slice(48).map(log => log[1]), ["[1003,1003]", '["[455,455]","[455,455]"]']);
  eq(eqBuf(m4)?.[0][1], '[1005,1005]');
  eqBuf(m4)?.slice(1, 48).forEach((log, i) => eq(log[1], `[${i + 953},${i + 953}]`, i));
});

export const env_spawn = test('spawnAsync', async ({ spawn, a: { eq } }) => {
  let buf = '';
  await spawn('env', [], {
    env: { FOO_special_UNIQUE_very_SPECIFIC_env_VAR: 'should be in there' }, onstdout: (out) => {
      buf = buf + out;
    }
  });
  eq(1, buf.split('\n').filter(line => line === 'FOO_special_UNIQUE_very_SPECIFIC_env_VAR=should be in there').length);
});

export const spawn_return_code_matches = test('spawnAsync', async ({ spawn, a: { eq } }) => {
  eq(22, (await spawn('bash', ['-c', 'exit 22'], { bypassResourceMetrics: true, doNotRejectOnFail: true })).code);
  eq(23, (await spawn('bash', ['-c', 'exit 23'], { doNotRejectOnFail: true })).code);
  // not sure all combos of spawn return types are useful to test here but whatever
  eq(24, (await spawn('bash', ['-c', 'exit 24'], { bypassResourceMetrics: true, bufferStdout: true, doNotRejectOnFail: true })).code);
  eq(25, (await spawn('bash', ['-c', 'exit 25'], { bufferStdout: true, doNotRejectOnFail: true })).code);
});

export const resourceReportingBasic = test('spawnAsync', async ({ l, spawn, a: { gt, lt } }) => {
  const light_ret = await spawn('sleep', ['0.2']);
  const heavy_ret = await spawn('timeout', ['0.2', 'yes'], { ignoreStdinout: true, doNotRejectOnFail: true });
  l('rets', light_ret, heavy_ret);
  lt(light_ret.resources.user + light_ret.resources.sys, light_ret.resources.wall * 0.5);
  // gt(heavy_ret.resources.user + heavy_ret.resources.sys, heavy_ret.resources.wall * 0.5);
  gt(heavy_ret.resources.user + heavy_ret.resources.sys, light_ret.resources.user + light_ret.resources.sys);
});

export const resource_metrics_overlapping_spawns = test('spawnAsync', async ({ l, spawn, a: { eq, gt, lt } }) => {
  const start = process.hrtime();
  // 4 0.1s sleeps and two .05s yeses, all completes in 0.1s, average CPU consumption should be around 100%.
  const ret = await Promise.all([
    ...Array(2).fill(0).map(_i => spawn('timeout', ['0.05', 'yes'], {doNotRejectOnFail: true, ignoreStdinout: true})),
    ...Array.from({length: 4}).map(_i => spawn('sleep', ['0.1']))
  ]);
  const delta = process.hrtime(start);
  l(ret);
  // confirm the above roughly consumed 0.1 second
  eq(delta[0], 0);
  gt(delta[1], 0.09 * 1e9);
  // lt(delta[1], 0.15 * 1e9);
});

// Inception refers to wrapping the entire launch of the above test as a test, so we can evaluate the built-in
// resource metrics functionality
export const resource_metrics_overlapping_spawns_inception = test('test', async ({l, t, spawn}) => {
  // aim to confirm relevant data of 6 procs in above test are reflected in test report.
  const projDir = getBuildProjDir();
  const ret = await spawn('node', ['--enable-source-maps', path.join(projDir, 'dispatch', 'runner.js'), TestLaunchFlags.ExactTestNameMatching, TestLaunchFlags.Automated, 'tests/self.js', TestLaunchSeparator, 'resource_metrics_overlapping_spawns'], {
    bufferStdout: true
  });
  t('exemptFromAsserting', true);
  // if the output isnt good it won't parse, which would throw, so this constitutes a test.
  // TODO actually confirm something useful can be read out of this
  try {
    JSON.parse(ret.stdout);
  } catch (e) {
    l("Was attempting to parse", ret.stdout, "END ATTEMPTING TO PARSE");
    throw e;
  }
});

export const spawn_return_types = test('spawnAsync', async ({ spawn, a: { eq, is, not } }) => {
  const ret1 = await spawn('echo', ['hi']);
  const ret2 = await spawn('echo', ['hi'], {});
  const ret3 = await spawn('echo', ['hi'], { bypassResourceMetrics: true });
  const ret4 = await spawn('echo', ['hi'], { bypassResourceMetrics: true, bufferStdout: true });
  const ret5 = await spawn('echo', ['hi'], { bufferStdout: true });

  // biome-ignore lint/complexity/useLiteralKeys:
  not(ret1['stdout']);
  is(typeof ret1.resources === 'object');
  // biome-ignore lint/complexity/useLiteralKeys:
  not(ret2['stdout']);
  is(typeof ret2.resources === 'object');

  // biome-ignore lint/complexity/useLiteralKeys: <explanation>
  not(ret3['resources']);

  // biome-ignore lint/complexity/useLiteralKeys: <explanation>
  not(ret4['resources']);
  eq(ret4.stdout, 'hi\n');

  is(typeof ret5.resources === 'object');
  eq(ret5.stdout, 'hi\n');
});

export const resource_metrics_multi_grand_child_spawn = test('spawnAsync', async ({ spawn, a: { eq, lt } }) => {
  const start = process.hrtime();
  const bashScript = `timeout 0.1 yes & > /dev/null
timeout 0.1 yes & > /dev/null
timeout 0.1 yes > /dev/null`;
  await spawn('bash', ['-c', bashScript], { doNotRejectOnFail: true, ignoreStdinout: true });
  const delta = process.hrtime(start);
  eq(delta[0], 0);
  // lt(delta[1], 0.15 * 1e9);
});

// as comparison point against the other one
export const resource_metrics_multi_child_spawn = test('spawnAsync', async ({ l, spawn, a: { eq, gt, lt } }) => {
  const start = process.hrtime();
  await Promise.all([
    ...Array(3).fill(0).map(_i => spawn('timeout', ['0.1', 'yes'], {doNotRejectOnFail: true, ignoreStdinout: true})),
  ]);
  const delta = process.hrtime(start);
  eq(delta[0], 0);
  // lt(delta[1], 0.15 * 1e9);
});
// eslint-disable-next-line @typescript-eslint/no-empty-function
const asyn = async ({ t, l }) => { l('sup'); t('exemptFromAsserting', true); };
export const test_with_async_arrow_var = test('test export method', asyn);
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const test_with_function_instead_of_arrow = test('test export method', async function unused_function_name({ t }) { t('exemptFromAsserting', true); });
// eslint-disable-next-line @typescript-eslint/no-empty-function
function global_donothing_function({ t }) { t('exemptFromAsserting', true); }
export const global_test_function_exported_as_var = test('test export method', global_donothing_function);
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function separate_export_and_test_decl({ t }) { t('exemptFromAsserting', true); }
test('test export method', separate_export_and_test_decl);

// a simple check on the deep equal functionality. I am fairly certain since funs get dropped in json.stringify that
// this will test for that. It will also check that it's doing a deep equality instead of object ref equality.
export const deep_equal_simple = test('assertions', ({ t, l, a: { eqO, throws } }) => {
  const double = (i: number) => i * 2;
  const double2 = (i: number) => i * 2;
  eqO(double, double);
  throws(() => { // canonical way to test for an assertion failure as all my assertions throw to indicate failure.
    eqO(double, double2); // note this will throw an interesting error message. it'll say expected double to equal double2, then render a diff, but the diff will be empty, since their code is identical
  });

  const obj = { a: double };
  const obj2 = { a: double };
  const obj3 = { a: double2 };
  eqO(obj, obj2);
  throws(() => {
    eqO(obj, obj3);
  });
});

// Inceptideep is a second form of inception that is deeper by leveraging the test bundle instead of just
// calling self from the babel'd js code from tree in build. It's a test approach closer to what a lib would see. It's
// somewhat aspirational though, because realistically these meta-tests are being run from build
///// I'm not implementing this yet; don't have a suitable behavior to test this with. It's a bit of a hardcore concept
// export const deep_equal_with_differing_functions_inceptideep = test('assertions', async ({spawn}) => {
//   const projDir = getBuildProjDir(); // I guess gonna be using build dir to derive dist dir for the time being, as i do not have a helper to grab that.
//   // the approach is going to involve (1) put a brand new test in a string literal here into a ts file, (2) launch
//   it with tsx and work out how to link it to the bundle (this tst test lib's bundle) (3) validate output
// });

// Use this for help to get to the bottom of what some of the possible stack formats are. unfortunately we have to just
// deal with whatever comes out since doing any overriding will break all known approaches for source mapping.
function stack_from_outer_fn() {
  return new Error().stack;
}
export const error_stack_format = test('stack trace', ({l, a:{eq, is, not}}) => {
  const stack_here = new Error().stack.split('\n').slice(1);
  const stack_from_outer = stack_from_outer_fn().split('\n').slice(1);
  const explicit_examples = [
    "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    "    at /Users/slu/blah/blah/blah.js:10:20",
    "    at /Users/slu/static-sharing/test.ts:3:1539"
  ];
  const examples_of_stack_frames = [...stack_here, ...stack_from_outer, ...explicit_examples];

  const re = [
    /at\s+(?:[\w<>.]+\s+)?\((?:file:\/\/)?(.*)\)/,
    /at\s+file:\/\/(.*)$/,
    /at\s+([-\w/.]+:\d+:\d+)$/,
  ];
  const validate_code_position_re = /^[-\w/.:]+:\d+:\d+$/;
  const validate_code_position_none_match_res = [
    /\/\//, // consecutive slashes
    /file:\//, // file:/
    /^\s?at/ // "at"
  ];

  l("regexes to implement code location detection in stacks:", re);
  l("all the stack examples we're gonna test on:", examples_of_stack_frames);
  for (const stack of examples_of_stack_frames) {
    const pred = (r: RegExp) => {
      const match = stack.match(r);
      if (!match) return false;
      const m1 = match[1];
      is(m1.match(validate_code_position_re), 'captured group', m1, 'failed to validate by', validate_code_position_re);
      not(validate_code_position_none_match_res.some(re => m1.match(re)), m1, 'matched some of these forbidden patterns:', validate_code_position_none_match_res);
      return true
    };
    is(re.some(pred), 'failed to parse', stack, 'by ANY of patterns', re);
    // also test against real impl from this lib
    is(parseFileLineColFromStackLineMakeHyperlink(stack), "need to be implemented in the library routine here as well!")
  }
});

export const deepequal_perf_collisions = test('deepequal', ({ l, p, a: { eqO } }) => {
  const dSET = timedMs(deepStrictEqual);
  const dE = timedMs(equal);

  const x: number[] = [];
  const y_builtin_ms: number[] = [];
  const y_deepeq_ms: number[] = [];
  for (let i = 50; i < 50000; i = Math.round(i * 1.5)) {
    const arr_i = Array.from({ length: i }).map((_, i) => ({n: i}));
    const arr_i_2 = Array.from({ length: i }).map((_, i) => ({n: i}));
    const builtin = dSET(arr_i, arr_i_2);
    l(i, 'builtin:', builtin);
    const deepeq = dE(arr_i, arr_i_2);
    l(i, 'deepeq', deepeq);
    x.push(i);
    y_builtin_ms.push(builtin[1]);
    y_deepeq_ms.push(deepeq[1]);
  }

  p('uplot', [{
    title: "deep equal runtime comparison",
    y_axes: ["builtin", "deep-equal", "deep-equal over builtin"],
    data: [x, y_builtin_ms, y_deepeq_ms, y_deepeq_ms.map((v, i) => v / y_builtin_ms[i])]
  }]);
  
});

export const spawn_a_failing_command = test('spawnAsync', async ({ t, spawn, a: { eq, eqO, match } }) => {
  t('fails', /exited with failure/);
  const ret = await spawn('bash', ['-c', 'echo "abcdef"; >&2 echo "xyz123"; exit 1'], { bufferStdout: true, showStdoutWhenBuffering: true });
  match(ret.stdout, /abcdef/);
});

export const spawn_must_show_full_error_on_failure = test('spawnAsync', async ({ l, spawn, a: { eq, eqO, match } }) => {
  const projDir = getBuildProjDir();
  l('projDir:', projDir);
  const ret = await spawn('node', ['--enable-source-maps', path.join(projDir, 'dispatch', 'runner.js'), TestLaunchFlags.ExactTestNameMatching, TestLaunchFlags.ForceEnableLogging, 'tests/self.js', TestLaunchSeparator, 'spawnAsync:spawn_a_failing_command'], {
    bufferStdout: true, showStdoutWhenBuffering: true
  });
  // confirm i can see the content emitted from the command
  match(ret.stdout, /abcdef/);
  match(ret.stdout, /xyz123/);
});


