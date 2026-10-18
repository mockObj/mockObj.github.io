import { test, expect } from '@playwright/test';

test('local loading preview supports replay, manual completion and instant loads without collection requests', async ({ page }) => {
  const dataRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/\/(?:collection|viewer)\.json|\/originals\//.test(request.url())) dataRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/content/me/loading-test/');
  await expect(page.getByRole('heading', { name: 'ローディングの確認' })).toBeVisible();
  await page.locator('#loading-delay').selectOption('manual');
  await expect(page.locator('#loading-screen')).toBeVisible();
  await page.locator('#loading-size').selectOption('mobile');
  expect((await page.locator('#loading-preview').boundingBox())!.width).toBe(390);
  await page.getByRole('button', { name: '今すぐ完了' }).click();
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
  await expect(page.locator('#loading-screen')).toHaveCount(0);
  await page.getByRole('button', { name: '再実行' }).click();
  await expect(page.locator('#loading-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: '今すぐ完了' })).toBeEnabled();
  await page.locator('#loading-delay').selectOption('0');
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(dataRequests).toEqual([]);
  expect(errors).toEqual([]);
});
