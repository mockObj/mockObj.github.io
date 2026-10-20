import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { VIEWER_SETTINGS } from '../../src/scripts/viewer-settings.js';

async function openMobile(page: Page, viewportOverride = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
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
    const pixels = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${index * 29},40%,35%)"/><ellipse cx="48" cy="48" rx="40" ry="24" fill="white"/><circle cx="48" cy="48" r="14" fill="black"/></svg>`)).png().toBuffer();
    return { id: `eye-${index}`, title: `Eye ${index}`, width: 96, height: 96, image: 'data:image/png;base64,' + pixels.toString('base64'),
      sourceUrl: `https://example.com/${index}`, eye: { x: .5, y: .5, r: .26 } };
  }));
  await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items } }));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#viewer-status')).toBeEmpty();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  return errors;
}

async function advanceUntil(page: Page, selector: string) {
  for (let elapsed = 0; elapsed < VIEWER_SETTINGS.idle.startDelayMs + VIEWER_SETTINGS.idle.checkIntervalMs + 1000; elapsed += 50) {
    await page.clock.runFor(50);
    if (await page.locator(selector).count()) return page.locator(selector);
  }
  throw new Error(`Automatic event did not appear: ${selector}`);
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });

for (const reducedMotion of ['no-preference', 'reduce'] as const) test.describe(`automatic effects with ${reducedMotion}`, () => {
  test.use({ reducedMotion });
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
    const errors = await openMobile(page, true);
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
