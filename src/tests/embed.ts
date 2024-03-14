// import { writeFileSync } from "fs";
import { uPlot_assemble } from "../plotting/uplot.js";
import { build_html_page } from "../plotting/index.js";
import { test } from "../main.js";
import { XMLParser } from "fast-xml-parser";
import { writeFileSync } from "fs";

const htmlParseOptions = {
  ignoreAttributes: false,
  // preserveOrder: true,
  unpairedTags: ["hr", "br", "link", "meta"],
  stopNodes: ["*.pre", "*.script"],
  processEntities: true,
  htmlEntities: true
}

export const simple_uplot = test('plotting', ({ l, p, t }) => {
  const plots1 = [
    {
      title: '1st chart',
      y_axes: ['aa', 'bb', 'cc'],
      data: [[1, 2], [3, 4], [5, 6], [5, 3]]
    }, {
      title: '2nd chart',
      y_axes: ['a', 'b'],
      data: [
        [1, 2, 3],
        [3, 4, 5],
        [6, 5, 2],
      ]
    }
  ];
  const plots2 = [
    {
      title: '3rd chart',
      y_axes: ['a'],
      data: [[1, 2], [1, 2]]
    }
  ];
  p('uplot', plots1, 'testing plotting');
  p('uplot', plots2, 'testing plotting');
  const html = Object.values(build_html_page([uPlot_assemble(plots1), uPlot_assemble(plots2)])).join('\n');
  const parser = new XMLParser(htmlParseOptions);
  // perform full HTML validation
  const output = parser.parse(html, true);
  // validation throws on errors so by validating it we are asserting.
  t('exemptFromAsserting', true);
  l(output);
  writeFileSync('simple_uplot.html', html);
});

