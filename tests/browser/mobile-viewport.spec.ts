import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { VIEWER_SETTINGS } from '../../src/scripts/viewer-settings.js';

async function openMobile(page: Page, { viewportOverride = false, solidColors = false, clock = true } = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (clock) await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
  await page.addInitScript(override => {
    Math.random = () => .99;
    if (override) {
      const state = { height: 320, width: 390, offsetTop: 0, offsetLeft: 0 };
      (window as any).__viewport = state;
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        Object.defineProperty(window.visualViewport, key, { configurable: true, get: () => state[key] });
      }
    }
  }, viewportOverride);
  const items = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const pixels = solidColors
      ? await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 40 + index * 14, g: 80 + index * 11, b: 200 - index * 13 } } }).png().toBuffer()
      : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${index * 29},40%,35%)"/><ellipse cx="48" cy="48" rx="40" ry="24" fill="white"/><circle cx="48" cy="48" r="14" fill="black"/></svg>`)).png().toBuffer();
    return { id: `eye-${index}`, title: `Eye ${index}`, width: 96, height: 96, image: 'data:image/png;base64,' + pixels.toString('base64'),
      sourceUrl: `https://example.com/${index}`, eye: { x: .5, y: .5, r: .26 } };
  }));
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items } }));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#viewer-status')).toBeEmpty();
  if (clock) await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  return errors;
}

async function advanceUntil(page: Page, selector: string) {
  for (let elapsed = 0; elapsed < VIEWER_SETTINGS.idle.startDelayMs + VIEWER_SETTINGS.idle.checkIntervalMs + 1000; elapsed += 150) {
    await page.clock.runFor(150);
    if (await page.locator(selector).count()) return page.locator(selector);
  }
  throw new Error(`Automatic event did not appear: ${selector}`);
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });

