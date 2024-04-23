import * as path from "path";
import * as fs from "fs";
import { PlotFreeformData } from "./shared.js";
import { fileURLToPath } from "url";
import { HtmlEmbedding } from "./index.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function freeform_assemble(plot: PlotFreeformData): HtmlEmbedding;
export function freeform_assemble(plots: PlotFreeformData[]): HtmlEmbedding;
export function freeform_assemble(plots: PlotFreeformData[] | PlotFreeformData) {
  if (!Array.isArray(plots)) {
    return freeform_assemble([plots]);
  }
  const code = `
import * as vega from "https://esm.sh/vega@5";
import * as vega_lite from "https://esm.sh/vega-lite@5";
import vegaEmbed from "https://esm.sh/vega-embed@6";
window.plots = ${JSON.stringify(plots)};
${fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'vega-lite-bundle.js'), 'utf8').replace(/^import.*$/gm, '').replace(/^\/\/# sourceMappingURL.*$/m, '')}`;
  return { js_code: code };
}
