import * as zlib from 'node:zlib';
import * as stream from 'node:stream';
import { cartesianAll, identical, mapObjectProps, memoized, kvString } from 'ts-utils';
import { test } from '../main.js';

// helpers
const stream_from = (s: string | Buffer) => new stream.Readable({ read() {
  this.push(s);
  this.push(null);
}});
const pump_stream = (input: stream.Readable) => new Promise<Buffer>((res, rej) => {
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

// so as part of getting compression megabench to work i had to troubleshoot the stream assembly and figured might as
// well make a test for it
export const streams_weird = test('streams', async ({ t, p, l, a: {eqO, eq}}) => {
  const compStream = zlib.createGzip({level: 9});
  const decompStream = zlib.createGunzip();
  const input = Buffer.from('abc');
  const inStream = stream_from(input);
  const compd = await pump_stream(inStream.pipe(compStream));
  l('compd', compd);
  const compdInStream = stream_from(compd);
  const decompd = await pump_stream(compdInStream.pipe(decompStream));
  eqO(decompd, input); // buffers are not a base type and cannot be compared with eq.
});

export const compression_megabench = test('streams', async ({ t, p, l, lo, a: {eqO, eq, is}}) => {
  // Started out mainly wanting to compare the handy compress functions node gives against full blown making our own streams and
  // piping. Then realized I can make this a lot more elegantly automated for comparisons so it grew into a benchmark
  // of every conceivable thing.
  type CStream = zlib.Gzip | zlib.BrotliCompress | zlib.Deflate | zlib.DeflateRaw;
  type DCStream = zlib.Gunzip | zlib.BrotliDecompress | zlib.Inflate | zlib.InflateRaw;

  type AlgoMethod = {
    name: string;
    stream: (level: number) => CStream;
    de_stream_maker: () => DCStream; // the decompressors never need to have options specified
    cb: (input: Buffer, level: number, cb: (error: Error | null, result: Buffer) => void) => void;
    de_cb: (input: Buffer, cb: (error: Error | null, result: Buffer) => void) => void;
  };

  // we make slight adjustments (in particular for brotli) to produce a uniform API
  const comp_algoes: AlgoMethod[] = [
    { name: 'gzip',
      stream: (l: number) => zlib.createGzip({level: l}),
      de_stream_maker: zlib.createGunzip,
      cb: (i,l,cb) => zlib.gzip(i, {level: l}, cb),
      de_cb: zlib.gunzip
    }, { name: 'brotli',
      stream: (l: number) => zlib.createBrotliCompress({params:{[zlib.constants.BROTLI_PARAM_QUALITY]: l}}),
      de_stream_maker: zlib.createBrotliDecompress,
      cb: (i,l,cb) => zlib.brotliCompress(i, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: l}}, cb),
      de_cb: zlib.brotliDecompress
    }, { name: 'deflateRaw',
      stream: (l: number) => zlib.createDeflateRaw({level: l}),
      de_stream_maker: zlib.createInflateRaw,
      cb: (i,l,cb) => zlib.deflateRaw(i, {level: l}, cb),
      de_cb: zlib.inflateRaw
    },
  ];

  type Metrics = {
    compMs: number;
    decompMs: number;
    compRatio: number;
  };

  const routines = [
    {
      name: 'stream', routine: async (input: Buffer, level: number, methods: AlgoMethod) => {
        const metrics: Partial<Metrics> = {};
        const start = process.hrtime();
        const compStream = methods.stream(level);
        const decompStream = methods.de_stream_maker();
        const inStream = stream_from(input);
        const compd = await pump_stream(inStream.pipe(compStream));
        metrics.compMs = process.hrtime(start)[0] * 1e3 + process.hrtime(start)[1] / 1e6;
        metrics.compRatio = input.length / compd.length; // lengths may not be comparable between buffer and string, but should be fine when test cases here are all ascii
        const compdInStream = stream_from(compd);
        const decompd = await pump_stream(compdInStream.pipe(decompStream));
        metrics.decompMs = process.hrtime(start)[0] * 1e3 + process.hrtime(start)[1] / 1e6;
        if (input.toString() !== decompd.toString()) {
          throw new Error('round trip data (stream) did not match input');
        }
        return metrics as Metrics;
      }
    // }, {
    //   name: 'convenience_cb', routine: async (input: Buffer, level: number, methods: AlgoMethod) => {
    //     const metrics: Partial<Metrics> = {};
    //     const start = process.hrtime();
    //     const round_trip_data = await new Promise((resolve, reject) => {
    //       methods.cb(input, level, (err, compressed: Buffer) => {
    //         if (err) reject(err);
    //         metrics.compMs = process.hrtime(start)[0] * 1e3 + process.hrtime(start)[1] / 1e6;
    //         metrics.compRatio = input.length / compressed.length;
    //         const startDecomp = process.hrtime();
    //         methods.de_cb(compressed, (err, decompressed) => {
    //           if (err) reject(err);
    //           metrics.decompMs = process.hrtime(startDecomp)[0] * 1e3 + process.hrtime(startDecomp)[1] / 1e6;
    //           resolve(decompressed.toString());
    //         });
    //       });
    //     });
    //     // not using eq at the moment, merely to reduce test record overhead since this is a huge test 
    //     if (round_trip_data !== input.toString()) {
    //       throw new Error('round trip data (cb) did not match input');
    //     }
    //     return metrics as Metrics;
    //   }
    },
  ];

  // varieties of data to compress. `produce` returns string[], each is a test case
  // TODO definitely stands to gain scalability from converting these to generators
  const datagens = [ // all have tests growing geometrically in size
    { name: 'a-k and a number (usually but not always many digits)', produce: () =>
      Array.from({length: 30}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, j) => 'abcdefghijk ' + Math.sqrt(j)).join('\n')
      )
    },
    { name: 'a-z with a number intercalated at random position', produce: () => 
      Array.from({length: 30}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, j) => {
          const az = 'abcdefghijklmnopqrstuvwxyz';
          const rand = Math.floor(Math.random() * az.length);
          return az.slice(0, rand) + ' ' + Math.sqrt(j) + ' ' + az.slice(rand);
        }).join('\n')
      )
    },
    { name: 'random numbers', produce: memoized(() =>
      Array.from({length: 30}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, j) => Math.random().toString()).join('\n')
      ))
    },
    { name: 'integers incrementing by 7', produce: () =>
      Array.from({length: 40}, (_, i) =>
        Array.from({length: Math.ceil(1.35 ** (i + 3))}, (_, j) => (j * 7).toString()).join('\n')
      )
    },
    { name: 'integers incrementing by 1', produce: () =>
      Array.from({length: 40}, (_, i) =>
        Array.from({length: Math.ceil(1.35 ** (i + 3))}, (_, j) => j.toString()).join('\n')
      )
    },
    { name: 'copies of the same string', produce: () =>
      Array.from({length: 30}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 3))}, (_, j) => 'abcdefghijk lorem ipsum lmnopqrstuv').join('\n')
      )
    }
  ];

  const levels = [1, 3, 6, 9] as const;

  // note: datagens here is still actually a 2D construct (e.g. each data scheme is an independent battery of tests,
  // rather than one data point) but it is not suitable for expansion via cartesian product.
  const combos = cartesianAll(datagens, comp_algoes, routines, levels);

  l(combos);

  type Key = {
    dataset: string;
    dataset_i: number;
    data_size: number;
    algo: string;
    routine: string;
    level: number;
  };

  const structured: { meta: Key, values: Metrics }[] = [];
  for (const [data_maker, algo, job, level] of combos) {
    const data = data_maker.produce();
    for (let i = 0; i < data.length; i++) {
      const input = Buffer.from(data[i]);
      const metrics = await job.routine(input, level, algo);
      structured.push({
        meta: {
          dataset: data_maker.name,
          dataset_i: i,
          data_size: input.length,
          algo: algo.name,
          routine: job.name,
          level
        },
        values: metrics
      });
    }
  }
  l('s.l', structured.length);

  const expanded = structured.flatMap(({
    meta: { dataset, data_size, algo, routine, level },
    values
  }) => mapObjectProps(values, (vk, v) => ({
    ks: { dataset, data_size, algo, routine, level, metric: vk, metricTimeCategory: !!vk.match(/Ms$/) },
    v
  })));
  l('expanded.l', expanded.length);
  const graphs = cartesianAll(datagens.map(e => e.name), [true, false])
    .map(([datan, isTimeMetric]) => ({ graph_group: expanded.filter(({ ks: { dataset, metricTimeCategory } }) => dataset === datan && metricTimeCategory === isTimeMetric), grouped_descriptors: { dataset: datan, metric: (isTimeMetric ? 'timings' : 'ratio') } as const }));
  lo(['g', graphs], {maxArrayLength: 10});

  const graphs_1 = graphs.map(({ graph_group, grouped_descriptors }) => {
    const isTimeMetric = grouped_descriptors.metric === 'timings';
    const seriesComboCommon = [comp_algoes.map(e => e.name), levels, routines.map(e => e.name)] as const;
    const seriesComboRoots = isTimeMetric ? [...seriesComboCommon, ['compMs', 'decompMs']] as const : seriesComboCommon;
    return { desc: kvString(grouped_descriptors),
      series: cartesianAll(...seriesComboRoots)
      .map(([algo, level, routine, timingMetricName]) => {
        const grouped = graph_group.filter(({ ks: { algo: a, routine: r, level: l, metric } }) => a === algo && r === routine && l === level && (timingMetricName === undefined || timingMetricName === metric));
        return {
          seriesName: kvString({algo, routine, level, timingMetricName}),
          x: grouped.map(e => e.ks.data_size),
          y: grouped.map(e => e.v)
        };
      })
    }
  });

  // big check x axes agree among series, needed for regular uplot usage and I had to do quite a bit to set the stage
  graphs_1.forEach(g => is(identical(g.series.map(s => s.x))));

  lo(['g1', graphs_1], {maxArrayLength: 3});
  l('g1.l', graphs_1.length);

  p('uplot', graphs_1.map(g => ({
    title: g.desc,
    y_axes: g.series.map(s => s.seriesName),
    data: [ g.series[0].x, ...g.series.map(s => s.y)]
  })));
});

// just a simple check of compression ratio perf
export const brotli_compression_efficiency = test('brotli compression', async ({ t, p, l, a: {eq}}) => {
  t('exemptFromAsserting', true);
  { // so i want to add one more dimension to this to compare the other compressions and shove them in the same graphs. It's definitely straightforward.
    const ratios: number[] = [];
    const compdlens: number[] = [];
    const durationsMs: number[] = [];
    const i_s: number[] = [];
    for (let i = 1; i < 1000000; i = Math.ceil(i * 1.3)) {
      i_s.push(i);
      const input = Buffer.from(`hello ${'z'.repeat(i)} world`);
      const brotliCompress = zlib.createBrotliCompress({params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_DEFAULT_QUALITY }});
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
