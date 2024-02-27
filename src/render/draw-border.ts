import { lexAnsi, colors } from "ts-utils/terminal";

export const drawBorder = (content: string, heading_summary: string) => {
  const ansi = lexAnsi(content);
  const maxContentWidth = Math.max(...ansi.cleaned.map(line => line.length));

  const left_margin = '┃';
  const horiz_padding = ' '; // not border styled
  const right_margin = '┃';
  const horiz_margin_tot = left_margin.length + right_margin.length + 2 * horiz_padding.length;

  let horizLimit = 78; // a sane default
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // Do a bit of formatting. Mostly to implement wrapping within the border. And handle correct line deletion amount
    // for re-rendering.
    const horizontal = process.stdout?.columns;
    horizLimit = horizontal - horiz_margin_tot; // for border
  }

  const working_width = Math.min(maxContentWidth, horizLimit);
  const width_tot = working_width + horiz_margin_tot;

  // perform wrapping on raw content, must handle ansi codes as zerolength
  const wrapped_nested = content.split('\n').map((line, i) => ansi.cleaned[i].length > horizLimit ? splitString(line, horizLimit, ansi.idxs[i], ansi.lens[i]) : line); // Array made of both strings (lines, not long enough to wrap) and inner arrays (which are wrapped lines).

  // the last entry in each wrapped line is the only one out of those that needs to be padded with spaces to the right.
  // build lengths in same shape first
  const lengths = wrapped_nested.map((e, i) => Array.isArray(e) ? [...Array(e.length - 1).fill(horizLimit), ansi.cleaned[i].length % horizLimit] : ansi.cleaned[i].length);
  // console.log('wrapped_nested, lengths, w_t, hL, mCW:', wrapped_nested, lengths, width_tot, horizLimit, maxContentWidth);
  const border_style = colors.medium_grey_bg + colors.yellow;
  const heading = ` Test Results (${heading_summary}) `;
  const corners = '┏┓┗┛';
  const heading_padding = '━'; // repeated in the heading border
  const heading_full_width = heading_padding.repeat(Math.ceil(width_tot / heading_padding.length)).slice(0, width_tot - 2);
  const heading_left_len = Math.floor((width_tot - heading.length) / 2) - 1;
  const heading_right_len = width_tot - heading_left_len - heading.length - 2; // 2 because above var has 1 subtracted
  const heading_left = corners[0] + heading_full_width.slice(0, heading_left_len);
  const heading_right = heading_full_width.slice(0, heading_right_len) + corners[1];
  const heading_line = border_style + heading_left + colors.bold + heading + colors.bold_reset + heading_right + colors.reset;
  const bottom_line = border_style + corners[2] + heading_full_width + corners[3] + colors.reset;
  let output = heading_line;
  const wnf = wrapped_nested.flat();
  const lf = lengths.flat();
  output += `\n${wnf.map((l, i) => border_style + left_margin + colors.reset + horiz_padding + l + ' '.repeat(working_width - lf[i]) + horiz_padding + border_style + right_margin + colors.reset).join('\n')}`;
  output += `\n${bottom_line}`;
  return output;
};

export function splitString(str: string, n: number, zero_width_starts: number[], zero_width_lengths: number[]) {
  const result: string[] = [];
  let j = 0 // iterates zw items
  for (let i = 0; i < str.length;) {
    let nn = n;
    for (; zero_width_starts[j] < i + nn; j++) {
      nn += zero_width_lengths[j];
    }
    result.push(str.slice(i, i + nn));
    i += nn;
  }
  return result;
}
