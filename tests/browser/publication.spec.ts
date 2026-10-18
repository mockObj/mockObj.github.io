import { test, expect } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';

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

test('a published collection with a registered but unplaced image never shows samples', async ({ page }) => {
  const image = 'data:image/jpeg;base64,' + (await readFile('public/content/me/assets/mouthwashing-official-capsule.jpg')).toString('base64');
  await page.route('**/content/me/collection.json', route => route.fulfill({ json: {
    version: 1, columns: 8, rows: 8, slots: Array(64).fill(null),
    items: [{ id: 'registered', title: 'Registered', image, width: 616, height: 353, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } }],
  } }));
  const sampleRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/content/me/assets/')) sampleRequests.push(request.url()); });
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#tiles [data-kind="empty"]').first()).toBeAttached();
  await expect(page.locator('#tiles [data-kind="preset"]')).toHaveCount(0);
  await expect(page.locator('#tiles .eye-surface img, #tiles .eye-surface svg')).toHaveCount(0);
  expect(sampleRequests).toEqual([]);
});
