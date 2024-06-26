import { test, expect } from '@playwright/test';
import util from 'util';

test('title', async ({ page }) => {
  await page.goto('http://localhost:4000/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/TST Results/);
});

test('no console errors', async ({ page }) => {
  // Listen to console events and fail the test on any error
  page.on('console', async (message) => {
    if (message.type() === 'error') {
      console.error(`Console error: ${message.text()}`);
      throw new Error(`Console errors are forbidden: ${message.text()}`);
    } else {
      console.log(util.inspect(await Promise.all(message.args().map(arg => arg.jsonValue())), { depth: null }));
    }
  });

  // Navigate to the page you want to test
  await page.goto('http://localhost:4000/vega_lite:most_basic_plot_vega'); // Replace with your URL

  // Perform any actions you want to test
  // e.g., await page.click('button#submit');

  // Optional: Add an assertion to ensure the page has loaded correctly
  await expect(page).toHaveTitle('Plot');
});

