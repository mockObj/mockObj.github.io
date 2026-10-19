import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openField(page: Page, fallback = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const manifests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/viewer.json')) manifests.push(request.url()); });
  await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
  if (fallback) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: any[]) {
      return kind.includes('webgl') ? null : original.call(this, kind, ...args);
    } as typeof original;
  });
  const items = await Promise.all(Array.from({ length: 12 }, (_, index) => '#' + (0x405060 + index * 0x070605).toString(16)).map(async (color, index) => {
    const pixels = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><ellipse cx="48" cy="48" rx="40" ry="24" fill="white"/><circle cx="48" cy="48" r="14" fill="black"/></svg>`)).png().toBuffer();
    return {
      id: `eye-${index}`, title: `Eye ${index}`, width: 96, height: 96,
      image: 'data:image/png;base64,' + pixels.toString('base64'),
      sourceUrl: `https://example.com/eye-${index}`, eye: { x: .5, y: .5, r: .26 },
    };
  }));
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items } }));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#viewer-status')).toBeEmpty();
  await expect(page.locator('.eye-tile[data-kind="item"]').first()).toBeAttached();
  await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
  expect(manifests).toHaveLength(1);
  await page.clock.pauseAt(new Date('2026-10-20T00:00:10Z'));
  return errors;
}

async function winLottery(page: Page, type: 'glance' | 'blink') {
  await page.evaluate(type => {
    // 1/4 succeeds at the new 10s / 30s rate, but not the former 10s / 180s.
    const draws = [.25, 0, type === 'blink' ? 0 : .75, 0, 0];
    Math.random = () => draws.shift() ?? .99;
  }, type);
  await page.clock.runFor(49000);
  // Even a guaranteed winning draw cannot cause an event in the first minute.
  await expect(page.locator('[data-idle-effect]')).toHaveCount(0);
  for (let step = 0; step < 150; step++) {
    await page.clock.runFor(16);
    if (await page.locator('[data-idle-effect]').count()) break;
  }
  const tile = page.locator(`[data-idle-effect="${type}"]`);
  await expect(tile).toHaveCount(1);
  const position = await tile.evaluate(element => {
    const tile = element as HTMLElement & { _screenX: number; _screenY: number };
    const size = parseFloat(tile.style.width);
    return { x: tile._screenX + size / 2, y: tile._screenY + size / 2 };
  });
  expect(Math.min(position.x, 390 - position.x, position.y, 844 - position.y)).toBeLessThanOrEqual(390 * .16);
  return tile;
}

test('an edge eye centers more slowly and returns at its original speed', async ({ page }) => {
  const errors = await openField(page);
  const tile = await winLottery(page, 'glance');
  const coordinate = await tile.evaluate(element => ({ column: (element as HTMLElement).dataset.column, row: (element as HTMLElement).dataset.row }));
  const tracked = page.locator(`[data-column="${coordinate.column}"][data-row="${coordinate.row}"]`);
  const displacement = () => tracked.evaluate(element => {
    const tile = element as HTMLElement & { _imageX: number; _imageY: number };
    return Math.hypot(tile._imageX, tile._imageY);
  });
  const before = await displacement();
  expect(before).toBeGreaterThan(3);
  const image = await tracked.getAttribute('data-image-id');
  await page.clock.runFor(96);
  // Previously the image was fully centered by 72ms; it is still moving now.
  expect(await displacement()).toBeGreaterThan(before * .03);
  expect(await displacement()).toBeLessThan(before * .35);
  await page.clock.runFor(48);
  expect(await displacement()).toBeLessThan(.1);
  await page.clock.runFor(84);
  // Return starts at 168ms and still takes 120ms, as before.
  expect(await displacement()).toBeGreaterThan(before * .25);
  expect(await displacement()).toBeLessThan(before * .65);
  await page.clock.runFor(80);
  expect(await displacement()).toBeCloseTo(before, 1);
  await expect(page.locator('[data-idle-effect]')).toHaveCount(0);
  await expect(tracked).toHaveAttribute('data-image-id', image!);
  expect(errors).toEqual([]);
});

