import { Simplify } from 'type-fest';
import { ChildProcess, execSync, spawn } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Transform } from 'stream';
import { colors } from 'ts-utils/terminal';
import * as util from 'util';
import { SpawnAsyncReturnBase, SpawnResourceReport } from './types.js';
import { renderTruncHrTime } from "./util.js";

export class ProcessError extends Error {
  code: number | null;
  signal: string | null;

  constructor(message: string, code: number | null, signal: string | null) {
    super(message);
    this.code = code;
    this.signal = signal;
    this.name = 'ProcessError';
  }
}
// a sugaring helper to allow for more concise transform stream assembly. Note this is a HOF, since streams arent
// reusable
const transform_maker = (transform: ((chunk: Buffer) => string)) => () => new Transform({
  transform(chunk, encoding, callback) {
    callback(null, transform(chunk));
  }
});
// an output prettifier:
// - any content lacking EOF newline is called out
// - newlines at EOF are elided (this is the common case; due to the way we output strings verbatim, this would waste a space)
// - (more than 2) sequential newlines (empty lines) are squashed into a single callout line in dashed underline
const squashBlankLinesTransform = transform_maker(chunk => {
  const value = chunk.toString('utf8').replace(/(\n\s*){3,}(?!$)/g, m => '\n' + colors.dashed_underline + colors.italic + m.match(/\n/g)?.length + ' blank lines' + colors.underline_reset + colors.italic_reset);
  if (/\n$/.test(value)) {
    return (value.replace(/\n$/, ''));
  }
  return (`${value}\n${colors.dashed_underline}${colors.italic}Missing NL at EOC${colors.underline_reset}${colors.italic_reset}`);
});
const JSONLParseTransform = transform_maker(chunk => chunk.toString('utf8').split('\n').map(e => !e ? e : util.inspect(JSON.parse(e), { colors: true, depth: Infinity, compact: true })).join('\n'));
const arg_sep = `${colors.underline_reset} ${colors.underline}`;
const sigs = os.constants.signals;
type SignalKeysWithSIG = keyof typeof sigs;
type RemoveSIGPrefix<T extends string> = T extends `SIG${infer Rest}` ? Rest : never;
// produce the type for union of signal names without the "SIG" prefix. used for passing into posix `kill`.
type SignalNamesWithoutSIG = RemoveSIGPrefix<SignalKeysWithSIG>;

export type SpawnAsyncOpts = {
  onstdout?: (data: string | Buffer) => void;
  onspawn?: (proc: ChildProcess, kill: (string?: SignalNamesWithoutSIG) => void) => void;
  fillBg?: true; // fill bgcolor to rest of line in io log colorization. Note the colorizer default is true so only need to set this if you want to specify false
  hideLaunchAndClose?: true; // suppresses logging of launch and close events. But nonzero exit will still be logged.
  shortenCmdArgs?: number | true; // truncate any long arg in command display to this max length (wont trunc cmd)
  /* TODO */ coalesceMs?: number; // coalesce stdout and stderr events that occur without exceeding this delay.
  hideCmd?: true; // suppresses showing the command (but shows pid) in logged i/o lines, notably still show the cmd in launch and close.
  /* TODO */ prefixCmd?: true; // prefix the command display in logged i/o lines.
  hideAllMeta?: true; // suppresses all meta logging (launch, close, cmd name)
  doNotRejectOnFail?: true; // set to suppress throwing an exception on process failure. condition can be seen from promise resolution
  attemptJSONLParse?: true; // attempt to parse and pretty print any stdout (we'll also add it to stderr later if we ever need)

  // JSONL while logging it. note there is no support here for parsing of multiline actual json content, as that won't benefit at all from streaming...
  env?: NodeJS.ProcessEnv;
  ignoreStdinout?: true; // set to true to discard stdin and stdout, intended to be equivalent to piping to /dev/null
  bypassResourceMetrics?: true; // set to true to suppress resource metrics collection by directly launching instead of launching under [g]time. From light benchmarking it should shave an entire ms off your process launch.
  bufferStdout?: true; // set to true to return stdout as a string in the promise resolution. Note this will also suppress stdout logging.
  showStdoutWhenBuffering?: true; // only has effect when bufferStdout is true. set to true to do the usual stdout logging in addition to returning it buffered in the promise resolution.
  stdinStream?: NodeJS.ReadableStream; // set to a stream to pipe it to the process's stdin.
};

// used to bind the type of a state variable (string holding path of records) we'll use in the function to the value of the config flag
type OptStateWithMetrics = { bypassResourceMetrics: undefined; time_output_file: string; };
type OptStateWithoutMetrics = { bypassResourceMetrics: true; time_output_file: undefined; };

type OptStateWithStdout = { bufferStdout: true, stdoutBuf: string };

