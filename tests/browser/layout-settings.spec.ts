import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

const geometry = { sizeScale: 1.25, gapXScale: .75, gapYScale: 1.6 };

async function frame(page: Page, column: number, row: number) {
  return page.locator(`.eye-tile[data-column="${column}"][data-row="${row}"] .eye-hit`).boundingBox();
}

for (const device of [
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
]) test.describe(`layout settings on ${device.name}`, () => {
  test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch });

  for (const fallback of [false, true]) test(`independent frame size and gaps align artwork, links and blinking (${fallback ? 'DOM' : 'WebGL'})`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Exercise edited settings without changing the owner's source or images.
    let patched = false;
    await page.route('**/src/scripts/viewer-settings.js*', async route => {
      const response = await route.fetch();
      let source = await response.text();
      for (const [key, value] of Object.entries({ ...geometry, depthRange: 0 })) {
        const pattern = new RegExp(`\\b${key}:\\s*[\\d.]+,`);
        expect(source).toMatch(pattern);
        source = source.replace(pattern, `${key}: ${value},`);
      }
      patched = true;
      await route.fulfill({ response, body: source });
    });
    if (fallback) await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        return kind.includes('webgl') ? null : Reflect.apply(original, this, [kind, ...args]);
      } as typeof original;
    });
    const items = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const color = { r: 50 + index * 6, g: 100 + index * 3, b: 150 - index * 3 };
      const bytes = await sharp({ create: { width: 96, height: 96, channels: 3, background: color } }).png().toBuffer();
      return { id: `color-${index}`, title: `Color ${index}`, image: 'data:image/png;base64,' + bytes.toString('base64'), width: 96, height: 96,
        sourceUrl: `https://example.com/color-${index}`, eye: { x: .5, y: .5, r: .26 } };
    }));
    await page.route('**/content/me/viewer.json', route => route.fulfill({ json: { version: 2, items } }));
    await page.goto('/content/me/', { waitUntil: 'networkidle' });
    await expect(page.locator('#loading-screen')).toHaveCount(0, { timeout: 10000 });
    expect(patched).toBe(true);

    const reference = Math.round(Math.max(80, Math.min(180, device.viewport.width / (device.isMobile ? 4.2 : 9.4))));
    const expectedSide = reference * .66 * geometry.sizeScale;
    const expectedGapX = reference * .34 * geometry.gapXScale;
    const expectedGapY = reference * .34 * geometry.gapYScale;
    const target = page.locator('.eye-tile[data-column="2"][data-row="2"]');
    const bounds = (await frame(page, 2, 2))!;
    const right = (await frame(page, 3, 2))!;
    const below = (await frame(page, 2, 3))!;
    expect(bounds.width).toBeCloseTo(expectedSide, 1);
    expect(bounds.height).toBeCloseTo(expectedSide, 1);
    expect(right.x - bounds.x - bounds.width).toBeCloseTo(expectedGapX, 1);
    expect(below.y - bounds.y - bounds.height).toBeCloseTo(expectedGapY, 1);
    if (fallback) await expect(target).not.toHaveClass(/is-gpu/);
    else await expect(target).toHaveClass(/is-gpu/);

    // The rendered image must occupy its DOM link's frame, including on WebGL.
    const index = Number((await target.getAttribute('data-image-id'))!.split('-')[1]);
    const screenshot = await page.screenshot({ path: testInfo.outputPath('custom-size-and-gaps.png') });
    const pixel = await sharp(screenshot).extract({ left: Math.round(bounds.x + bounds.width / 2), top: Math.round(bounds.y + bounds.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const expectedPixel = [50 + index * 6, 100 + index * 3, 150 - index * 3];
    expectedPixel.forEach((channel, at) => expect(Math.abs(pixel[at] - channel)).toBeLessThanOrEqual(2));

    const identity = await target.getAttribute('data-image-id');
    const travel = (expectedSide + expectedGapY) * 12;
    await page.mouse.move(device.viewport.width / 2, device.viewport.height / 2);
    await page.mouse.wheel(0, travel);
    await expect(target).toHaveCount(0);
    await page.mouse.wheel(0, -travel);
    await expect(target).toHaveAttribute('data-image-id', identity!);
    expect((await frame(page, 2, 2))!.y).toBeCloseTo(bounds.y, 1);

    await page.getByText('動作確認', { exact: true }).click();
    await page.locator('#debug-blink-duration').fill('1200');
    await page.getByRole('button', { name: 'B：まばたき・交換', exact: true }).click();
    await expect(page.locator('.eye-blink')).toHaveCount(1);
    const scope = await page.locator('.eye-blink').evaluate(overlay => {
      const frame = overlay.parentElement!.querySelector('.eye-hit')!.getBoundingClientRect();
      const actual = overlay.getBoundingClientRect();
      return { actual: [actual.x, actual.y, actual.width, actual.height], frame: [frame.x, frame.y, frame.width, frame.height] };
    });
    expect(scope.actual).toEqual(scope.frame);
    expect(scope.actual[2]).toBeCloseTo(expectedSide, 1);
    await expect(page.locator('.eye-blink')).toHaveCount(0);

    const width = device.isMobile ? 430 : 1100;
    await page.setViewportSize({ width, height: device.viewport.height });
    const resizedReference = Math.round(width / (device.isMobile ? 4.2 : 9.4));
    await expect.poll(async () => (await frame(page, 2, 2))!.width).toBeCloseTo(resizedReference * .66 * geometry.sizeScale, 1);
    expect(errors).toEqual([]);
  });
});
