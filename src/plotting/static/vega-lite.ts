import vegaEmbed from 'vega-embed';

import { type PlotFreeformData } from '../shared.js';
import { Hypercube } from './hypercube.js';

let i = 0;
const genPlot = (data: any[], title: string) => {
  const el = document.createElement('div');
  while (document.getElementById('plot' + i)) { i++; }
  const id = 'plot' + i++;
  el.setAttribute('id', id);
  document.body.appendChild(el);

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "title": title,
    "data": {
      "values": data
    },
    "mark": "bar",
    "encoding": {
      "x": {"field": "a", "type": "nominal"},
      "y": {"field": "b", "type": "quantitative"}
    }
  } as const;
  vegaEmbed('#' + id, spec).then(ret => { console.log("embed ret", ret) }).catch(e => { throw e; });
}

(window.plots as PlotFreeformData[]).forEach((pl) => {
  console.log("data", pl);
  const cube = Hypercube(pl.data);
  console.log("cube", cube);
  const {title, data} = pl;
  genPlot(data, title)
});
