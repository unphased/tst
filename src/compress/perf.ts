import * as zlib from 'node:zlib';
import * as stream from 'node:stream';

import { test } from '../main.js';

enum CompressionType {
  gzip,
  brotli,
  deflate,
  deflateRaw,
}

function makeCompressionStream(type: CompressionType, level: number) {
  switch (type) {
    case CompressionType.gzip:
      return zlib.createGzip({ level });
    case CompressionType.brotli:
      return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level } });
    case CompressionType.deflate:
      return zlib.createDeflate({ level });
    case CompressionType.deflateRaw:
      return zlib.createDeflateRaw({ level });
  }
}

export const compare_stream_efficiency_in_context_of_compression = test('streams', async ({ t, p, l, a: {eqO, eq}}) => {
  // mainly want to compare the handy compress functions node gives against full blown making our own streams and
  // piping. If as expected then the cb's are simply implementing the same underneath and perf will match.
  const methods = ['gzip_stream', 'gzip_cb'];
  const durations = new Map<string, {ns: number, index: number}[]>();
  const record = (hrDelta: ReturnType<typeof process.hrtime>, index: number, method: string) => {
    const d = durations.get(method) || [];
    d.push({ ns: hrDelta[0] * 1e9 + hrDelta[1], index });
    durations.set(method, d);
  };

  const lens: number[] = [];
  
  for (const method of methods) {
    for (let i = 1000; i < 800000; i = Math.ceil(i * 1.3)) {
      const input = Array.from({length: i}, (_, j) => `abcdefghijk${Math.sqrt(j)}`).join('\n');
      if (method === methods[0]) {
        lens.push(input.length);
      }
      const inputBuf = Buffer.from(input);
      // do some simple round trips
      if (method === 'gzip_stream') {
        const start = process.hrtime();
        const gzipCompress = makeCompressionStream(CompressionType.gzip, 3);
        const gzipDecompress = zlib.createGunzip();
        const inStream = new stream.Readable({ read() {
          this.push(inputBuf);
          this.push(null);
        }});
        const decompd = await new Promise((resolve, reject) => {
          const out = inStream.pipe(gzipCompress).pipe(gzipDecompress);
          let buf: string = '';
          out.on('data', (chunk) => {
            if (chunk) {
              buf += chunk.toString();
            }
          });
          out.on('end', () => {
            resolve(buf);
          });
        });
        const end = process.hrtime(start);
        record(end, i, method);
        eqO(input, decompd);
      } else if (method === 'gzip_cb') {
        const start = process.hrtime();
        const decompd = await new Promise((resolve, reject) => {
          zlib.gzip(inputBuf, { level: 3 }, (err, compressed) => {
            if (err) reject(err);
            zlib.gunzip(compressed, (err, decompressed) => {
              if (err) reject(err);
              resolve(decompressed.toString());
            });
          });
        });
        const end = process.hrtime(start);
        record(end, i, method);
        eqO(input, decompd);
      }
    }
  }

  // for sanity; the records' indices (that determine the generated test cases content) should be the same values
  eqO(durations.get('gzip_stream').map(({_ns, index}) => index), durations.get('gzip_cb').map(({_ns, index}) => index));
  eq(lens.length, [...durations.values()][0].length);

  p('uplot', [{
    title: 'compression, comparing runtime perf of manual streams vs convenience node functions',
    y_axes: [...durations.keys()].map(meth => meth + ' runtime ns'),
    data: [
      durations.get('gzip_stream').map(({_ns, index}) => index), // x axis is the size of the input roughly
      ...Array.from(durations.values()).map(arr => arr.map(({ ns }) => ns))
    ]
  }, {
    title: 'job index input byte size',
    y_axes: ['input size'],
    data: [[...durations.values()][0].map(({_ns, index}) => index), lens]
  }]);
});

// just a simple check of compression ratio perf
// export const brotli_quick_efficiency = test('brotli compression', async ({ t, p, l, a: {eq}}) => {
//   const ratios: number[] = [];
//   const NUM = 10;
//   for (let i = 0; i < NUM; i++) {
//     const input = Buffer.from(`hello ${'z'.repeat(i)} world`);
//     const brotliCompress = makeCompressionStream(CompressionType.brotli, zlib.constants.BROTLI_DEFAULT_QUALITY);
//     const brotliDecompress = makeDecompressionStream(CompressionType.brotli);
//     const compressed = 
//     const ratio = compressed.length / input.length;
//     ratios[i] = ratio;
//     const decompressed = await brotliDecompress(compressed);
//     eq(input, decompressed);
//   }
//   p("uplot", [{
//     title: 'brotli ratios for a single repeated char',
//     y_axes: ['r'],
//     data: [Array.from({length: NUM}, (_, i) => i), ratios]
//   }]);
//   l('ratios', ratios);
// });