type SpawnAsyncReturnWResources = SpawnAsyncReturnBase & {
  resources: SpawnResourceReport;
};
type SpawnAsyncReturnWStdout = SpawnAsyncReturnBase & {
  stdout: string;
};
export type SpawnAsyncReturnWStdoutAndResources = SpawnAsyncReturnWStdout & {
  resources: SpawnResourceReport;
};

type LoggerFunction = typeof console.error;
// defines callable type as an alternative to defining overloads. This is beneficial so that this type can be reused
// where we wrap the spawnAsync for test context.
type SpawnAsyncFunction = {
  (command: string, args: string[], logger: LoggerFunction, options: SpawnAsyncOpts & { bufferStdout: true; bypassResourceMetrics: true; }): Promise<SpawnAsyncReturnWStdout>;
  (command: string, args: string[], logger: LoggerFunction, options: SpawnAsyncOpts & { bypassResourceMetrics: true; }): Promise<SpawnAsyncReturnBase>;
  (command: string, args: string[], logger: LoggerFunction, options: SpawnAsyncOpts & { bufferStdout: true; }): Promise<SpawnAsyncReturnWStdoutAndResources>;
  (command: string, args: string[], logger?: LoggerFunction, options?: SpawnAsyncOpts): Promise<SpawnAsyncReturnWResources>;
};
export type SpawnAsyncTestLogTraced = {
  (command: string, args: string[], options: SpawnAsyncOpts & { bufferStdout: true; bypassResourceMetrics: true; }): Promise<SpawnAsyncReturnWStdout>;
  (command: string, args: string[], options: SpawnAsyncOpts & { bypassResourceMetrics: true; }): Promise<SpawnAsyncReturnBase>;
  (command: string, args: string[], options: SpawnAsyncOpts & { bufferStdout: true; }): Promise<SpawnAsyncReturnWStdoutAndResources>;
  (command: string, args: string[], options?: SpawnAsyncOpts): Promise<SpawnAsyncReturnWResources>;
};

// helper type guard needed for use in the impl to get the promise to understand the flag controls the output type...
export function isBypassResourceMetrics<T extends SpawnAsyncOpts>(options: T): options is T & { bypassResourceMetrics: true } {
  return !!options.bypassResourceMetrics;
}
export function isBufferStdout<T extends SpawnAsyncOpts>(options: T): options is T & { bufferStdout: true } {
  return !!options.bufferStdout;
}

const cyan = (s: string) => colors.cyan + s + colors.fg_reset;
const blue = (s: string) => colors.blue + s + colors.fg_reset;
const underline = (s: string) => colors.underline + s + colors.underline_reset;
const bold = (s: string) => colors.bold + s + colors.bold_reset;
// it seems likely this thing will get augmented with more and more functionality. It's my sugared way to async'ly stream a
// process while it runs. Callbacks can be provided for
// - logger: receives a bg colorized stream of stderr and stdout so the color can implicitly tell you
// which is which while spliced together as you would expect
// - onstdout: passes raw ondata events node receives from the process's stdout
// - onspawn: cb for the process's spawn event
// TODO provide a way possibly using debounce to configure how much output stream buffering to do.

mkdirSync(path.join('/tmp/', 'nucleus_instrumentation_time_resource_metrics'), { recursive: true });