for (const fallback of [false, true]) test(`an individual blink swaps only its covered image (${fallback ? 'DOM' : 'WebGL'})`, async ({ page }, testInfo) => {
  const errors = await openField(page, fallback);
  // The same duration parameter drives local and full-screen blinks.
  await page.evaluate(() => document.documentElement.style.setProperty('--blink-duration', '840ms'));
  const original = await page.locator('.eye-tile').evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.imageId));
  const tile = await winLottery(page, 'blink');
  const coordinate = await tile.evaluate(element => ({ column: (element as HTMLElement).dataset.column, row: (element as HTMLElement).dataset.row }));
  const before = await tile.getAttribute('data-image-id');
  await page.clock.runFor(32);
  await expect(tile.locator('.eye-blink')).toHaveCount(1);
  const durations = await tile.locator('.eye-blink').evaluate(overlay => overlay.getAnimations({ subtree: true }).map(animation => animation.effect!.getComputedTiming().duration));
  expect(durations).toEqual([840, 840]);
  await page.clock.runFor(200);
  await expect(tile).toHaveAttribute('data-image-id', before!);
  await page.clock.runFor(96);
  const pose = await tile.evaluate(element => {
    const upper = element.querySelector('.loading-blink__upper')!;
    const lower = element.querySelector('.loading-blink__lower')!;
    return { upper: new DOMMatrixReadOnly(getComputedStyle(upper).transform).m42, lower: new DOMMatrixReadOnly(getComputedStyle(lower).transform).m42 };
  });
  expect(pose.upper).toBeCloseTo(0, 1);
  expect(pose.lower).toBeCloseTo(0, 1);
  await expect(tile).not.toHaveAttribute('data-image-id', before!);
  await page.screenshot({ path: testInfo.outputPath('individual-blink-closed.png') });
  await page.clock.runFor(600);
  await expect(page.locator('.eye-blink')).toHaveCount(0);
  await expect(page.locator('[data-idle-effect]')).toHaveCount(0);
  const after = await page.locator('.eye-tile').evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.imageId));
  expect(after.filter((id, index) => id !== original[index])).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath('individual-blink-open.png') });
  const changed = page.locator(`[data-column="${coordinate.column}"][data-row="${coordinate.row}"]`);
  const imageId = await changed.getAttribute('data-image-id');
  await expect(changed).toHaveAttribute('href', `https://example.com/${imageId}`);
  const neighbors = await page.locator('.eye-tile').evaluateAll((tiles, coordinate) => tiles.filter(tile => {
    const dx = Number((tile as HTMLElement).dataset.column) - Number(coordinate.column);
    const dy = Number((tile as HTMLElement).dataset.row) - Number(coordinate.row);
    return Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy);
  }).map(tile => (tile as HTMLElement).dataset.imageId), coordinate);
  expect(neighbors).toHaveLength(8);
  expect(neighbors).not.toContain(imageId);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.clock.runFor(32);
  await expect(changed).toHaveAttribute('data-image-id', imageId!);
  expect(errors).toEqual([]);
});

async function verifyDebugControls(page: Page, screenshotPath: string) {
  const errors = await openField(page);
  await page.clock.resume();
  await page.getByText('動作確認', { exact: true }).click();
  await page.locator('#debug-blink-duration').fill('1200');
  expect(await page.evaluate(() => performance.now())).toBeLessThan(60000);
  await page.getByRole('button', { name: 'A：視線を戻す', exact: true }).click();
  await expect(page.locator('[data-idle-effect="glance"]')).toHaveCount(1);
  await expect(page.locator('[data-idle-effect="glance"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'B：まばたき・交換', exact: true }).click();
  await expect(page.locator('.eye-blink')).toHaveCount(1);
  const duration = await page.locator('.eye-blink').evaluate(overlay => overlay.getAnimations({ subtree: true })[0].effect!.getComputedTiming().duration);
  expect(duration).toBe(1200);
  const scope = await page.locator('.eye-blink').evaluate(overlay => {
    const tile = overlay.closest('.eye-tile') as HTMLElement & { _screenX: number; _screenY: number };
    const side = parseFloat(tile.style.width);
    const field = document.getElementById('field')!;
    const x = tile._screenX + side / 2, y = tile._screenY + side / 2;
    const rect = overlay.getBoundingClientRect(), frame = tile.querySelector('.eye-hit')!.getBoundingClientRect();
    return { edge: Math.min(x, field.clientWidth - x, y, field.clientHeight - y), band: Math.min(field.clientWidth, field.clientHeight) * .16,
      overlay: [rect.x, rect.y, rect.width, rect.height], frame: [frame.x, frame.y, frame.width, frame.height], opacity: getComputedStyle(field).opacity };
  });
  expect(scope.edge).toBeLessThanOrEqual(scope.band);
  expect(scope.overlay).toEqual(scope.frame);
  expect(scope.opacity).toBe('1');
  const cameraY = () => page.locator('.eye-tile').first().evaluate(element => {
    const tile = element as HTMLElement & { _screenY: number };
    return tile._screenY - Number(tile.dataset.row) * parseFloat(tile.style.height);
  });
  await page.mouse.move(190, 400);
  await page.mouse.wheel(0, 35);
  const start = await cameraY();
  await expect.poll(cameraY).toBeLessThan(start - 3);
  await expect(page.locator('.eye-blink')).toHaveCount(1);
  await page.screenshot({ path: screenshotPath });
  await expect(page.locator('.eye-blink')).toHaveCount(0);
  expect(errors).toEqual([]);
}

test('local debug controls run both effects immediately while inertia keeps moving', async ({ page }, testInfo) => {
  await verifyDebugControls(page, testInfo.outputPath('local-debug-mobile.png'));
});

test.describe('desktop debug controls', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('effects stay within an edge tile while the field coasts', async ({ page }, testInfo) => {
    await verifyDebugControls(page, testInfo.outputPath('local-debug-desktop.png'));
  });
});

test('reduced motion suppresses spontaneous effects', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openField(page);
  await page.evaluate(() => { Math.random = () => 0; });
  await page.clock.runFor(240000);
  await expect(page.locator('[data-idle-effect], .eye-blink')).toHaveCount(0);
  expect(errors).toEqual([]);
});
