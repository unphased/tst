export const TestLaunchSeparator = '__';

export enum TestLaunchFlags {
  Automated = '_automated',// Used by child automated (parallel) test runs. Must communicate test results exclusively through stdout.
  // Skips the test result processing step, the parent we report to will handle that. Suitable for launching via ssh etc. Note
  // launching via npm will cause extra garbage at the top, we can handle that actually by emitting json output in a single line and
  // grabbing the last line, but we definitely wouldn't be launching this way thorugh npm.
  // PARALLEL and _automated_ combined occurs on remote nodes, and the effects are combined. the runner launched over
  // SSH will launch tests in parallel processes, receive results from them over stdin, and submit combined results over stdout.
  // Presumably we'll send individual test results as soon as they complete under the automated behavior to get real
  // time progress feedback.
  // These provide a way to override certain config values but only for this run. the config will not be changed.
  ForceDisableLogging = '_test_logging_off',
  ForceEnableLogging = '_log',
  AsyncParallelTestLaunch = '_async_parallel',
  ExactTestNameMatching = '_exact_test_names', // default cli to use loose test specifier matching logic.
  ImportJsOnly = '--import-js-only', // for use when launching tests on compilation products so we don't let node choke on importing .d.ts files (... so we dont have to carefully organize those .d.ts files and impact their discovery by other projects)
  RethrowFromTests = '--rethrow', // used to obtain the raw thrown exception from a failed test (prevents proper handling and reporting of test results, but useful for debug)
  NoCatching = '--no-catch', // even more hardcore than the above, prevent catching of exceptions in tests. mainly aids in debugging. Really need to use this together with a test specifier...
}

export enum TestLaunchFlagsTakingOneArg {
  Concurrency = '_concurrency', // Override concurrency level (default being number of threads on machine)
  Parallel = 'PARALLEL', // Used in an orchestrator context, launching automated tests in separate parellel processes. Consume results from children over stdin for processing.
  // Parallel requires an arg which specifies either 'root' or JSON which encodes a complete hierarchical breakdown of job scheduling.

  TargetDir = '--target-dir'
}

