import * as path from "path";
import * as fs from "fs";
import { PlotFreeformData } from "./shared.js";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function freeform_assemble(plot: PlotFreeformData): string;
export function freeform_assemble(plots: PlotFreeformData[]): string;
export function freeform_assemble(plots: PlotFreeformData[] | PlotFreeformData) {
  if (!Array.isArray(plots)) {
    return freeform_assemble([plots]);
  }
  const html_template = fs.readFileSync(path.join(__dirname, 'payload', 'freeform_index.html'), 'utf8');
  return html_template.replace('[plot_placeholder]', JSON.stringify(plots));
}
