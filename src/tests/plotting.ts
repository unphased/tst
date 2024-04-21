import { test } from "../main.js";

export const most_basic_plot_vega = test('vega_lite', ({ plot, a: {eq} }) => {
  plot('vega_example', {
    title: 'test',
    data: [
      {a: 1, b: 2},
      {a: 1.2, b: 2},
      {a: 2, b: 2.5},
      {a: 3, b: 3.5}
    ]
  });
});

export const most_basic_two_plots_vega = test('vega_lite', ({ plot, a: {eq} }) => {
  plot('vega_example', [{
    title: 'title 1', data: [{a: 1, b: 1}, {a: 2, b: 2}]
  }, {
    title: 'title 2', data: [{a: 1, b: 2}, {a: 2, b: 3}]
  }])
});

