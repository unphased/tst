import { TestMetadata } from '../types.js';
import { TestLaunchFlags, TestLaunchFlagsTakingOneArg, TestLaunchSeparator } from "./flags.js";

// this is a sugar for grabbing/checking the launch flag. abbreviates "test option".
export function topt(flag: TestLaunchFlags): boolean;
export function topt(flag: TestLaunchFlagsTakingOneArg): string;
export function topt(flag: TestLaunchFlags | TestLaunchFlagsTakingOneArg): boolean | string {
  for (const f of testLaunchConfig) {
    if (typeof f === 'object' && isTestLaunchFlagTakingOneArg(flag) && f[flag]) return f[flag];
    if (f === flag) return true;
  }
  return false;
}

// type guard
export function isTestLaunchFlagTakingOneArg(flag: string): flag is TestLaunchFlagsTakingOneArg {
    return Object.values(TestLaunchFlagsTakingOneArg).includes(flag as TestLaunchFlagsTakingOneArg);
}

// tLC is a container to track jaunch flag values set from cli
export const testLaunchConfig: (TestLaunchFlags | ({
  [flag in TestLaunchFlagsTakingOneArg]: string;
}))[] = [];

export const parseTestLaunchingArgs = (args?: string[]) => {
  // - first, go from the beginning looking through args in the first group for flags.
  // any that are handled will be removed from further processing.
  // - then, a series of file names implicitly under src/. We filter the modules we will import by this list
  // - after that: a __ separator
  // - lastly, a series of either flags or test suite/name specifiers.
  // flags broadly control behavior, and specifiers are used to target tests.
  // Specifiers are like suite:test where suite and colon are optional, and test name is optional if a suite is
  // specified. TODO possibly enable specifying suite without colon. We can check for that anyhow.
  // Examples of specifiers:
  // suite1:footest suite2: 'test 4'
  // initially, these defs are programmatically generated.
  // specifiers are precise by default:
  // after the positional '__' delimiter, all args are treated as specifiers. Each
  // specifier can have any number spaces in it, but colons are used to split suite and name.
  // if no separator is provided then all args will be treated as specifiers. Note it is a double underscore separator
  // and not a double dash as usual, because npm is a piece of shit and eats up double hyphen preventing us from using
  // it. Similarly, flags as mentioned above are not implemented with hyphens due to node trying to eat them up,
  // though TODO we should be able to switch back to regular looking flags and just make use of `--` lol.
  if (args?.length) {
    while (args.length) {
      const arg = args[0];
      console.error('parsing arg', arg);
      const flagTakingOneArg = Object.values(TestLaunchFlagsTakingOneArg).find(v => v === arg as TestLaunchFlagsTakingOneArg);
      if (flagTakingOneArg) {
        args.shift();
        const value = args.shift();
        console.error('test dispatch', "test launch flag taking arg was parsed!", flagTakingOneArg, "VALUE IS", value);
        testLaunchConfig.push({ [flagTakingOneArg]: value } as {
          [flag in TestLaunchFlagsTakingOneArg]: string;
        }); // TODO gosh this is ugly
        continue;
      }
      const flag = Object.values(TestLaunchFlags).find(value => value === arg as TestLaunchFlags);
      if (flag) {
        testLaunchConfig.push(flag);
        console.error("test launch flag was parsed!", flag);
        args.shift();
      } else {
        console.error(`arg "${arg}" failed to parse for launch flags, bailing at this point on launch flag parsing`);
        break;
      }
    }
  }

  if (!args || !args.length) {
    return { files: [], testPredicate: () => true };
  }

  const idxSeparator = args.indexOf(TestLaunchSeparator);
  const files = idxSeparator === -1 ? [] : args.slice(0, idxSeparator);

  if (topt(tf.ExactTestNameMatching)) { // to be really specific to match a test. Need full specification of suite if that exists.
    const exactTestNameMatch = (test: TestMetadata, name: string) => {
      const nameString = `${test.suite ? test.suite + ':' : ''}${test.name}`;
      const ret = nameString === name;
      // if (!ret) {
      //   l(`debug eTNM: test name ${nameString} did not match ${name}`);
      // }
      return ret;
    };
    return { files, testPredicate: (test: TestMetadata) => args.slice(idxSeparator + 1).some(a => exactTestNameMatch(test, a)) };
  } else { // default, a loose user friendly cli for test name matching.
    return { files, testPredicate: (test: TestMetadata) => args.slice(idxSeparator + 1).some(a => `${test.suite ? test.suite + ':' : ''}${test.name}`.toLowerCase().includes(a.toLowerCase())) }; 
  }
};

// lookup object for sugaring. This lets you pull up the name of all launch flags I have defined
export const tf = { ...TestLaunchFlags, ...TestLaunchFlagsTakingOneArg };

