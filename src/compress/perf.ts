import * as zlib from 'node:zlib';
import * as stream from 'node:stream';
import { cartesianAll, identical, mapObjectProps, memoized, kvString, Statistics, VoidTakingMethodsOf, hrTimeMs } from 'ts-utils';
import { test } from '../main.js';
import { stream_from, pump_stream } from './compression.js';

// so as part of getting compression megabench to work i had to troubleshoot the stream assembly and figured might as
// well make a test for it
export const streams_weird = test('streams', async ({ t, plot: p, l, a: {eqO, eq}}) => {
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

export const compression_megabench = test('streams', async ({ t, plot, l, lo, a: {eqO, eq, is}}) => {
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
    /* { name: 'gzip',
      stream: (l: number) => zlib.createGzip({level: l}),
      de_stream_maker: zlib.createGunzip,
      cb: (i,l,cb) => zlib.gzip(i, {level: l}, cb),
      de_cb: zlib.gunzip
    },  */{ name: 'brotli',
      stream: (l: number) => zlib.createBrotliCompress({params:{[zlib.constants.BROTLI_PARAM_QUALITY]: l}}),
      de_stream_maker: zlib.createBrotliDecompress,
      cb: (i,l,cb) => zlib.brotliCompress(i, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: l}}, cb),
      de_cb: zlib.brotliDecompress
    }, { name: 'deflateRaw',
      stream: (l: number) => zlib.createDeflateRaw({level: l}),
      de_stream_maker: zlib.createInflateRaw,
      cb: (i,l,cb) => zlib.deflateRaw(i, {level: l}, cb),
      de_cb: zlib.inflateRaw
    }
  ];

  type Metrics = {
    compMB_s: number;
    decompMB_s: number;
    compRatio: number;
    startTs: number;
    endTs: number;
    i?: number;
  };

  const routines = [
    {
      name: 'stream', routine: async (input: Buffer, level: number, methods: AlgoMethod) => {
        const metrics: Partial<Metrics> = {};
        const start = process.hrtime();
        metrics.startTs = hrTimeMs(start);
        const compStream = methods.stream(level);
        const decompStream = methods.de_stream_maker();
        const inStream = stream_from(input);
        const size = input.length;
        const compd = await pump_stream(inStream.pipe(compStream));
        const deltaMs = hrTimeMs(process.hrtime(start));
        metrics.compMB_s = size / deltaMs / 1024; // 1 byte per ms ~= 1KB/s
        metrics.compRatio = input.length / compd.length; // lengths may not be comparable between buffer and string, but should be fine when test cases here are all ascii
        const compdInStream = stream_from(compd);
        const startDecomp = process.hrtime();
        const decompd = await pump_stream(compdInStream.pipe(decompStream));
        const deltaDecMs = hrTimeMs(process.hrtime(startDecomp));
        metrics.decompMB_s = size / deltaDecMs / 1024;
        if (input.toString() !== decompd.toString()) {
          throw new Error('round trip data (stream) did not match input');
        }
        metrics.endTs = hrTimeMs(process.hrtime());
        return metrics as Metrics;
      }
    }, {
      name: 'convenience_cb', routine: async (input: Buffer, level: number, methods: AlgoMethod) => {
        const metrics: Partial<Metrics> = {};
        const start = process.hrtime();
        metrics.startTs = hrTimeMs(start);
        const size = input.length;
        const round_trip_data = await new Promise((resolve, reject) => {
          methods.cb(input, level, (err, compressed: Buffer) => {
            if (err) reject(err);
            const deltaMs = hrTimeMs(process.hrtime(start));
            metrics.compMB_s = size / deltaMs / 1024;
            metrics.compRatio = input.length / compressed.length;
            const startDecomp = process.hrtime();
            methods.de_cb(compressed, (err, decompressed) => {
              if (err) reject(err);
              const deltaDecMs = hrTimeMs(process.hrtime(startDecomp));
              metrics.decompMB_s = size / deltaDecMs / 1024;
              resolve(decompressed.toString());
              eq(input.toString(), decompressed.toString());
            });
          });
        });
        // not using eq at the moment, merely to reduce test record overhead since this is a huge test 
        if (round_trip_data !== input.toString()) {
          throw new Error('round trip data (cb) did not match input');
        }
        metrics.endTs = hrTimeMs(process.hrtime());
        return metrics as Metrics;
      }
    },
  ];

  // varieties of data to compress. `produce` returns string[], each is a test case
  // TODO definitely stands to gain scalability from converting these to generators
  const datagens = [ // all have tests growing geometrically in size
    { name: 'a-k and a number (usually but not always many digits)', produce: () =>
      Array.from({length: 20}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, j) => 'abcdefghijk ' + Math.sqrt(j)).join('\n')
      )
    },
    { name: 'a-z with a number intercalated at random position', produce: () => 
      Array.from({length: 20}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, j) => {
          const az = 'abcdefghijklmnopqrstuvwxyz';
          const rand = Math.floor(Math.random() * az.length);
          return az.slice(0, rand) + ' ' + Math.sqrt(j) + ' ' + az.slice(rand);
        }).join('\n')
      )
    },
    { name: 'random numbers', produce: memoized(() =>
      Array.from({length: 20}, (_, i) =>
        Array.from({length: Math.ceil(1.3 ** (i + 10))}, (_, _j) => Math.random().toString()).join('\n')
      ))
    },
    { name: 'integers incrementing by 7', produce: () =>
      Array.from({length: 20}, (_, i) =>
        Array.from({length: Math.ceil(1.35 ** (i + 3))}, (_, j) => (j * 7).toString()).join('\n')
      )
    },
    { name: 'integers incrementing by 1', produce: () =>
      Array.from({length: 20}, (_, i) =>
        Array.from({length: Math.ceil(1.35 ** (i + 3))}, (_, j) => j.toString()).join('\n')
      )
    },
    { name: 'copies of the same string', produce: () =>
      Array.from({length: 20}, (_, i) =>
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

  const REPEAT = 5; // take the hot results to be average of the last N

  const structured: { meta: Key, values: Metrics[] }[] = [];
  for (const [data_maker, algo, job, level] of combos) {
    const data = data_maker.produce();
    for (let i = 0; i < data.length; i++) {
      const input = Buffer.from(data[i]);
      const values: Metrics[] = [];
      for (const _jobidx of Array(REPEAT).fill(0)) {
        values.push(await job.routine(input, level, algo));
      }
      structured.push({
        meta: {
          dataset: data_maker.name,
          dataset_i: i,
          data_size: input.length,
          algo: algo.name,
          routine: job.name,
          level
        },
        values
      });
    }
  }
  l('s.l', structured.length);

  const denorm_metrics = (sample_metric_list: { [key: string]: number }[], index_name: string): {[key: string]: number} => {
    // turn [{a: 1, b: 2}, {a: 3, b: 4}] into [{<index_name>: 0, a: 1, b: 2}, {<index_name>: 1, a: 3, b: 4}].
    return sample_metric_list.map((e, i) => ({...e, [index_name]: i})).reduce((a, b) => ({...a, ...b}), {});
  }
  plot('vega_example', {title: 'compression bench', debug: structured, data: structured.map(s => ({...s.meta, ...denorm_metrics(s.values, 'sample_idx')}))});

  const statistical_measures: VoidTakingMethodsOf<Statistics>[] = [ 'standardDeviation', 'mean', 'max' ];
  const expanded = structured.flatMap(({
    meta: { dataset, data_size, algo, routine, level },
    values
  }) => {
    const measurements = Object.keys(values[0]).map((k: keyof Metrics) => [k, values.map(e => e[k])] as const);
    l('measurements', measurements);
    const meas_stats = measurements.map(([k, ea]) => ({ name: k, stats: new Statistics(ea) })).flatMap(es => statistical_measures.map(m => [`${es.name} ${m} over ${REPEAT} trials`, es.stats[m]()]));
    l('hms', meas_stats);
    const x = [
      mapObjectProps(values[0], (vk,v) => ({
        ks: { dataset, data_size, algo, routine, level, metric: vk, run: 'cold', metricTimeCategory: !!vk.match(/MB_s$/) },
        v
      })),
    ];
    l('cold', x);
    return values.flatMap((e, i) => {
      return mapObjectProps(e, (vk, v) => ({
        ks: { dataset, data_size, algo, routine, level, repeati: i, metric: vk, metricTimeCategory: !!vk.match(/MB_s$/) },
        v
      }));
    })
  });
  l('expanded.l', expanded.length);
  lo(['expanded', expanded], {maxArrayLength: 5});
  const graphs = cartesianAll(datagens.map(e => e.name), [true, false])
    .map(([datan, isSpeedMetric]) => ({ graph_group: expanded.filter(({ ks: { dataset, metricTimeCategory } }) => dataset === datan && metricTimeCategory === isSpeedMetric), grouped_descriptors: { dataset: datan, metric: (isSpeedMetric ? 'speed' : 'ratio') } as const }));
  lo(['g', graphs], {maxArrayLength: 10});

  const graphs_1 = graphs.map(({ graph_group, grouped_descriptors }) => {
    const isSpeedMetric = grouped_descriptors.metric === 'speed';
    const seriesComboCommon = [comp_algoes.map(e => e.name), levels, routines.map(e => e.name)] as const;
    const seriesComboRoots = isSpeedMetric ? [...seriesComboCommon, ['compMB_s', 'decompMB_s']] as const : seriesComboCommon;
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

  plot('uplot', graphs_1.map(g => ({
    title: g.desc,
    y_axes: g.series.map(s => s.seriesName),
    data: [ g.series[0].x, ...g.series.map(s => s.y)]
  })));
});

// just a simple check of compression ratio perf
export const brotli_compression_efficiency = test('brotli compression', async ({ t, plot: p, l, a: {eq}}) => {
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
        out.on('data', (chunk: Buffer) => {
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
