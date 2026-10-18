import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function cameraPosition(page: Page) {
  return page.locator('.eye-tile').first().evaluate(tile => {
    const element = tile as HTMLElement;
    const matrix = new DOMMatrixReadOnly(element.style.transform);
    const size = parseFloat(element.style.width);
    return { x: matrix.m41 - Number(element.dataset.column) * size, y: matrix.m42 - Number(element.dataset.row) * size };
  });
}

async function openEyes(page: Page) {
  await page.goto('/');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#666'; context.fillRect(0, 0, 96, 96);
    context.fillStyle = 'white'; context.beginPath(); context.ellipse(48, 48, 42, 24, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = 'black'; context.beginPath(); context.arc(48, 48, 14, 0, Math.PI * 2); context.fill();
    return canvas.toDataURL('image/png');
  });
  await page.route('**/content/me/collection.json', route => route.fulfill({ json: { version: 2, items: [
    { id: 'eye', title: 'Touch test eye', image, width: 96, height: 96, sourceUrl: 'https://example.com/eye', eye: { x: .5, y: .5, r: .26 } },
  ] } }));
  await page.goto('/content/me/', { waitUntil: 'networkidle' });
  await expect(page.locator('.eye-tile[data-kind="item"]').first()).toBeAttached();
  const session = await page.context().newCDPSession(page);
  return async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', y = 0, x = 195) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ id: 1, x, y }] });
  };
}

test('touch scroll aims at screen center, keeps moving with inertia, and stops on the next touch', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const touch = await openEyes(page);
  const trackedEye = page.locator('.eye-tile[data-column="2"][data-row="6"] .eye-surface > *');
  const gazeY = () => trackedEye.evaluate(eye => new DOMMatrixReadOnly((eye as HTMLElement).style.transform).m42);
  const start = await cameraPosition(page);
  await touch('touchStart', 580);
  // The selected eye starts below screen center, so its image must look upward.
  await expect.poll(gazeY).toBeLessThan(-3);
  await page.screenshot({ path: testInfo.outputPath('eyes-before-swipe.png') });
  for (let step = 1; step <= 16; step++) {
    await touch('touchMove', 580 - step * 15);
    await page.waitForTimeout(16);
  }
  await expect.poll(async () => (await cameraPosition(page)).y).toBeCloseTo(start.y - 240, 1);
  // The same eye has passed above center and now looks down, during the swipe.
  await expect.poll(gazeY).toBeGreaterThan(3);
  await page.screenshot({ path: testInfo.outputPath('eyes-during-swipe.png') });
  // Finish with a flick after the screenshot/assertions, without pausing first.
  for (let step = 1; step <= 4; step++) {
    await touch('touchMove', 340 - step * 20);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  await expect.poll(async () => (await cameraPosition(page)).y).toBeLessThan(start.y - 320 - 12);
  const coasting = await cameraPosition(page);
  await expect.poll(async () => (await cameraPosition(page)).y).toBeLessThan(coasting.y - 8);
  // A new finger immediately catches the moving field, without a position reset.
  await touch('touchStart', 580, 65);
  const caught = await cameraPosition(page);
  await page.waitForTimeout(180);
  expect((await cameraPosition(page)).y).toBeCloseTo(caught.y, 1);
  await touch('touchEnd');
  await page.waitForTimeout(180);
  expect((await cameraPosition(page)).y).toBeCloseTo(caught.y, 1);
  expect(page.context().pages()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('repeated touch drags keep their position across recycling and viewport height changes', async ({ page }) => {
  const touch = await openEyes(page);
  for (let gesture = 0; gesture < 3; gesture++) {
    const start = await cameraPosition(page);
    await touch('touchStart', 580);
    for (let step = 1; step <= 12; step++) {
      await touch('touchMove', 580 - step * 25);
      await page.waitForTimeout(16);
      await expect.poll(async () => (await cameraPosition(page)).y).toBeCloseTo(start.y - step * 25, 1);
    }
    const beforeResize = await cameraPosition(page);
    await page.setViewportSize({ width: 390, height: gesture % 2 ? 844 : 760 });
    await expect.poll(async () => (await cameraPosition(page)).y).toBeCloseTo(beforeResize.y, 1);
    // Holding still before release must stop, rather than resurrect stale inertia.
    await page.waitForTimeout(150);
    await touch('touchEnd');
    await page.waitForTimeout(150);
    expect((await cameraPosition(page)).y).toBeCloseTo(beforeResize.y, 1);
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollTop, document.body.scrollTop, document.getElementById('field')!.scrollTop])).toEqual([0, 0, 0, 0]);
  }
  expect(page.context().pages()).toHaveLength(1);
});

test('a touch tap still opens the image source once', async ({ page, context }) => {
  const touch = await openEyes(page);
  await context.route('https://example.com/eye', route => route.fulfill({ body: 'Image source' }));
  const hit = await page.locator('.eye-tile[data-column="2"][data-row="4"] .eye-hit').boundingBox();
  const popup = page.waitForEvent('popup');
  await touch('touchStart', hit!.y + hit!.height / 2, hit!.x + hit!.width / 2);
  await touch('touchEnd');
  await expect(await popup).toHaveURL('https://example.com/eye');
  expect(context.pages()).toHaveLength(2);
});
