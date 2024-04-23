// import { writeFileSync } from "fs";
import { uPlot_assemble } from "../plotting/uplot.js";
import { build_html } from "../plotting/index.js";
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

export const simple_uplot = test('plotting', ({ l, plot, t, a: {eq} }) => {
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
  plot('uplot', plots1, 'testing plotting');
  plot('uplot', plots2, 'testing plotting');
  const page = build_html([uPlot_assemble(plots1), uPlot_assemble(plots2)]);
  eq(page.length, 1);
  const html = Object.values(page[0]).join('\n');
  const parser = new XMLParser(htmlParseOptions);
  // validation throws on errors so by validating it we are asserting.
  t('exemptFromAsserting', true);
  // perform full HTML validation
  try {
    l(parser.parse(html, true));
  } catch (e) {
    l('failed to xml validate page:', html);
    throw 'bad';
  }
  writeFileSync('simple_uplot.html', html);
});

