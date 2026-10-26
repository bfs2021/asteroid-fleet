import { expect, test } from '@playwright/test';

test('app loads, renders the canvas, and opens settings without console errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await expect(page.locator('canvas').first()).toBeVisible();

  // First visit opens the help modal, which blocks the rest of the UI.
  await page.getByRole('button', { name: 'Take command' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  expect(errors).toEqual([]);
});
