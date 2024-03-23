import * as stream from "node:stream";
import * as zlib from "node:zlib";
import { test } from '../main.js';

// Define a unique symbol for branding
const BrotliB64Symbol = Symbol('BrotliB64');
// Type alias for the branded string type
export type Compressed = string & { [BrotliB64Symbol]: never };

const comp_with_cb = async (str: string): Promise<Buffer> =>
  new Promise((res, rej) =>
    zlib.brotliCompress(str, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 3}}, (err, compressed: Buffer) => err ? rej(err) : res(compressed)));

const comp_stream = (str: stream.Readable): stream.Readable => str.pipe(zlib.createBrotliCompress({params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 3}}));

// used to compress parts of objects stored as base64 inside other objects. Not intended to be optimal in any way.
const comp = async (obj): Promise<Compressed> =>
  // TODO if size over some threshold, do json and compress with stream.
  (await comp_with_cb(JSON.stringify(obj))).toString('base64') as Compressed;

// convert objects to/from compressed representation. Goes without saying, but since compression works on strings, this only works on serializable content.
// interfaces are designed based on use cases. Generally we want to be inserting stuff into existing objects so we can
// compress the inserting object and save some memory.

export const compress_simple_test = test(async ({l, a: {lt}}) => {
  const thing = {
    a: await comp({alphabet_x99: 'abcdefghijklmnopqrstuvwxyz'.repeat(99)})
  };
  l(thing);
  lt(thing.a.length, 500); // 26*99 = 2574
});

export const stream_from = (s: string | Buffer) => new stream.Readable({
  read() {
    this.push(s);
    this.push(null);
  }
});

export const pump_stream = (input: stream.Readable) => new Promise<Buffer>((res, rej) => {
  let buf: Buffer = Buffer.from('');
  input.on('data', (chunk) => {
    if (chunk) {
      buf = Buffer.concat([buf, chunk]);
    }
  });
  input.on('end', () => {
    res(buf);
  });
  input.on('error', rej);
});

