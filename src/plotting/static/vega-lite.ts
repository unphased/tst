import vegaEmbed from 'vega-embed';
import { type PlotFreeformData } from '../shared.js';

(window.plots as PlotFreeformData[]).forEach((pl, i) => {
  const el = document.createElement('div');
  const id = 'plot' + i;
  el.setAttribute('id', id);
  document.body.appendChild(el);
  console.log("appended", el);

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
  } as const;
  vegaEmbed('#' + id, spec).then(ret => { console.log("embed ret", ret) }).catch(e => { throw e; });
});
