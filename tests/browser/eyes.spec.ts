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
  preview.on('pageerror', error => errors.push(error.message));
  await preview.goto('/content/me/preview/');
  await expect(preview.locator('#tiles a[href="https://example.com/source"]').first()).toBeAttached();
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
