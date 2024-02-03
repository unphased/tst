import { ChildProcess, spawn, execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as util from 'util';
import * as os from 'os';
import { colors } from './terminal/colors.js';

import { mkdirSync, readFileSync, unlinkSync } from 'fs';
import { Transform } from 'stream';

// Truncate a string to a given length, show start and end, shorten the middle.
const separator = `${colors.magenta + colors.bold}\u2026 \u2026${colors.bold_reset + colors.fg_reset}`;
export const truncateStringForDisplay = (str: string, num = 140) => {
  if (str.length <= num) {
    return str;
  }
  const start = str.slice(0, num / 2 - 1);
  const end = str.slice(str.length - num / 2 + 1);
  return start + separator + end;
};

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

const colorizeStream = (color_256_bg: number, bgColorWholeLine: boolean) => {
  const mungeColors = (l: string) => {
    if (l.length === 0) {
      return '';
    }

    // if lines start with a color clear, then cull that and trailing color clears too (a heuristic that works on babel's
    // chalk usage)
    if (l.startsWith('\x1b[0m')) {
      l = l.replace(/^\x1b\[0m/, '').replace(/\x1b\[0m$/, '');
    }
    return `\x1b[48;5;${color_256_bg}m${l}${bgColorWholeLine ? '\x1b[0K' : '\x1b[49m'}`;
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
// a sugaring helper to allow for more concise transform stream assembly. Note this is a HOF, since streams arent
// reusable
const transform_maker = (transform: ((chunk: Buffer) => string)) =>
  () => new Transform({
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
    return(value.replace(/\n$/, ''));
  } else {
    return(value + '\n' + colors.dashed_underline + colors.italic + 'Missing NL at EOC' + colors.underline_reset + colors.italic_reset);
  }
});

const JSONLParseTransform = transform_maker(chunk =>
  chunk.toString('utf8').split('\n').map(e => !e ? e : util.inspect(JSON.parse(e), { colors: true, depth: Infinity, compact: true })).join('\n'));

const arg_sep = colors.underline_reset + ' ' + colors.underline;

const sigs = os.constants.signals;
type SignalKeysWithSIG = keyof typeof sigs;
type RemoveSIGPrefix<T extends string> = T extends `SIG${infer Rest}` ? Rest : never;
type SignalNamesWithoutSIG = RemoveSIGPrefix<SignalKeysWithSIG>;

export type SpawnAsyncOpts = {
  onstdout?: (data: any) => void;
  onspawn?: (proc: ChildProcess, kill: (string?: SignalNamesWithoutSIG) => void) => void;
  fillBg?: boolean; // fill bgcolor to rest of line in io log colorization. Note the colorizer default is true so only need to set this if you want to specify false
  hideLaunchAndClose?: boolean; // suppresses logging of launch and close events. But nonzero exit will still be logged.
  shortenCmdArgs?: number | true; // truncate any long arg in command display to this max length (wont trunc cmd)
  coalesceMs?: number; // coalesce stdout and stderr events that occur without exceeding this delay.
  hideCmd?: boolean; // suppresses showing the command (but shows pid) in logged i/o lines, notably still show the cmd in launch and close.
  prefixCmd?: boolean; // TODO prefix the command display in logged i/o lines.
  hideAllMeta?: boolean; // suppresses all meta logging (launch, close, cmd name)
  doNotRejectOnFail?: boolean; // set to suppress throwing an exception on process failure. condition can be seen from promise resolution
  attemptJSONLParse?: boolean; // attempt to parse and pretty print any stdout (we'll also add it to stderr later if we ever need)
  // JSONL while logging it. note there is no support here for parsing of multiline actual json content, as that won't benefit at all from streaming...
  env?: NodeJS.ProcessEnv;
  ignoreStdinout?: boolean; // set to true to discard stdin and stdout, intended to be equivalent to piping to /dev/null
};

export type SpawnResourceReport = {
  maxrss: number;
  user: number;
  sys: number;
  wall: number;
};

type SpawnAsyncReturn = {
  code: number | null;
  signal: NodeJS.Signals | null;
  resources: SpawnResourceReport;
  pid?: number;
};

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
export function spawnAsync(command: string, args: string[], logger = console.error, options?: SpawnAsyncOpts) {
  const opts = { ...options };
  // resolve opts that override other opts
  if (options?.hideAllMeta) {
    opts.hideLaunchAndClose = true;
    opts.hideCmd = true;
  }
  let pid: number | undefined;

  const random = Math.random().toString(36).slice(2);
  const time_output_file = path.join('/tmp', 'nucleus_instrumentation_time_resource_metrics', 'time_output_' + new Date().toISOString().replace(/:/g, '_') + random);
  mkdirSync(path.dirname(time_output_file), { recursive: true }); // this may not be necessary

  const cmdDisplayingLogger = (data, nl = true) => logger(`spawnAsync: ${bold(pid ? blue(pid.toString()) + ' ' : '') + bold(cyan(underline(command))) + (args.length ? arg_sep : '') + args.map(e => e.replace(/\x1b/g, '\\E')).map(e => opts.shortenCmdArgs ? (truncateStringForDisplay(e, opts.shortenCmdArgs === true ? 50 : opts.shortenCmdArgs)).split('\n').map(cyan).map(underline).join('\n') : underline(cyan(e))).join(arg_sep)}:${nl ? '\n' : ' '}` + data);

  const pidOnlyLogger = (data, nl = true) => logger(`spawnAsync:${bold(pid ? ' ' + blue(pid.toString()) : '')}${nl ? '\n' : ' '}` + data); // note the data with plus operator seems to coerce buffers to string

  const spawnOptions = {};
  if (opts?.env) {
    if (!(typeof opts.env === 'object') || !Object.keys(opts.env).length) throw new Error("spawnAsync: give env option an object with items, or don't specify env");
    spawnOptions['env'] = { ...process.env, ...opts.env }; // not combining with process env is likely to lead to lots of suffering TODO add option to not include process env. That will probably never get used...
  }
  if (opts?.ignoreStdinout) {
    spawnOptions['stdio'] = ['ignore', 'ignore', 'pipe'];
  }

  // use brew to get /usr/bin/time as gtime on macos.
  return new Promise<SpawnAsyncReturn>((resolve, reject) => {
    const realSpawnCmd = process.platform === 'darwin' ? 'gtime' : 'time';
    const realSpawnArgs = ['-f', '{"maxrss":%M,"wall":%e,"sys":%S,"user":%U}', '-o', time_output_file, '--quiet', '--', command, ...args ];
    const renderedFullCmd = [cyan(underline(realSpawnCmd)), ...(realSpawnArgs).map(cyan).map(underline)].join(arg_sep);
    const proc = spawn(realSpawnCmd, realSpawnArgs, spawnOptions);
    pid = proc.pid;
    opts?.hideLaunchAndClose || pidOnlyLogger(`launched as ${renderedFullCmd}`, false);
    if (opts?.onspawn) {
      proc.on('spawn', () => opts.onspawn?.(proc, (sig = 'INT') => {
        execSync(`kill -${sig} $(pgrep -P ${pid})`); // kill cb provided for convenience to manage the actual process.
      }));
    }
    const outstream = stdoutColorizer(opts?.fillBg);
    const errstream = stderrColorizer(opts?.fillBg);
    if (!opts?.ignoreStdinout){
      if (opts?.attemptJSONLParse) {
        proc.stdout.pipe(JSONLParseTransform()).pipe(squashBlankLinesTransform()).pipe(outstream);
      } else {
        proc.stdout.pipe(squashBlankLinesTransform()).pipe(outstream);
      }
      if (opts?.onstdout) {
        proc.stdout.on('data', opts.onstdout);
      }
    }
    proc.stderr.pipe(squashBlankLinesTransform()).pipe(errstream);
    outstream.on('data', opts.hideCmd ? pidOnlyLogger : cmdDisplayingLogger);
    errstream.on('data', opts.hideCmd ? pidOnlyLogger : cmdDisplayingLogger);
    proc.on('exit', (code, signal) => {
      cmdDisplayingLogger('exited' + (code ? ' code ' + code : '') + (signal ? ' signal ' + signal : ''), false);
    });
    proc.on('error', (err) => {
      cmdDisplayingLogger(util.inspect(err, {colors: true}), false);
      reject(err);
    });
    proc.on('close', (code, signal) => {
      if (code || signal || !opts?.hideLaunchAndClose) {
        // TODO confirm if the signal information is being passed through properly here. it may only work if the signal
        // hits the /usr/bin/time process unfortunately. But I'm willing to give that up for the resource metrics...
        cmdDisplayingLogger('closed' + (code ? ' code ' + code : '') + (signal ? ' signal ' + signal : ''), false);
      }
      const time_output = JSON.parse(readFileSync(time_output_file).toString('utf8'));

      // clean up
      unlinkSync(time_output_file);

      if (opts?.doNotRejectOnFail || code === 0) {
        resolve({ code, signal, pid, resources: time_output });
      } else {
        reject(new ProcessError(`spawnAsync: Process ${colors.bold + (pid ? colors.magenta + pid + ' ' : '') + colors.cyan + colors.underline + command + arg_sep + args.map(e => e.replace(/\x1b/g, '\\E')).join(arg_sep) + colors.reset} exited with failure`, code, signal));
      }
    });
  });
}
