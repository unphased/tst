// implements various glue to provide simple and quick plotting.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from 'url';
import { HtmlEmbedding, uPlotData } from "./index.js";
import { assertions } from "../assertions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isStringArray(arr: any[]): arr is string[] {
  return arr.every(e => typeof e === 'string');
}

const colors = ["red", "green", "blue", "orange", "purple", "brown", "black", "pink", "gray", "cyan", "magenta"];

const uPlot_preprocess = (plotdata: uPlotData[]) => plotdata.map(d => {
  assertions.eq(d.y_axes.length, d.data.length - 1, 'y_axes length should be data length - 1');
  assertions.is(d.data.every(row => row.length === d.data[0].length), 'all rows should have same length');

  // uplot configuration
  const opts = {
    title: d.title,
    id: d.id || undefined,
    class: "uplot-chart",
    width: 1800,
    height: 700,
    focus: {
      alpha: 0.1
    },
    cursor: {
      focus: {
        prox: 5,
      },
      drag: {
        x: true,
      },
    },
    // ms: 1e-3,
    scales: {
      x: {
        time: false,
      }
    },
    series: [
      {},
      ... d.y_axes.map((y_axis: uPlotData['y_axes'][0], i: number) => {
        const y = typeof y_axis === 'object' ? y_axis : { label: y_axis };
        return {
          // initial toggled state (optional)
          show: true,
          spanGaps: true,
          // in-legend display
          label: y.label,
          // THIS WONT SURVIVE JSON STRINGIFY (papered over with impl below)
          // value: (self, rawValue, sidx, idx) => 'sidx: ' + sidx + " idx: " + idx + ' ' + typeof rawValue === 'number' ? (y.unit_prefix || '') + rawValue.toFixed(2) + (y.unit_suffix || '') : '',
          // series style
          stroke: y.color || colors[i % colors.length],
          width: y.width || 1,
          // fill: "rgba(255, 0, 0, 0.3)",
          // dash: [10, 5],
        };
      })
    ],
  };

  // uplot data requires x axis data to be ascending. This means collate and sort.
  const collated = d.data[0].map((_, i) => d.data.map(row => row[i]));
  // transpose
  collated.sort((a, b) => a[0] - b[0]); // sort by first col which is x axis.
  const uncollated = d.data.map((_, i) => collated.map(row => row[i]));
  const { targetNavGroupId } = d;
  const y_cNMXS = d.y_axes.filter(y => y instanceof Object && y.clickNavMapXS) as Exclude<typeof d.y_axes[0], string>[];
  if (y_cNMXS.some(y => !Array.isArray(y.clickNavMapXS) || y.clickNavMapXS.length !== d.data[0].length)) {
    throw new Error('clickNavMapXS must be an array of arrays of strings of the same length as the x axis');
  }
  if (d.clickNavMapX && (typeof d.clickNavMapX !== 'object' || !Array.isArray(d.clickNavMapX) || d.clickNavMapX.length !== d.data[0].length)) {
    throw new Error('clickNavMapX must be an array of strings of the same length as the x axis');
  } // tbh i am unsure i should have dynamic assertions like this since type checking does the job and this adds maint burden.
  return { opts, data: uncollated, targetNavGroupId, mappingX: d.clickNavMapX, mappingSX: d.y_axes.map(y => y.clickNavMapXS) };
});

// TODO break dep fetching out (define that cache policy... home/dotdir most likely (tmp kinda risky for hopping on a plane)) so we can serve this fully locally
export const uPlot_assemble = (plots: uPlotData[]): HtmlEmbedding => ({
  css_url: 'https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css',
  js_code: `import uplot from 'https://cdn.jsdelivr.net/npm/uplot@1.6.30/+esm';
window.data = ${JSON.stringify(uPlot_preprocess(plots))};
${plots.flatMap((p, i) => !isStringArray(p.y_axes) ? p.y_axes.map((y, j) => y.legendFn ? `data[${i}].opts.series[${j+1}].value = ${y.legendFn.toString()};` : '') : undefined).filter(e => e).join('\n')}
${fs.readFileSync(path.resolve(__dirname, 'payload', 'uplot_handle.js'), 'utf8')}`
});
// The above is a huge mess but will not fail unless a closure captures variables.
