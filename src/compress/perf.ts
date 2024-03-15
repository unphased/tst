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
    for (let i = 100; i < 20000; i = Math.ceil(i * 1.3)) {
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
export const brotli_compression_efficiency = test('brotli compression', async ({ t, p, l, a: {eq}}) => {
  { // so i want to add one more dimension to this to compare the other compressions and shove them in the same graphs. It's definitely straightforward.
    const ratios: number[] = [];
    const compdlens: number[] = [];
    const durationsMs: number[] = [];
    const i_s: number[] = [];
    for (let i = 1; i < 1000000; i = Math.ceil(i * 1.3)) {
      i_s.push(i);
      const input = Buffer.from(`hello ${'z'.repeat(i)} world`);
      const brotliCompress = makeCompressionStream(CompressionType.brotli, zlib.constants.BROTLI_DEFAULT_QUALITY);
      const inStream = new stream.Readable({ read() {
        this.push(input);
        this.push(null);
      }});
      const start = process.hrtime();
      const out = inStream.pipe(brotliCompress);
      const compd = await new Promise<string>((resolve, reject) => {
        let buf = '';
        out.on('data', (chunk) => {
          if (chunk) {
            buf += chunk.toString();
          }
        });
        out.on('end', () => {
          resolve(buf);
        });
        out.on('error', reject);
      });
      const end = process.hrtime(start);
      const duration = end[0] * 1e9 + end[1];
      durationsMs.push(duration/1e6);

      const ratio = compd.length / input.length;
      ratios.push(ratio);
      compdlens.push(compd.length);
    }

    p("uplot", [{
      title: 'brotli ratios for a single repeated char',
      y_axes: ['compression ratio'],
      data: [i_s, ratios]
    }, {
      title: 'brotli compressed length',
      y_axes: ['compressed length'],
      data: [i_s, compdlens]
    }, {
      title: 'brotli compression duration',
      y_axes: ['duration ms'],
      data: [i_s, durationsMs]
    }]);
  }
});
