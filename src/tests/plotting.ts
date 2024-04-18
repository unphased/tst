import { test } from "../main.js";

export const plot_vega_simple = test('vega_lite', ({ plot, a: {eq} }) => {
  plot('vega_example', [{ title: 'test', data: [{a: 1, b: 2}, {a: 2, b: 2.5}]);
});