test.describe('blink artwork', () => {
  test.use({ reducedMotion: 'reduce' });
  test('an all-eye blink changes every painted image', async ({ page }, testInfo) => {
    const errors = await openMobile(page, { solidColors: true, clock: false });
    const eyes = () => page.locator('.eye-tile').evaluateAll(tiles => tiles.flatMap(tile => {
      const { column, row, imageId } = (tile as HTMLElement).dataset;
      const rect = tile.querySelector('.eye-hit')!.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      const uncovered = document.elementFromPoint(x, y)?.closest('.eye-tile') === tile;
      return uncovered && x > 4 && y > 4 && x < innerWidth - 4 && y < innerHeight - 4 ? [{ column, row, imageId, x, y }] : [];
    }));
    const painted = async () => {
      const expected = await eyes();
      const { data, info } = await sharp(await page.screenshot({ scale: 'css', path: testInfo.outputPath('all-eyes-painted.png') })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return expected.length > 9 && expected.every(eye => {
        const index = Number(eye.imageId!.split('-')[1]), pixel = (eye.y * info.width + eye.x) * info.channels;
        return data[pixel] === 40 + index * 14 && data[pixel + 1] === 80 + index * 11 && data[pixel + 2] === 200 - index * 13;
      });
    };
    await expect.poll(painted).toBe(true);
    const original = new Map((await eyes()).map(eye => [`${eye.column}:${eye.row}`, eye.imageId]));
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--blink-duration', '1200ms');
      document.querySelector<HTMLButtonElement>('[data-effect="all-blink"]')!.click();
    });
    await expect(page.locator('#field')).toHaveAttribute('data-idle-effect', 'all-blink');
    await expect(page.locator('#field')).not.toHaveAttribute('data-idle-effect', 'all-blink');
    expect((await eyes()).every(eye => eye.imageId !== original.get(`${eye.column}:${eye.row}`))).toBe(true);
    await expect.poll(painted).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const interrupted of [false, true]) test(`a blink changes the painted image${interrupted ? ' even if panning recycles its tile' : ''}`, async ({ page }, testInfo) => {
    // Native frames keep WebGL presentation synchronized with screenshots.
    const errors = await openMobile(page, { solidColors: true, clock: false });
    const selected = await page.locator('.eye-tile').evaluateAll((tiles, count) => {
      const field = document.getElementById('field')!.getBoundingClientRect();
      return tiles.map(tile => {
        const rect = tile.querySelector('.eye-hit')!.getBoundingClientRect();
        const { column, row } = (tile as HTMLElement).dataset;
        return { column: Number(column), row: Number(row), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          distance: (rect.x + rect.width / 2 - field.width / 2) ** 2 + (rect.y + rect.height / 2 - field.height / 2) ** 2 };
      }).filter(rect => rect.right > 0 && rect.left < field.width && rect.bottom > 0 && rect.top < field.height)
        .sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column)[count];
    }, VIEWER_SETTINGS.idle.protectedCenterCount);
    const target = page.locator(`[data-column="${selected.column}"][data-row="${selected.row}"]`);
    const color = (id: string) => {
      const index = Number(id.split('-')[1]);
      return [40 + index * 14, 80 + index * 11, 200 - index * 13];
    };
    const painted = async () => {
      const rect = (await target.locator('.eye-hit').boundingBox())!;
      return [...await sharp(await page.screenshot({ scale: 'css', path: testInfo.outputPath('painted-artwork.png') })).extract({ left: Math.round(rect.x + rect.width / 2), top: Math.round(rect.y + rect.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    };
    const beforeId = (await target.getAttribute('data-image-id'))!;
    await expect.poll(painted).toEqual(color(beforeId));
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--blink-duration', '2000ms');
      const draws = [.1, 0, 0, 0, 0];
      Math.random = () => draws.shift() ?? .99;
    });
    await expect(page.locator('.eye-blink')).toHaveCount(1, { timeout: 12000 });
    await expect(target).toHaveAttribute('data-idle-effect', 'blink');
    await expect(target).toHaveAttribute('data-image-id', beforeId);
    if (interrupted) {
      // Reduced-motion panning moves immediately; recycle before the swap pose.
      await page.locator('#field').dispatchEvent('wheel', { deltaY: 2000 });
      await expect(target).toHaveCount(0);
      await expect(page.locator('.eye-blink')).toHaveCount(0);
      await page.locator('#field').dispatchEvent('wheel', { deltaY: -2000 });
    } else await expect(page.locator('.eye-blink')).toHaveCount(0);
    await expect(target).not.toHaveAttribute('data-image-id', beforeId);
    const afterId = (await target.getAttribute('data-image-id'))!;
    await expect.poll(painted).toEqual(color(afterId));
    const neighbors = await page.locator('.eye-tile').evaluateAll((tiles, at) => tiles.filter(tile => {
      const { column, row } = (tile as HTMLElement).dataset;
      const dx = Number(column) - at.column, dy = Number(row) - at.row;
      return Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy);
    }).map(tile => (tile as HTMLElement).dataset.imageId), selected);
    expect(neighbors).not.toContain(afterId);
    expect(errors).toEqual([]);
  });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) test.describe(`automatic effects with ${reducedMotion}`, () => {
  test.use({ reducedMotion });
  test('a glance finishes its return before another requested animation starts', async ({ page }) => {
    const errors = await openMobile(page);
    await page.clock.runFor(1000);
    await page.evaluate(() => document.documentElement.style.setProperty('--blink-duration', '1200ms'));
    const { centerMs, holdMs, returnMs } = VIEWER_SETTINGS.glance;
    for (const next of ['blink', 'all-blink']) {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-effect="glance"]')!.click());
      await page.clock.runFor(32);
      const eye = page.locator('.eye-tile[data-idle-effect="glance"]');
      await expect(eye).toHaveCount(1);
      const coordinate = await eye.evaluate(element => ({ column: (element as HTMLElement).dataset.column, row: (element as HTMLElement).dataset.row }));
      const tracked = page.locator(`[data-column="${coordinate.column}"][data-row="${coordinate.row}"]`);
      const displacement = () => tracked.evaluate(element => {
        const tile = element as HTMLElement & { _imageX: number; _imageY: number };
        return Math.hypot(tile._imageX, tile._imageY);
      });
      const original = (await tracked.getAttribute('data-image-id'))!;
      const before = await displacement();
      expect(before).toBeGreaterThan(3);
      await page.clock.runFor(centerMs / 2);
      const halfway = await displacement();
      expect(halfway).toBeGreaterThan(before * .4);
      expect(halfway).toBeLessThan(before * .6);
      await page.evaluate(next => document.querySelector<HTMLButtonElement>(`[data-effect="${next}"]`)!.click(), next);
      await page.clock.runFor(32);
      await expect(tracked).toHaveAttribute('data-idle-effect', 'glance');
      await expect(page.locator('.eye-blink')).toHaveCount(0);
      expect(await displacement()).toBeLessThanOrEqual(halfway);
      await page.clock.runFor(centerMs / 2 + 32);
      expect(await displacement()).toBeLessThan(.1);
      await page.clock.runFor(holdMs - 64 + returnMs / 2);
      expect(await displacement()).toBeGreaterThan(before * .3);
      expect(await displacement()).toBeLessThan(before * .7);
      await expect(tracked).toHaveAttribute('data-image-id', original);
      await page.clock.runFor(returnMs / 2 + 64);
      expect(await displacement()).toBeCloseTo(before, 1);
      await expect(page.locator('.eye-tile[data-idle-effect="glance"]')).toHaveCount(0);
      if (next === 'blink') await expect(page.locator('.eye-tile[data-idle-effect="blink"]')).toHaveCount(1);
      else await expect(page.locator('#field')).toHaveAttribute('data-idle-effect', 'all-blink');
      await page.clock.runFor(1600);
      await expect(page.locator('[data-idle-effect], .eye-blink')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('all eyes blink and exchange together after the first minute, including during panning and resizing', async ({ page }, testInfo) => {
    const errors = await openMobile(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--blink-duration', '2000ms'));
    await page.clock.runFor(Math.max(0, 58000 - await page.evaluate(() => performance.now())));
    // Guaranteed draws can run B before the minute, but never the all-eye effect.
    await page.evaluate(() => { Math.random = () => 0; });
    await page.clock.runFor(Math.max(0, 59900 - await page.evaluate(() => performance.now())));
    await expect(page.locator('#field')).not.toHaveAttribute('data-idle-effect', 'all-blink');
    for (let step = 0; step < 50; step++) {
      await page.clock.runFor(100);
      if (await page.locator('#field[data-idle-effect="all-blink"]').count()) break;
    }
    const field = page.locator('#field');
    await expect(field).toHaveAttribute('data-idle-effect', 'all-blink');
    expect(await page.evaluate(() => performance.now())).toBeGreaterThanOrEqual(VIEWER_SETTINGS.idle.allBlinkStartDelayMs);
    // If both lotteries would win, the all-eye effect is the only active effect.
    await expect(page.locator('.eye-tile[data-idle-effect]')).toHaveCount(0);
    const original = await page.locator('.eye-tile').evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.imageId));
    const count = await page.locator('.eye-tile').count();
    for (let step = 0; step < 20 && await page.locator('.eye-blink').count() !== count; step++) await page.clock.runFor(32);
    await expect(page.locator('.eye-blink')).toHaveCount(count);
    await page.clock.runFor(160);
    expect(await page.locator('.eye-tile').evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.imageId))).toEqual(original);
    const elapsed = await page.locator('.eye-blink').first().evaluate(overlay => Number(overlay.getAnimations({ subtree: true })[0].currentTime));
    await page.clock.runFor(2000 * VIEWER_SETTINGS.blink.swapAt - elapsed + 20);
    const closed = await page.locator('.eye-blink').evaluateAll(overlays => overlays.every(overlay =>
      [...overlay.children].every(lid => Math.abs(new DOMMatrixReadOnly(getComputedStyle(lid).transform).m42) < .1)));
    expect(closed).toBe(true);
    const changed = await page.locator('.eye-tile').evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.imageId));
    expect(changed.every((id, index) => id !== original[index])).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('all-eyes-closed.png') });
    await page.locator('#field').dispatchEvent('wheel', { deltaY: 1600, deltaX: 80 });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.runFor(100);
    await expect(field).toHaveAttribute('data-idle-effect', 'all-blink');
    const synchronized = await page.locator('.eye-tile').evaluateAll(tiles => {
      const phases: number[] = [];
      const aligned = tiles.every(tile => {
        const overlay = tile.querySelector('.eye-blink');
        if (!overlay) return false;
        const rect = overlay.getBoundingClientRect(), hit = tile.querySelector('.eye-hit')!.getBoundingClientRect();
        phases.push(...overlay.getAnimations({ subtree: true }).map(animation => Number(animation.currentTime)));
        return rect.x === hit.x && rect.y === hit.y && rect.width === hit.width && rect.height === hit.height;
      });
      return { aligned, phaseRange: Math.max(...phases) - Math.min(...phases) };
    });
    expect(synchronized).toEqual({ aligned: true, phaseRange: 0 });
    expect(await field.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.evaluate(() => { Math.random = () => .99; });
    await page.clock.runFor(2200);
    await expect(page.locator('[data-idle-effect], .eye-blink')).toHaveCount(0);
    const neighborsUnique = await page.locator('.eye-tile').evaluateAll(tiles => {
      const images = new Map(tiles.map(tile => {
        const { column, row, imageId } = (tile as HTMLElement).dataset;
        return [`${column}:${row}`, imageId];
      }));
      return tiles.every(tile => {
        const { column, row, imageId } = (tile as HTMLElement).dataset;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && images.get(`${Number(column) + dx}:${Number(row) + dy}`) === imageId) return false;
        }
        return true;
      });
    });
    expect(neighborsUnique).toBe(true);
    expect(errors).toEqual([]);
  });

  test('both automatic effects run without scrolling or debug controls', async ({ page }) => {
    const errors = await openMobile(page);
    await page.evaluate(() => {
      const draws = [.1, .25, .75];
      Math.random = () => draws.shift() ?? .99;
    });
    const glance = await advanceUntil(page, '[data-idle-effect="glance"]');
    const coordinate = await glance.evaluate(element => ({ column: (element as HTMLElement).dataset.column, row: (element as HTMLElement).dataset.row }));
    const tracked = page.locator(`[data-column="${coordinate.column}"][data-row="${coordinate.row}"]`);
    const shift = () => tracked.evaluate(element => {
      const tile = element as HTMLElement & { _imageX: number; _imageY: number };
      return Math.hypot(tile._imageX, tile._imageY);
    });
    expect(await shift()).toBeGreaterThan(3);
    await page.clock.runFor(VIEWER_SETTINGS.glance.centerMs + 64);
    expect(await shift()).toBeLessThan(.1);
    await page.clock.runFor(VIEWER_SETTINGS.glance.holdMs + VIEWER_SETTINGS.glance.returnMs + 64);
    await expect(page.locator('[data-idle-effect]')).toHaveCount(0);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--blink-duration', '1200ms');
      const draws = [.1, .25, 0];
      Math.random = () => draws.shift() ?? .99;
    });
    const blink = await advanceUntil(page, '[data-idle-effect="blink"]');
    const before = await blink.getAttribute('data-image-id');
    await advanceUntil(page, '.eye-blink');
    await page.clock.runFor(1200 * VIEWER_SETTINGS.blink.swapAt + 64);
    await expect(blink).not.toHaveAttribute('data-image-id', before!);
    await page.clock.runFor(1200);
    await expect(page.locator('[data-idle-effect], .eye-blink')).toHaveCount(0);
    await expect(page.locator('#field-debug')).not.toHaveAttribute('open', '');
    expect(errors).toEqual([]);
  });
});

  test('the first viewport, browser bars and restored page keep the field and footer aligned', async ({ page }) => {
    const errors = await openMobile(page, { viewportOverride: true });
    for (const state of [
      { height: 320, width: 390, offsetTop: 0, offsetLeft: 0, event: 'resize' },
      { height: 700, width: 390, offsetTop: 0, offsetLeft: 0, event: 'resize' },
      { height: 500, width: 368, offsetTop: 110, offsetLeft: 12, event: 'scroll' },
      { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, event: 'pageshow' },
    ]) {
      await page.evaluate(state => {
        Object.assign((window as any).__viewport, state);
        if (state.event === 'pageshow') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        else window.visualViewport!.dispatchEvent(new Event(state.event));
      }, state);
      await page.clock.runFor(50);
      const bounds = await page.evaluate(() => {
        const field = document.getElementById('field')!.getBoundingClientRect();
        const footer = document.querySelector('.field-chrome')!.getBoundingClientRect();
        const scene = document.getElementById('scene')!;
        return { x: field.x, y: field.y, width: field.width, height: field.height, bottomGap: field.bottom - footer.bottom,
          sceneWidth: parseFloat(scene.style.width), sceneHeight: parseFloat(scene.style.height) };
      });
      expect(bounds.x).toBeCloseTo(state.offsetLeft, 1);
      expect(bounds.y).toBeCloseTo(state.offsetTop, 1);
      expect(bounds.width).toBeCloseTo(state.width, 1);
      expect(bounds.height).toBeCloseTo(state.height, 1);
      expect(bounds.sceneWidth).toBe(state.width);
      expect(bounds.sceneHeight).toBe(state.height);
      expect(bounds.bottomGap).toBeGreaterThanOrEqual(16);
      expect(bounds.bottomGap).toBeLessThan(80);
    }
    expect(errors).toEqual([]);
  });
