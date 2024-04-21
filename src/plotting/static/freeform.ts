import embed from 'vega-embed';

(window.plots as ).forEach((pl, i) => {
  const el = document.createElement('div');
  const id = 'plot' + i;
  el.setAttribute('id', id);
  document.body.appendChild(el);

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "description": pl.title,
    "data": {
      "values": pl.data
    },
    "mark": "bar",
    "encoding": {
      "x": {"field": "a", "type": "nominal"},
      "y": {"field": "b", "type": "quantitative"}
    }
  };
  embed('#' + id, spec);
});

// import {Config, TopLevelSpec, compile} from 'vega-lite';
// import embed from 'vega-embed';
//
// const vegaLiteSpec: TopLevelSpec = {
//   $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
//   data: {
//     values: [
//       {a: 'A', b: 28},
//       {a: 'B', b: 55},
//       {a: 'C', b: 43},
//       {a: 'D', b: 91},
//       {a: 'E', b: 81},
//       {a: 'F', b: 53},
//       {a: 'G', b: 19},
//       {a: 'H', b: 87},
//       {a: 'I', b: 52}
//     ]
//   },
//   mark: 'bar',
//   encoding: {
//     x: {field: 'a', type: 'nominal', axis: {labelAngle: 0}},
//     y: {field: 'b', type: 'quantitative'}
//   }
// };
//
// const el = document.createElement('div');
//
// const config: Config = {
//   bar: {
//     color: 'firebrick'
//   }
// };
//
// const vegaSpec = compile(vegaLiteSpec, {config}).spec;
//
// (async () => {
//   await embed("#a", vegaSpec);
// })();
