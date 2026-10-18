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

test('a legacy unplaced image is placed automatically and never shows samples', async ({ page }) => {
  const image = 'data:image/jpeg;base64,' + (await readFile('public/content/me/assets/mouthwashing-official-capsule.jpg')).toString('base64');
  await page.route('**/content/me/collection.json', route => route.fulfill({ json: {
    version: 1, columns: 8, rows: 8, slots: Array(64).fill(null),
    items: [{ id: 'registered', title: 'Registered', image, width: 616, height: 353, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } }],
  } }));
  const sampleRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/content/me/assets/')) sampleRequests.push(request.url()); });
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#tiles [data-kind="item"]').first()).toBeAttached();
  await expect(page.locator('#tiles [data-kind="preset"]')).toHaveCount(0);
  await expect(page.locator('#tiles [data-kind="empty"]')).toHaveCount(0);
  expect(sampleRequests).toEqual([]);
});

test('more than 64 registered images appear across an unbounded field and stay fixed when scrolling back', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const items = await page.evaluate(() => Array.from({ length: 100 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `hsl(${index * 137.508 % 360} 45% 30%)`; context.fillRect(0, 0, 96, 64);
    context.fillStyle = '#eee'; context.beginPath(); context.ellipse(48, 32, 28, 14, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = `hsl(${index * 83 % 360} 65% 50%)`; context.beginPath(); context.arc(48, 32, 11, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#111'; context.beginPath(); context.arc(48, 32, 5, 0, Math.PI * 2); context.fill();
    return { id: `eye-${index}`, title: `Eye ${index}`, image: canvas.toDataURL('image/png'), width: 96, height: 64, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } };
  }));
  await page.route('**/content/me/collection.json', route => route.fulfill({ json: { version: 2, items } }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#tiles [data-kind="item"]').first()).toBeAttached();
  const snapshot = () => page.locator('#tiles .eye-tile').evaluateAll(tiles => Object.fromEntries(tiles.map(tile => {
    const element = tile as HTMLElement;
    return [`${element.dataset.column}:${element.dataset.row}`, element.dataset.imageId];
  })));
  const original = await snapshot();
  const seen = new Set(Object.values(original));
  const cellSize = await page.locator('#tiles .eye-tile').first().evaluate(tile => tile.getBoundingClientRect().width);
  let panX = 0, panY = 0;
  const pan = async (x: number, y: number) => {
    const before = await snapshot();
    await page.mouse.wheel(x, y);
    await expect.poll(snapshot).not.toEqual(before);
    panX += x; panY += y;
    Object.values(await snapshot()).forEach(id => seen.add(id));
  };
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 2; column++) await pan(cellSize * (row % 2 ? -8 : 8), 0);
    if (row < 3) await pan(0, cellSize * 5);
  }
  expect(seen.size).toBe(100);
  await pan(-panX, -panY);
  await expect.poll(snapshot).toEqual(original);
  await expect(page.locator('#tiles [data-kind="preset"], #tiles [data-kind="empty"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('random-field-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('random-field-mobile.png') });
  expect(errors).toEqual([]);
});
