import { test, expect } from '@playwright/test';

test('local loading preview supports replay, manual completion and instant loads without collection requests', async ({ page }) => {
  const dataRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/\/(?:collection|viewer)\.json|\/originals\//.test(request.url())) dataRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/content/me/loading-test/');
  await expect(page.getByRole('heading', { name: 'ローディングの確認' })).toBeVisible();
  await page.locator('#loading-delay').selectOption('manual');
  await expect(page.locator('#loading-screen')).toBeVisible();
  await page.locator('#loading-size').selectOption('mobile');
  expect((await page.locator('#loading-preview').boundingBox())!.width).toBe(390);
  await page.getByRole('button', { name: '今すぐ完了' }).click();
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
  await expect(page.locator('#loading-screen')).toHaveCount(0);
  await page.getByRole('button', { name: '再実行' }).click();
  await expect(page.locator('#loading-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: '今すぐ完了' })).toBeEnabled();
  await page.locator('#loading-delay').selectOption('0');
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(dataRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('the final blink covers the loading screen before revealing the scene, with no whole-screen opacity fade', async ({ page }) => {
  await page.goto('/content/me/loading-test/');
  await page.locator('#loading-delay').selectOption('manual');
  // Pause just the final transition, so close/swap/open can be inspected at
  // deterministic times without changing the shared loading controller.
  await page.locator('#loading-screen').evaluate(screen => {
    const observer = new MutationObserver(() => {
      if (!screen.classList.contains('is-leaving')) return;
      for (const animation of screen.getAnimations({ subtree: true })) {
        if ((animation as CSSAnimation).animationName?.startsWith('loading-blink-')) { animation.pause(); animation.currentTime = 0; }
      }
      observer.disconnect();
    });
    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('#finish-loading').click();
  await expect(page.locator('#loading-screen')).toHaveClass(/is-leaving/);
  const pose = (time: number) => page.locator('#loading-screen').evaluate((screen, time) => {
    for (const animation of screen.getAnimations({ subtree: true })) {
      if ((animation as CSSAnimation).animationName?.startsWith('loading-blink-')) animation.currentTime = time;
    }
    const upper = screen.querySelector('.loading-blink__upper')!;
    const lower = screen.querySelector('.loading-blink__lower')!;
    return {
      upper: new DOMMatrixReadOnly(getComputedStyle(upper).transform).m42,
      lower: new DOMMatrixReadOnly(getComputedStyle(lower).transform).m42,
      opacity: getComputedStyle(screen).opacity,
      background: getComputedStyle(screen).backgroundColor,
      caption: getComputedStyle(screen.querySelector('.loading-caption')!).visibility,
    };
  }, time);
  const open = await pose(0);
  expect(open.upper).toBeLessThan(0);
  expect(open.lower).toBeGreaterThan(0);
  expect(await page.locator('#loading-screen').evaluate(screen => getComputedStyle(screen).animationDuration)).toBe('0.42s');
  const closed = await pose(157.5);
  expect(closed.upper).toBeCloseTo(0, 1);
  expect(closed.lower).toBeCloseTo(0, 1);
  expect(closed.background).toBe('rgba(0, 0, 0, 0)');
  expect(closed.caption).toBe('hidden');
  const reopening = await pose(285);
  expect(reopening.upper).toBeLessThan(0);
  expect(reopening.upper).toBeGreaterThan(open.upper);
  expect(reopening.lower).toBeGreaterThan(0);
  expect(reopening.lower).toBeLessThan(open.lower);
  expect([open.opacity, closed.opacity, reopening.opacity]).toEqual(['1', '1', '1']);
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
});

test('a longer blink parameter stays on screen for its complete duration', async ({ page }) => {
  await page.goto('/content/me/loading-test/');
  await page.locator('#loading-delay').selectOption('manual');
  await page.evaluate(() => document.documentElement.style.setProperty('--blink-duration', '1.2s'));
  await page.locator('#finish-loading').click();
  await expect(page.locator('#loading-screen')).toHaveClass(/is-leaving/);
  await page.waitForTimeout(700);
  await expect(page.locator('#loading-screen')).toHaveCount(1);
  await expect(page.locator('#loading-test-status')).toHaveText('表示完了');
});
