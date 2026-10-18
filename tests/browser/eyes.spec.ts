import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('public viewer renders locally hosted images on desktop and mobile', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const missing: string[] = [];
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.goto('/content/me/');
  await expect(page.locator('#tiles > *').first()).toBeAttached();
  await expect(page.locator('#viewer-status')).toBeEmpty();
  await expect(page.locator('#tiles [data-kind="preset"]').first()).toBeAttached();
  await page.locator('#field').focus();
  await page.keyboard.press('ArrowRight');
  await page.mouse.wheel(120, 80);
  await page.screenshot({ path: testInfo.outputPath('viewer-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('viewer-mobile.png') });
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('the local viewer provides a working editor link', async ({ page }) => {
  await page.goto('/content/me/');
  await page.getByRole('link', { name: '編集', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/me\/editor\/$/);
  await expect(page.locator('#placement-grid button')).toHaveCount(64);
  await expect(page.locator('#choose-images')).toBeEnabled();
});

test('image edits persist, preview uses the draft, public data stays separate, JSON and standalone HTML export', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/content/me/editor/');
  await expect(page.locator('#placement-grid button')).toHaveCount(64);
  await page.locator('#image-file-input').setInputFiles(resolve('public/content/me/assets/mouthwashing-official-capsule.jpg'));
  await expect(page.locator('#image-count')).toHaveText('1');
  await expect(page.locator('#placement-grid .slot-art')).toHaveCount(0);
  await page.locator('#image-title').fill('Browser test eye');
  await page.locator('#source-url').fill('https://example.com/source');
  await page.locator('#eye-radius').fill('18');
  await page.locator('#save-image').click();
  await expect(page.locator('#status-message')).toContainText('このブラウザに保存');
  await page.locator('.asset-place').click();
  await expect(page.locator('#placement-grid button').first()).toHaveClass(/has-image/);
  await page.reload();
  await expect(page.locator('#image-title')).toHaveValue('Browser test eye');
  await expect(page.locator('#eye-radius')).toHaveValue('18');
  await expect(page.locator('#placement-grid button').first()).toHaveClass(/has-image/);
  await page.screenshot({ path: testInfo.outputPath('editor-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('editor-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const preview = await context.newPage();
  const sampleRequests: string[] = [];
  preview.on('request', request => { if (request.url().includes('/content/me/assets/')) sampleRequests.push(request.url()); });
  preview.on('pageerror', error => errors.push(error.message));
  await preview.goto('/content/me/preview/');
  await expect(preview.locator('#tiles a[href="https://example.com/source"]').first()).toBeAttached();
  await expect(preview.locator('#tiles [data-kind="preset"]')).toHaveCount(0);
  await expect(preview.locator('#tiles [data-kind="empty"]').first()).toBeAttached();
  expect(sampleRequests).toEqual([]);
  const publicPage = await context.newPage();
  await publicPage.goto('/content/me/');
  await expect(publicPage.locator('#tiles > *').first()).toBeAttached();
  await expect(publicPage.locator('#tiles a[href="https://example.com/source"]')).toHaveCount(0);

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#export-data').click();
  const json = await jsonDownload;
  const data = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(json.suggestedFilename()).toBe('collection.json');
  expect(data.items[0].eye.r).toBe(.18);
  expect(data.slots[0]).toBe(data.items[0].id);

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#export-site').click();
  const html = await htmlDownload;
  const file = testInfo.outputPath('me.html');
  await html.saveAs(file);
  const standalone = await context.newPage();
  standalone.on('pageerror', error => errors.push(error.message));
  const requests: string[] = [];
  standalone.on('request', request => { if (request.url().startsWith('http')) requests.push(request.url()); });
  await standalone.goto(pathToFileURL(file).href);
  await expect(standalone.locator('#tiles > *').first()).toBeAttached();
  await expect(standalone.locator('#viewer-status')).toBeEmpty();
  await expect(standalone.locator('#tiles [data-kind="item"]').first()).toBeAttached();
  await expect(standalone.locator('#tiles [data-kind="preset"]')).toHaveCount(0);
  expect(requests).toEqual([]);

  const fresh = await context.browser()!.newContext();
  const freshEditor = await fresh.newPage();
  await freshEditor.goto('http://127.0.0.1:4321/content/me/editor/');
  await freshEditor.locator('#data-file-input').setInputFiles((await json.path())!);
  await expect(freshEditor.locator('#image-title')).toHaveValue('Browser test eye');
  await expect(freshEditor.locator('#placement-grid button').first()).toHaveClass(/has-image/);
  await fresh.close();
  expect(errors).toEqual([]);
});

test('the local image list identifies duplicates, filters images and deletes only the chosen registration and its placements', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const sameImage = 'data:image/jpeg;base64,' + (await readFile('public/content/me/assets/mouthwashing-official-capsule.jpg')).toString('base64');
  const otherImage = 'data:image/webp;base64,' + (await readFile('public/content/me/assets/satori-th11-official.webp')).toString('base64');
  const data = {
    version: 1, columns: 8, rows: 8, slots: Array<string | null>(64).fill(null),
    items: [
      { id: 'first', title: 'First eye', image: sameImage, width: 616, height: 353, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } },
      { id: 'second', title: 'Second eye', image: sameImage, width: 616, height: 353, sourceUrl: '', eye: { x: .4, y: .4, r: .15 } },
      { id: 'third', title: 'Unplaced eye', image: otherImage, width: 256, height: 512, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } },
    ],
  };
  data.slots[0] = 'first'; data.slots[8] = 'first'; data.slots[1] = 'second';
  await page.goto('/content/me/editor/');
  await page.locator('#data-file-input').setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await expect(page.locator('#library-summary')).toHaveText('登録 3件 ／ 重複 2件 ／ 未配置 1件');
  await expect(page.locator('.asset-duplicate:visible')).toHaveCount(2);
  await expect(page.locator('[data-id="first"] .asset-duplicate')).toHaveText('重複：#1・#2');
  await expect(page.locator('[data-id="first"] .asset-locations')).toHaveText('1行1列・2行1列');
  await expect(page.locator('[data-id="first"] .asset-original')).toHaveAttribute('src', sameImage);
  await expect(page.locator('#placement-grid .slot-art')).toHaveCount(0);
  await page.locator('#registered-images').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('registered-images-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('registered-images-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('#library-filter').selectOption('duplicates');
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await page.locator('#library-filter').selectOption('unplaced');
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.asset-title')).toHaveText('Unplaced eye');
  await page.locator('#library-filter').selectOption('all');
  await page.locator('#library-search').fill('second');
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.locator('#library-search').fill('no match');
  await expect(page.locator('#library-no-results')).toBeVisible();
  await page.locator('#library-search').fill('');

  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-id="first"] .asset-delete').click();
  await expect(page.locator('.asset-card')).toHaveCount(3);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('2マス');
    await dialog.accept();
  });
  await page.locator('[data-id="first"] .asset-delete').click();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await expect(page.locator('#library-summary')).toHaveText('登録 2件 ／ 重複 0件 ／ 未配置 1件');
  await expect(page.locator('.asset-duplicate:visible')).toHaveCount(0);
  await expect(page.locator('#placement-grid button.has-image')).toHaveCount(1);
  await expect(page.locator('#placement-grid button[data-slot="1"]')).toHaveClass(/has-image/);
  await page.reload();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.locator('#export-data').click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported.items.map((item: { id: string }) => item.id)).toEqual(['second', 'third']);
  expect(exported.slots[0]).toBeNull(); expect(exported.slots[8]).toBeNull(); expect(exported.slots[1]).toBe('second');
  expect(errors).toEqual([]);
});

test('corrupt local data is reported and can be recovered by importing JSON', async ({ page }) => {
  await page.goto('/content/me/editor/');
  await expect(page.locator('#placement-grid button')).toHaveCount(64);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mockobj-content-me-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('collections', 'readwrite');
      transaction.objectStore('collections').put({ broken: true }, 'active');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('#load-error')).toBeVisible();
  await expect(page.locator('#choose-images')).toBeDisabled();
  await page.locator('#data-file-input').setInputFiles(resolve('src/data/collection.json'));
  await expect(page.locator('#load-error')).toBeHidden();
  await expect(page.locator('#choose-images')).toBeEnabled();
});
