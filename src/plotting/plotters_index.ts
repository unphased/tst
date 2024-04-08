import { freeform_assemble } from "./freeform.js";
// import { vega_lite_assemble } from "./vega-lite.js";
import { uPlot_assemble } from "./uplot.js";

export const plotters = {
  'uplot': uPlot_assemble,
  // 'vega': vega_lite_assemble,
  'vega_example': freeform_assemble
};

