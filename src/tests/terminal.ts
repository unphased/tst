import { lexAnsi } from 'ts-utils/terminal';
import { test } from '../main.js';

export const simple_ansi_strip = test('ansi', ({ a: { includesO } }) => {
  const s = 'hello \x1b[31mworld\x1b[2m foo\x1b[39m bar\x1b[m\nb\x1b[33maz';
  const a = lexAnsi(s);
  includesO(a, {
    cleaned: ['hello world foo bar', 'baz'],
    idxs: [[6, 16, 24, 33], [1]],
    lens: [[5, 4, 5, 3], [5]]
  });
});

export const test_name_collision = test('same test name', ({ l, t }) => {
  t('exemptFromAsserting', true);
  l('test_name_collision from terminal');
  // this set of tests with the same name and suite defined from two modules exists to test that there is no breakage
  // caused by having colliding test definition names. You probably wouldn't want to do this in practice.
});

