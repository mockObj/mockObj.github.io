import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { VIEWER_SETTINGS } from '../../src/scripts/viewer-settings.js';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openField(page: Page, fallback = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const manifests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/viewer.json')) manifests.push(request.url()); });
  await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
  await page.addInitScript(() => { Math.random = () => .99; });
  // Keep the lottery guard deterministic while the owner tunes live frequency.
  await page.route('**/src/scripts/viewer-settings.js*', async route => {
    const response = await route.fetch();
    let source = await response.text();
    for (const [key, value] of Object.entries({ startDelayMs: 60000, checkIntervalMs: 10000, meanIntervalMs: 30000 })) {
      source = source.replace(new RegExp(`\\b${key}:\\s*[\\d.]+,`), `${key}: ${value},`);
    }
    await route.fulfill({ response, body: source });
  });
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
    // 1/4 succeeds at the fixture's 10s / 30s rate.
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
  const position = await tile.locator('.eye-hit').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  expect(position.right).toBeGreaterThan(0);
  expect(position.left).toBeLessThan(390);
  expect(position.bottom).toBeGreaterThan(0);
  expect(position.top).toBeLessThan(844);
  expect(Math.min(position.left, 390 - position.right, position.top, 844 - position.bottom)).toBeLessThanOrEqual(390 * VIEWER_SETTINGS.idle.edgeBand);
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
  const { centerMs, holdMs, returnMs } = VIEWER_SETTINGS.glance;
  await page.clock.runFor(centerMs / 2);
  expect(await displacement()).toBeGreaterThan(before * .45);
  expect(await displacement()).toBeLessThan(before * .55);
  await page.clock.runFor(centerMs / 2 + 32);
  expect(await displacement()).toBeLessThan(.1);
  await page.clock.runFor(holdMs / 2);
  expect(await displacement()).toBeLessThan(.1);
  await page.clock.runFor(holdMs / 2 + returnMs / 2 - 32);
  expect(await displacement()).toBeGreaterThan(before * .35);
  expect(await displacement()).toBeLessThan(before * .65);
  await page.clock.runFor(returnMs / 2 + 64);
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
    const field = document.getElementById('field')!;
    const rect = overlay.getBoundingClientRect(), frame = tile.querySelector('.eye-hit')!.getBoundingClientRect();
    return { edge: Math.min(frame.left, field.clientWidth - frame.right, frame.top, field.clientHeight - frame.bottom), band: Math.min(field.clientWidth, field.clientHeight) * .16,
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

async function verifyClippedEdges(page: Page) {
  const errors = await openField(page);
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const selected = await page.evaluate(({ edge, bandRatio }) => {
      const field = document.getElementById('field')!;
      const width = field.clientWidth, height = field.clientHeight;
      const band = Math.min(width, height) * bandRatio;
      const candidates = [...document.querySelectorAll<HTMLElement>('.eye-tile')].filter(tile => {
        const rect = tile.querySelector('.eye-hit')!.getBoundingClientRect();
        return tile.style.visibility === 'visible' && rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height
          && Math.min(rect.left, width - rect.right, rect.top, height - rect.bottom) <= band;
      });
      const index = candidates.findIndex(tile => {
        const rect = tile.querySelector('.eye-hit')!.getBoundingClientRect();
        return edge === 'left' ? rect.left < 0 : edge === 'right' ? rect.right > width : edge === 'top' ? rect.top < 0 : rect.bottom > height;
      });
      if (index < 0) throw new Error(`No partially clipped ${edge} frame`);
      Math.random = () => (index + .5) / candidates.length;
      const tile = candidates[index];
      document.querySelector<HTMLButtonElement>('[data-effect="glance"]')!.click();
      return { column: tile.dataset.column, row: tile.dataset.row };
    }, { edge, bandRatio: VIEWER_SETTINGS.idle.edgeBand });
    await page.clock.runFor(32);
    await expect(page.locator(`[data-column="${selected.column}"][data-row="${selected.row}"]`)).toHaveAttribute('data-idle-effect', 'glance');
    await expect(page.locator('[data-idle-effect]')).toHaveCount(1);
  }
  expect(errors).toEqual([]);
}

test('partially visible frames on all four mobile edges remain eligible', async ({ page }) => {
  await verifyClippedEdges(page);
});

test('GPU images use DOM fallback during context loss and recover without duplicate images', async ({ page }) => {
  const errors = await openField(page);
  await expect(page.locator('.eye-tile.is-gpu').first()).toBeAttached();
  await expect(page.locator('.eye-surface img')).toHaveCount(0);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('#scene')!.getContext('webgl')!;
    const extension = gl.getExtension('WEBGL_lose_context')!;
    (window as any).__loseContext = () => extension.loseContext();
    (window as any).__restoreContext = () => extension.restoreContext();
  });
  const target = page.locator('.eye-tile[data-column="2"][data-row="2"]');
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => (window as any).__loseContext());
    await page.clock.runFor(100);
    await expect(page.locator('#scene')).toBeHidden();
    await expect(page.locator('.eye-tile.is-gpu')).toHaveCount(0);
    await expect(target.locator('img')).toBeVisible();
    expect(await target.locator('img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
    const position = await target.evaluate(element => {
      const tile = element as HTMLElement & { _imageX: number; _imageY: number };
      const transform = new DOMMatrixReadOnly(getComputedStyle(tile.querySelector('img')!).transform);
      return { x: transform.m41, y: transform.m42, expectedX: tile._imageX, expectedY: tile._imageY };
    });
    expect(position.x).toBeCloseTo(position.expectedX, 2);
    expect(position.y).toBeCloseTo(position.expectedY, 2);
    await page.evaluate(() => (window as any).__restoreContext());
    await page.clock.runFor(100);
    await expect(page.locator('#scene')).toBeVisible();
    await expect(target).toHaveClass(/is-gpu/);
    await expect(page.locator('.eye-surface img')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('an unreadable image settles without retrying on animation frames', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
  await page.addInitScript(() => {
    (window as any).__imageErrors = 0;
    window.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) (window as any).__imageErrors++; }, true);
    Math.random = () => .99;
  });
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items: [{
    id: 'broken', title: 'Broken image', image: 'data:image/png;base64,AAAA', width: 96, height: 96,
    sourceUrl: 'https://example.com/broken', eye: { x: .5, y: .5, r: .26 },
  }] } }));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
  await page.clock.pauseAt(new Date('2026-10-20T00:00:10Z'));
  const before = await page.evaluate(() => (window as any).__imageErrors);
  expect(before).toBeGreaterThan(0);
  await page.mouse.move(100, 200);
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => (window as any).__imageErrors)).toBe(before);
  await expect(page.locator('#viewer-status')).toBeEmpty();
});

test.describe('desktop debug controls', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('effects stay within an edge tile while the field coasts', async ({ page }, testInfo) => {
    await verifyDebugControls(page, testInfo.outputPath('local-debug-desktop.png'));
  });
  test('partially visible frames on all four desktop edges remain eligible', async ({ page }) => {
    await verifyClippedEdges(page);
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
