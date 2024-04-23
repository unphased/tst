// 0. Flexible in frontend lib used. Many good options exist. uPlot, plotly, scicharts are examples and once glue is
//    provided they can be mix and matched as needed.
// 1. Manage the frontend dependency transparently and dynamically - e.g. plotly is 3.5MB minified!
//    We source all these deps from a CDN, and cache it on the local system
// 2. (Not done here) Serve the result using a twist on static serving:
//    - don't need to (hit the) disk (serve deps and content from memory).
//    - API is provided to collect content for serving in one go. no dependency on the test framework I'm building in
//      tandem with this ability to serve up pages.
//    - (this is really just vague conceptual guidance) At the end we can serve content with various methods e.g.
//      - a simple interactive input to quit the server
//      - server quits after serving the page once
//      - ideally: serving indefinitely at end of test run
// so this file handles the specifics of generating a plot. it will produce some kind of a representation of a partial webpage.

// Important note: Due to the requirement of having plotting artifacts be generated and stored, from data not directly produced within a browser FE
// context, we have a "data firewall" situation where you can't just wrap callbacks in the plot data to pass along even
// more data for drawing or anything. This is a more permanent output format (raw self contained HTML files) so
// code-like constructs have to be explicitly described within the data. A mechanism for linking to id's between plots
// and from clicking on items within plots is provided, which should provide enough power to go quite far.

// We establish a consistent data format for a given class of data for visualization via multiple different libs
export type uPlotData = {
  title: string;
  // by default related ids will be processed across the pages belonging to the same test.
  id?: string;
  // Ids are used to associate charts with each other. Engine will do whatever is suitable via the given frontends to
  // make links that hop to and from all related items.
  related_ids?: string[];
  y_axes: string[] | {
    label: string;
    // legend renderer. will work as long as closure doesn't capture anything
    legendFn?: (self: any, rawValue: number, sidx: number, idx: number) => string;
    // The following define mappings from interacting with x/y to navigate to a given id, which now refers to other plots but could be other test output, probably... This provides important overview-graph to sub-graph navigation.
    // x returns index of x-value input into this plot, s is the index of the series which was clicked.
    clickNavMapXS?: string[];
    unit_prefix?: string;
    unit_suffix?: string;
    color?: string;
    width?: number;
    dash?: number[];
  }[];
  // often navigation wont depend on series, this is nicer
  clickNavMapX?: string[];
  targetNavGroupId?: string;
  data: number[][];
};

// page assembly takes place in these assemble function return objects. If you just Object.values().join() the object
// you get a valid full HTML page. if you grab .css and .content you can grab code to inject multiple into one html page.

type HtmlEmbeddingCssAndJs = {
  css_url?: string;
  js_code: string;
};
type Html = { html: string };
export type HtmlEmbedding = HtmlEmbeddingCssAndJs | Html;
// type guard
export const isHtmlEmbeddingCssAndJs = (e: HtmlEmbedding): e is HtmlEmbeddingCssAndJs => 'js_code' in e;

const unique = <T>(arr: T[]) => {
  return Array.from(new Set(arr));
}

export const build_html = (embeds: HtmlEmbedding[]) => {
  const modulars = embeds.filter(isHtmlEmbeddingCssAndJs);
  const prebuilts = embeds.filter(e => !isHtmlEmbeddingCssAndJs(e)) as Html[];
  console.error('build_html lens', modulars.length, prebuilts.length);
  type SegmentedHtmlPageAssembly = { html: string; } | { html_top: string;css: string;js_code: string;html_bottom: string; };
  const pages: SegmentedHtmlPageAssembly[] = [];
  if (prebuilts.length > 0) {
    pages.push(...prebuilts);
  }
  
  if (modulars.length > 0) {
    pages.push({
      html_top: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Plot</title>`,
      css: unique(modulars.map(e => e.css_url)).map(css_u => `<link rel="stylesheet" href="${css_u}" />`).join('\n'),
      js_code: modulars.map(e => `<script type="module">${e.js_code}</script>`).join('\n'),
      html_bottom: `</head><body></body></html>`,
    });
  }
  console.warn('pages', pages);
  return pages;
};

export type HtmlFullPage = ReturnType<typeof build_html>;