// we had to fall back to overloading in order for typescript to be able to pass the return type through, conditional on input flag. Sadly this probably means we can't freely add tons of these kinds of logic or the code will get massively out of hand.
export const spawnAsync = ((command: string, args: string[], logger_?: typeof console.error, options?: SpawnAsyncOpts): Promise<SpawnAsyncReturnBase|SpawnAsyncReturnWResources|SpawnAsyncReturnWStdout|SpawnAsyncReturnWStdoutAndResources> => {
  const start = process.hrtime();
  const logger = logger_ ?? console.error;
  const opts = { ...options } as Simplify<SpawnAsyncOpts & ({ time_output_file?: string; bypassResourceMetrics?: true; }) & Partial<OptStateWithStdout>>;

  // resolve opts that override other opts
  if (opts?.hideAllMeta) {
    opts.hideLaunchAndClose = true;
    opts.hideCmd = true;
  }
  let pid: number | undefined;

  const cmdDisplayingLogger = (data: string | Buffer, nl = true) => logger(`spawnAsync: ${bold(pid ? `${blue(pid.toString())} ` : '') + bold(cyan(underline(command))) + (args.length ? arg_sep : '') + args.map(e => e.replace(/\x1b/g, '\\E')).map(e => opts.shortenCmdArgs ? (truncateStringForDisplay(e, opts.shortenCmdArgs === true ? 50 : opts.shortenCmdArgs)).split('\n').map(cyan).map(underline).join('\n') : underline(cyan(e))).join(arg_sep)}:${nl ? '\n' : ' '}${data}`);

  const pidOnlyLogger = (data: string | Buffer, nl = false) => logger(`spawnAsync:${bold(pid ? ` ${blue(pid.toString())}` : '')}${nl ? '\n' : ' '}${data}`); // note the data with plus operator seems to coerce buffers to string

  const spawnOptions: Parameters<typeof spawn>[2] = {};
  if (opts?.env) {
    if (typeof opts.env !== 'object' || !Object.keys(opts.env).length) throw new Error("spawnAsync: give env option an object with items, or don't specify env");
    spawnOptions.env = { ...process.env, ...opts.env }; // not combining with process env is likely to lead to lots of suffering TODO add option to not include process env. That will probably never get used...
  }
  if (opts?.ignoreStdinout) {
    spawnOptions.stdio = ['ignore', 'ignore', 'pipe'];
  }

  // use brew to get /usr/bin/time as gtime on macos.
  return new Promise((resolve, reject) => {
    let realSpawnCmd = process.platform === 'darwin' ? 'gtime' : 'time';
    let realSpawnArgs: string[] = [];
    if (opts?.bypassResourceMetrics) {
      realSpawnCmd = command;
      realSpawnArgs = args;
    } else {
      const random = Math.random().toString(36).slice(2);
      opts.time_output_file = path.join('/tmp', 'nucleus_instrumentation_time_resource_metrics', `time_output_${new Date().toISOString().replace(/:/g, '_')}${random}`);
      realSpawnArgs = ['-f', '{"maxrss":%M,"wall":%e,"sys":%S,"user":%U}', '-o', opts.time_output_file, '--quiet', '--', command, ...args];
    }
    const renderedFullCmd = [cyan(underline(realSpawnCmd)), ...(realSpawnArgs).map(cyan).map(underline)].join(arg_sep);
    const proc = spawn(realSpawnCmd, realSpawnArgs, spawnOptions);
    pid = proc.pid;
    opts?.hideLaunchAndClose || pidOnlyLogger(`launched as ${renderedFullCmd}`, false);
    if (opts?.onspawn) {
      // if onspawn cb is provided, pass a closure to the real onspawn which will call your provided onspawn with the
      // process object and a kill function defaulting to sending sigint that you can use to send a signal to the real
      // actual process. Sorry that was a mouthful.
      proc.on('spawn', () => {
        opts.onspawn?.(proc, (sig = 'INT') => {
          if (opts.bypassResourceMetrics) {
            // For the sake of unifying interface to SIG-less strings but still needing the original NodeJS.Signals type for SIG
            // sporting strings in order to call kill on a node child process, surgery on the string value and adjusting the type does the trick.
            proc.kill((`SIG${sig}`) as SignalKeysWithSIG);
          } else {
            const cmd = `kill -${sig} $(pgrep -P ${pid})`;
            pidOnlyLogger(`launching execSync ${cyan(underline(cmd))}`, false);
            execSync(cmd); // kill cb provided for convenience to manage the actual process.
          }
        });
      });
    }
    if (opts?.stdinStream) {
      opts.stdinStream.pipe(proc.stdin);
    }

    const outstream = stdoutColorizer(opts?.fillBg);
    const errstream = stderrColorizer(opts?.fillBg);
    if (opts?.bufferStdout) {
      opts.stdoutBuf = '';
    }
    if (!opts?.ignoreStdinout) {
      if (!opts?.bufferStdout || opts?.showStdoutWhenBuffering) {
        if (opts?.attemptJSONLParse) {
          proc.stdout?.pipe(JSONLParseTransform()).pipe(squashBlankLinesTransform()).pipe(outstream);
        } else {
          proc.stdout?.pipe(squashBlankLinesTransform()).pipe(outstream);
        }
      }
      if (opts?.onstdout) {
        proc.stdout?.on('data', opts.onstdout);
      }
      if (opts?.bufferStdout) {
        proc.stdout?.on('data', (chunk: Buffer) => { opts.stdoutBuf += chunk.toString('utf8'); });
      }
    }
    proc.stderr?.pipe(squashBlankLinesTransform()).pipe(errstream);
    outstream.on('data', opts.hideCmd ? pidOnlyLogger : cmdDisplayingLogger);
    errstream.on('data', opts.hideCmd ? pidOnlyLogger : cmdDisplayingLogger);
    proc.stderr.on('error', (err) => {
      console.error(`stderr error with pid=${pid}`, err);
    });
    if (!opts?.hideLaunchAndClose) {
      proc.on('exit', (code, signal) => {
        cmdDisplayingLogger(`exited${code ? ` code ${code}` : ''}${signal ? ` signal ${signal}` : ''} (took ${renderTruncHrTime(process.hrtime(start))})`, false);
      });
    }
    proc.on('error', (err) => {
      cmdDisplayingLogger(util.inspect(err, { colors: true }), false);
      reject(err);
    });
    proc.on('close', (code, signal) => {
      if (code || signal || !opts?.hideLaunchAndClose) {
        // TODO confirm if the signal information is being passed through properly here. it may only work if the signal
        // hits the /usr/bin/time process unfortunately. But I'm willing to give that up for the resource metrics...
        cmdDisplayingLogger(`closed${code ? ` code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`, false);
      }
      let time_output: SpawnResourceReport | undefined;
      if (!isBypassResourceMetrics(opts)) {
        time_output = JSON.parse(readFileSync(opts.time_output_file).toString('utf8')) as SpawnResourceReport;
        // clean up
        unlinkSync(opts.time_output_file);
      }

      if (opts?.doNotRejectOnFail || code === 0) {
        if (isBypassResourceMetrics(opts)) {
          resolve({ duration: process.hrtime(start), code, signal, pid, stdout: isBufferStdout(opts) ? opts?.stdoutBuf : undefined });
        } else {
          resolve({ duration: process.hrtime(start), code, signal, pid, resources: time_output, stdout: isBufferStdout(opts) ? opts?.stdoutBuf : undefined });
        }
      } else {
        reject(new ProcessError(`spawnAsync: Process ${colors.bold + (pid ? `${colors.magenta + pid} ` : '') + colors.cyan + colors.underline + command + arg_sep + args.map(e => e.replace(/\x1b/g, '\\E')).join(arg_sep) + colors.reset} exited with failure`, code, signal));
      }
    });
  });
}) as SpawnAsyncFunction;

export const spawnA = (command: string, logger = console.log, opts?: SpawnAsyncOpts) => spawnAsync(command, [], logger, opts);
// TODO implement for the stdout producing use case, other bells and whistles preserved where possible

export function execAsync(command: string, args: string[], logger = console.error) {
  const cmdDisplayingLogger = (data, nl = true) => logger(`execAsync: ${colors.bold + colors.cyan + colors.underline + command + arg_sep + args.map(e => e.replace(/\x1b/g, '\\E')).join(arg_sep) + colors.reset}:${nl ? '\n' : ' '}${data}`);
  cmdDisplayingLogger('launching', false);
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args);
    const outstream = stdoutColorizer(false);
    const errstream = stderrColorizer(false);
    proc.stdout.pipe(squashBlankLinesTransform()).pipe(outstream);
    proc.stderr.pipe(squashBlankLinesTransform()).pipe(errstream);
    let output = '';
    let stderr = '';
    proc.stdout.on('data', (stdout) => {
      // uncolorized (unadulterated) output to return
      output += stdout.toString('utf8');
    });
    proc.stderr.on('data', (std_err) => {
      stderr += std_err.toString('utf8');
    });
    outstream.on('data', cmdDisplayingLogger);
    errstream.on('data', cmdDisplayingLogger);
    proc.on('close', (code) => {
      cmdDisplayingLogger('closed', false);
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`execAsync: Process exited with code ${code}. stderr: ${stderr}`));
      }
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Truncate a string to a given length, show start and end, shorten the middle.
export const separator = `${colors.magenta + colors.bold}\u2026 \u2026${colors.bold_reset + colors.fg_reset}`;
export const truncateStringForDisplay = (str: string, num = 140) => {
  if (str.length <= num) {
    return str;
  }
  const start = str.slice(0, num / 2 - 1);
  const end = str.slice(str.length - num / 2 + 1);
  return start + separator + end;
};

const colorizeStream = (color_256_bg: number, bgColorWholeLine: boolean) => {
  const mungeColors = (line: string) => {
    if (line.length === 0) {
      return '';
    }

    // if lines start with a color clear, then cull that and trailing color clears too (a heuristic that works on babel's
    // chalk usage)
    if (line.startsWith('\x1b[0m')) {
      line = line.replace(/^\x1b\[0m/, '').replace(/\x1b\[0m$/, '');
    }
    return `\x1b[48;5;${color_256_bg}m${line}${bgColorWholeLine ? '\x1b[0K' : '\x1b[49m'}`;
  };
  return new Transform({
    transform(chunk, encoding, callback) {
      const chunkStr = chunk.toString('utf8');
      // if (chunkStr.indexOf('\x1b') !== -1) {
      //   console.log('debugging colorization payload:', util.inspect(chunkStr));
      // }
      callback(null, chunkStr.split('\n').map(mungeColors).join('\n') + '\x1b[m');
    }
  });
};

export const stdoutColorizer = (fill = true) => colorizeStream(19, fill);
export const stderrColorizer = (fill = true) => colorizeStream(52, fill);

