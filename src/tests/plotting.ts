import { test } from "../main.js";

export const most_basic_plot_vega = test('vega_lite', ({ plot, a: {eq} }) => {
  plot('vega_example', [{
    title: 'test',
    data: [
      {a: 1, b: 2},
      {a: 1.2, b: 2},
      {a: 2, b: 2.5}
    ]
  }]);
});
