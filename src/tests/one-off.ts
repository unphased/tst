import * as fs from 'fs';
import { test } from '../main.js';
import { cartesianAll, identical, timedMs } from 'ts-utils';
import { deepStrictEqual } from 'assert';
import equal from 'deep-equal';
import { uPlot_assemble } from '../plotting/uplot.js';
import { build_html } from '../plotting/index.js';


export const deepequal_perf = test('deepequal', ({ l, plot, a: { eqO } }) => {
  const dSET = timedMs(deepStrictEqual);
  const dE = timedMs(equal);

  const x: number[] = [];
  const methods = [
    { name: 'deepequal', method: dE },
    { name: 'builtin', method: dSET },
  ];
  const structures = [
    { name: 'plain integer', item: (i: number) => i },
    { name: 'object with integer prop', item: (i: number) => ({ n: i }) },
    { name: 'array with single integer', item: (i: number) => [i] },
    { name: 'array with 5 integer props', item: (i: number) => ({ a: i, b: i, c: i, d: i, e: i }) },
    { name: 'int in obj w/ other props', item: (i: number) => ({ a: 'aa', b: 'b', c: [99, 999], n: i }) }
  ];
  const output = cartesianAll(methods, structures).map(([method, structure]) => ({
    label: `${method.name} with ${structure.name}`,
    data: Array.from({ length: 10 }, (_, i) => Math.round(5 * 1.5 ** i)).map(i => {
      // produce a geometric sequence of array lengths
      const a1 = Array.from({ length: i }).map((_, i) => structure.item(i));
      const a2 = Array.from({ length: i }).map((_, i) => structure.item(i));
      // a1 and a2 are identical arrays of varying length, used to performance-test these deep-equality checks
      const [_value, ms] = method.method(a1, a2);
      return [i, ms] as const; // x,y coordinates: array length vs time taken to execute equality check.
    })
  })
  );

  // sanity check that x axes from all series are identical
  const x_axes = output.map(o => o.data.map(d => d[0]));
  identical(x_axes);

  // produce the data for plotting relative runtimes
  const by_method = methods.map(m => output.filter(o => o.label.startsWith((m.name))));
  const relative = by_method[0].map((o, i) => ({
    label: o.label.replace(methods[0].name, methods[0].name + ' over ' + methods[1].name),
    reldata: o.data.map((d, j) => d[1] / by_method[1][i].data[j][1])
  }));
  l('relative', relative);

  const plot = [{
    title: 'runtimes (ms)',
    y_axes: output.map(o => o.label),
    data: [
      x_axes[0],
      ...output.map(o => o.data.map(d => d[1]))
    ]
  }, {
    title: 'relative runtime (ratio deepequal / builtin)',
    y_axes: relative.map(r => r.label),
    data: [
      x_axes[0],
      ...relative.map(r => r.reldata)
    ]
  }];
  plot('uplot', plot);
  const embed = uPlot_assemble(plot);
  const page = Object.values(build_html([embed])[0]).join('\n');
  fs.writeFileSync('deepequal_perf.html', page);
});

