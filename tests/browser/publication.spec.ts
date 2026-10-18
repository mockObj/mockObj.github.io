import { test, expect } from '@playwright/test';
import { access } from 'node:fs/promises';

test('the published build serves the viewer without any editor or draft preview', async ({ page, request }) => {
  const response = await page.goto('/content/me/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#tiles > *').first()).toBeAttached();
  await expect(page.locator('#viewer-status')).toBeEmpty();
  await expect(page.locator('a[href="/content/me/editor/"]')).toHaveCount(0);
  expect((await request.get('/content/me/collection.json')).status()).toBe(200);

  for (const route of ['editor', 'preview']) {
    expect((await request.get(`/content/me/${route}/`)).status()).toBe(404);
    expect((await request.get(`/content/me/${route}/index.html`)).status()).toBe(404);
    await expect(access(`dist/content/me/${route}/index.html`)).rejects.toThrow();
  }
});
