import { test, expect } from '@playwright/test';

test('title', async ({ page }) => {
  await page.goto('http://localhost:4000/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/TST Results/);
});

test('should fail if there are any console errors', async ({ page }) => {
  // Listen to console events and fail the test on any error
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`Console error: ${message.text()}`);
      throw new Error(`Console error detected: ${message.text()}`);
    } else {
      console.log(`Console.${message.type()}: ${message.text()}`);
    }
  });

  // Navigate to the page you want to test
  await page.goto('http://localhost:4000/vega_lite:most_basic_plot_vega'); // Replace with your URL

  // Perform any actions you want to test
  // e.g., await page.click('button#submit');

  // Optional: Add an assertion to ensure the page has loaded correctly
  await expect(page).toHaveTitle('Plot');
});

