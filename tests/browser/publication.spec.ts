import { test, expect } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';

test('the published build serves the viewer without any editor or draft preview', async ({ page, request }) => {
  const originalRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/collection.json')) originalRequests.push(request.url()); });
  const response = await page.goto('/content/me/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#tiles > *').first()).toBeAttached();
  await expect(page.locator('#viewer-status')).toBeEmpty();
  await expect(page.locator('a[href="/content/me/editor/"]')).toHaveCount(0);
  expect((await request.head('/content/me/collection.json')).status()).toBe(404);
  await expect(access('dist/content/me/originals')).rejects.toThrow();
  const manifest = await request.get('/content/me/viewer.json');
  expect(manifest.status()).toBe(200);
  expect((await manifest.body()).length).toBeLessThan(200000);
  expect((await manifest.json()).items.every((item: { image: string }) => !item.image.startsWith('data:'))).toBe(true);
  expect(originalRequests).toEqual([]);

  expect((await request.post('/content/me/publish/', { data: 'test' })).status()).toBe(404);
  for (const route of ['editor', 'preview', 'publish']) {
    expect((await request.get(`/content/me/${route}/`)).status()).toBe(404);
    expect((await request.get(`/content/me/${route}/index.html`)).status()).toBe(404);
    await expect(access(`dist/content/me/${route}/index.html`)).rejects.toThrow();
  }
});

test('a legacy unplaced image is placed automatically and never shows samples', async ({ page }) => {
  const image = 'data:image/jpeg;base64,' + (await readFile('public/content/me/assets/mouthwashing-official-capsule.jpg')).toString('base64');
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: {
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
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items } }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#tiles [data-kind="item"]').first()).toBeAttached();
  await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
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
  for (let row = 0; row < 8 && seen.size < 100; row++) {
    for (let column = 0; column < 2; column++) await pan(cellSize * (row % 2 ? -8 : 8), 0);
    if (row < 7 && seen.size < 100) await pan(0, cellSize * 5);
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

for (const device of [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) test.describe(`loading timing on ${device.name}`, () => {
  test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch });
  test('eyes close steadily to 75%, slow down while pending and finish without a jump', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/content/me/viewer.json', async route => { await gate; await route.fulfill({ json: { version: 2, items: [] } }); });
    await page.goto('/content/me/', { waitUntil: 'domcontentloaded' });
    const loader = page.locator('#loading-screen');
    await expect(loader).toBeVisible();
    await expect(loader.locator('.loading-caption')).toHaveText('Now loading...');
    const caption = await loader.locator('.loading-caption').boundingBox();
    const eyes = await loader.locator('.loader').boundingBox();
    expect(caption!.y + caption!.height).toBeLessThan(eyes!.y);
    const pose = (time: number) => loader.evaluate((element, time) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        animation.pause(); animation.currentTime = time + Number(animation.effect!.getTiming().delay);
      }
      return new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.loader__eye')!, '::after').transform).m42;
    }, time);
    expect(await pose(0)).toBe(0);
    expect(await pose(375)).toBeCloseTo(6, 1);
    expect(await pose(750)).toBeCloseTo(12, 1);
    const afterOneSecond = await pose(1000);
    expect(afterOneSecond).toBeGreaterThan(14);
    expect(afterOneSecond).toBeLessThan(15);
    const afterTwoSeconds = await pose(2000);
    expect(afterTwoSeconds - afterOneSecond).toBeLessThan(2);
    expect(await pose(4000)).toBeCloseTo(0, 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await pose(1125)).toBeCloseTo(12, 1);
    expect(await pose(6000)).toBeCloseTo(0, 1);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await pose(375);
    await expect(loader).toBeVisible();
    await expect(loader).not.toHaveAttribute('data-ready');
    await page.waitForTimeout(180);
    release();
    await expect(loader).toHaveAttribute('data-ready', 'true', { timeout: 15000 });
    await expect.poll(() => loader.locator('.loader').evaluate(element => parseFloat((element as HTMLElement).style.getPropertyValue('--lid-duration')))).toBeGreaterThan(600);
    const finishingPose = await loader.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.loader__eye')!, '::after').transform).m42);
    expect(finishingPose).toBeLessThan(12);
    await expect(loader).toHaveClass(/is-leaving/);
    await expect(loader).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#field')).not.toHaveAttribute('aria-busy');
  });
});

test.describe('loading and constrained browsers', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('images still render with WebGL disabled in an embedded browser', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (type: string, ...args: unknown[]) {
        return type === 'webgl' || type === 'experimental-webgl' ? null : Reflect.apply(original, this, [type, ...args]);
      } });
    });
    const image = 'data:image/jpeg;base64,' + (await readFile('public/content/me/assets/mouthwashing-official-capsule.jpg')).toString('base64');
    await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items: [
      { id: 'fallback', title: 'Eye', image, width: 616, height: 353, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } },
    ] } }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/content/me/', { waitUntil: 'networkidle' });
    await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('#scene')).toBeHidden();
    const images = page.locator('.eye-tile .eye-surface img[src]');
    expect(await images.count()).toBeGreaterThan(10);
    expect(await images.first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(616);
    expect(errors).toEqual([]);
  });
});
