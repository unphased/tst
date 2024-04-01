// test params wrap everything needed; this is the best way to keep test-specific state tracking impl simple, and 
// also keeps imports simple, as well as aiding test helper method discovery. Assertions are moved here to keep the
// interface uniform but also to inject logging for them!
// Config (the subset that doesnt need to be specified prior to test launch) is also provided as an interface here, 
// time will tell if this is a mistake... it certainly is insane. 
// export type TestOptionsInitial = { // these are the test options that affect the scheduling/launch of tests. So far empty
// };
// these are the options that can be set during text execution, ideally near the beginning, which can either be:
// - adequately responded to immediately once they are set (e.g. conversion from regular log buffering into ring buffering), or
// - persisted to test context so that the information can be leveraged in future executions without being a big
// problem (e.g. priority)

import { HtmlEmbedding } from "./plotting/index.js";
import { AssertionName } from "./assertions.js";
import { Simplify } from "type-fest";
import * as stream from "node:stream";

export type ErrorSpec = true | RegExp | string | (string | RegExp)[];

export type TestOptions = {
    /* NOT IMPLEMENTED YET */ timeout?: number;
    /* NOT IMPLEMENTED YET */ priority?: number; // higher priority tests run first

    /* NOT IMPLEMENTED sequential?: boolean, */ // if async test, serialize its execution (usually for quickly preventing its prints from getting interlaced)??? I should be able to design around this ever being a concern
    /* IMPL IN TESTING */ ringBufferLimitAssertionLogs?: number;
    // size limit to apply for ring buffer log storage. Maybe if this isn't set these will not use ring buffers and need
    // to store everything? Seems like a sane default. When i have a use case hitting limits, i can decide then if i want
    // to implement with streams (probably yes just for the cool factor). But I already know that ring buffer as an
    // option will be great for many of my test approaches.
    /* NOT IMPL YET */ ringBufferLimitLogs?: number;
  exemptFromAsserting?: boolean; // do not treat as failure if no assertions are made in the test.
  fails?: ErrorSpec; // invert the result. This is used to test intentionally failing (e.g. validating test machinery).
  assertionCount?: number; // expected number of assertion calls including final failed ones. Will be implicitly checked as a final assertion.
    /* NOT IMPL YET */ maxRSS?: number; // max resident set size in bytes. If test execution exceeds this threshold, test will fail.
    /* NOT IMPL YET */ maxUserCPUSecs?: number; // max user CPU seconds. If test execution exceeds this threshold, test will fail.
    /* NOT IMPL YET */ maxSysCPUSecs?: number; // max system CPU seconds. If test execution exceeds this threshold, test will fail.
};
export type TestLogs = [[number, number], string][];
export type TestAssertionMetrics = {
  logs: {
    [key in AssertionName]?: {
      ringBufferOffset?: number; // undefined: keep using as array (continue to push). number: index into the array now used as ring buffer
      buffer: string[];
      // compressed_stream: stream.Transform;
      // compressed_outbuf: Buffer;
    };
  };
  assertionCounts: {
    [key in AssertionName]?: number;
  };
  assertionFailure: boolean;
};

// type DeepReplace<T, K extends PropertyKey, U> = T extends object
//   ? {
//       [P in keyof T]: P extends K
//         ? U // Replace the type of property K with type U
//         : DeepReplace<T[P], K, U>; // Recursively process nested properties
//     }
//   : T;
//
// export type TestAssertionMetricsResolved = DeepReplace<TestAssertionMetrics, "compressed_stream", string>;

export type SpawnResourceReport = {
  maxrss: number; // kilobytes
  user: number; // seconds
  sys: number; // seconds
  wall: number; // seconds
};
export type SpawnAsyncReturnBase = {
  duration: [number, number];
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
};

export type ResourceMetrics = {
  resources?: SpawnResourceReport;
  return: SpawnAsyncReturnBase;
  command: string[];
}[];

export type TestResult = {
  durationMs: number;
  name: string;
  async: boolean;
  file: string;
  logs: TestLogs;
  assertionMetrics: TestAssertionMetrics;
  cpu: {
    user: number; // i think tehse are in microsecs
    system: number;
  };
  stack?: string;
  suite?: string;
  failure?: false | Error;
  finalMemSample?: number; // rss from node is in bytes
  resourceMetrics: ResourceMetrics;
  embeds: Embeds;
  automated?: string;
} & TestOptions;

export type Embeds = (HtmlEmbedding & { group_id: string })[];

// supplementary data that will be json content saved into brotli compressed files which will be loadable from those
// html pages.
export type DataExport = {};

export type CleanupHandlers = {
  failedCleanupHandlers: (() => void | Promise<void>)[];
  alwaysCleanupHandlers: (() => void | Promise<void>)[];
};

type TestDiscoveryMetrics = {
  importsDuration: [number, number];
  fileDiscoveryDuration: [number, number];
};
type TestExecMetrics = {
  testExecutionDuration: [number, number];
};
export type TestProcessDispatchMetrics = {
  duration: [number, number];
  resources: SpawnResourceReport;
};

export type TestDispatchGlobalMetrics = Simplify<TestExecMetrics & TestDiscoveryMetrics>;

export type TestDispatchResult = TestExecMetrics & { testResults: TestResult[]; };

// needs to be fleshed out.
export type TestLaunchMetrics = {
  importedTime: number;
  runTime: number;
};
export type TestMetadata = {
  name: string;
  filename: string;
  suite?: string;
  stack: string;
} & TestOptions;

