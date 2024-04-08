import * as path from "path";
import { PlotFreeformData } from "./index.js"; 
const __dirname = path.dirname(import.meta.url);

export function freeform_assemble(plot: PlotFreeformData): string;
export function freeform_assemble(plots: PlotFreeformData[]): string;
export function freeform_assemble(plots: PlotFreeformData[] | PlotFreeformData) {
  if (!Array.isArray(plots)) {
    return freeform_assemble([plots]);
  }
  const html_template = path.resolve(__dirname, 'freeform_index.html');
  return html_template.replace('{PlotDataPlaceholder: undefined}', JSON.stringify(plots));
}
