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
  const html_template = fs.readFileSync(path.join(__dirname, 'payload', 'freeform_index.html'), 'utf8');
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'vega-lite-bundle.js'), 'utf8');
  // using esbuild-bundled codebase for vega lite so that all the vega lite code I have is built to be self contained
  // in one file and I assemble it here. The only import that will remain unbundled in that will be vega-lite itself,
  // which is what we cull in the next line.
  const code_inner = code
    .replace(/^import.*$/gm, '')
    .replace(/^\/\/# sourceMappingURL.*$/m, '');
  const ret = html_template
    .replace('[plot_placeholder]', JSON.stringify(plots))
    .replace('code placeholder', code_inner);
  // console.error('freeform.ts debug:', ret);
  return { html: ret };
}
