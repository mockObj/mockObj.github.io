import { eyePresets } from '../scripts/eyes.js';
import { emptyCollection, safeUrl, validateCollection } from './collection-model.js';
import { imageKey, describeImage, verifyImage, IMAGE_TYPES } from './collection-format.js';
export { emptyCollection, safeUrl, newId, validateCollection } from './collection-model.js';

const ME_PORTABLE_MODE = document.documentElement.dataset.mePortable || '';
export const isPortableEditor = ME_PORTABLE_MODE === 'editor';
// An embedded viewer can also be opened from a Blob URL. Relative URL creation
// is unnecessary there, and a blob: URL cannot be used as a relative base.
const ROOT_URL = document.getElementById('me-collection') ? null : new URL(document.documentElement.dataset.meRoot || '/content/me/', window.location.href);
const DATABASE = 'mockobj-content-me-v1';
const STORE = 'collections';
const ASSET_STORE = 'images';
const imageCache = new Map();
const imageReferences = new Map();
const persistedImages = new Set();
const CHANNEL_NAME = 'me-eye-grid-updates';
let databasePromise;
let updateChannel;
let ME_PORTABLE_SESSION_COLLECTION;
if (ME_PORTABLE_MODE === 'draft' && ROOT_URL) {
  try { updateChannel = new BroadcastChannel(CHANNEL_NAME); } catch {}
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('このブラウザでは保存を利用できません。データを書き出して保管してください。')); return; }
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) request.result.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
    request.onerror = () => { databasePromise = undefined; reject(new Error('保存領域を開けませんでした。ブラウザの設定を確認してください。')); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('別のタブを閉じてから、もう一度保存してください。')); };
  });
  return databasePromise;
}

export async function loadCollection() {
  const embedded = document.getElementById('me-collection');
  if (isPortableEditor) {
    if (!ME_PORTABLE_SESSION_COLLECTION) {
      ME_PORTABLE_SESSION_COLLECTION = embedded ? validateCollection(JSON.parse(embedded.textContent)) : emptyCollection();
    }
    return materializeCollection(validateCollection(ME_PORTABLE_SESSION_COLLECTION));
  }
  if (embedded) return validateCollection(JSON.parse(embedded.textContent));
  // The uploaded static site always displays its published collection. It must
  // not pick up a visitor's older editor data from this browser's IndexedDB.
  if (ME_PORTABLE_MODE === 'public') return loadPublishedCollection();
  const db = await openDatabase();
  const saved = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('active');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('保存したデータを読み込めませんでした。ページを開き直してください。'));
  });
  // A damaged or inaccessible saved collection must never look like an empty one.
  if (saved !== undefined) {
    const validated = validateCollection(saved);
    if (saved.version !== 3) {
      // Commit the migrated metadata and binary images in one transaction.
      // An error leaves the previous collection intact.
      await saveCollection(validated);
      return materializeCollection(await normalizeCollection(validated));
    }
    return materializeCollection(validated);
  }
  return loadPublishedCollection();
}

async function loadPublishedCollection() {
  const endpoint = ME_PORTABLE_MODE === 'public' ? 'viewer.json' : 'collection.json';
  const response = await fetch(new URL(endpoint, ROOT_URL), { cache: 'no-cache' });
  if (!response.ok) throw new Error('画像データを読み込めませんでした。');
  const raw = await response.json();
  // Generated image paths stay on this origin during local previews too.
  if (endpoint === 'viewer.json') for (const item of raw.items || []) {
    const image = safeUrl(item.image);
    if (image && new URL(image).origin === 'https://mockobj.github.io' && new URL(image).pathname.startsWith('/content/me/images/')) item.image = new URL(new URL(image).pathname, ROOT_URL).href;
  }
  return ME_PORTABLE_MODE === 'public' ? validateCollection(raw) : materializeCollection(validateCollection(raw));
}

async function rememberImage(blob, suppliedKey = '') {
  const key = suppliedKey || (await describeImage(blob)).key;
  if (!imageCache.has(key)) {
    const url = URL.createObjectURL(blob);
    imageCache.set(key, { blob, url });
    imageReferences.set(url, key);
  }
  return key;
}

async function originalImage(key) {
  if (imageCache.has(key)) return imageCache.get(key).blob;
  const db = await openDatabase();
  const blob = await new Promise((resolve, reject) => {
    const request = db.transaction(ASSET_STORE, 'readonly').objectStore(ASSET_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('保存した画像を読み込めませんでした。'));
  });
  if (blob instanceof Blob) {
    await verifyImage(key, blob);
    persistedImages.add(key);
    await rememberImage(blob, key);
    return blob;
  }
  // Source originals are available on the local dev server only.
  const response = await fetch(new URL('originals/' + key, ROOT_URL));
  if (!response.ok) throw new Error('元画像が見つかりません。「データを読込」でバックアップを復元してください。');
  const original = new Blob([await response.blob()], { type: IMAGE_TYPES[key.split('.').at(-1)] });
  await verifyImage(key, original);
  await rememberImage(original, key);
  return original;
}

async function normalizeCollection(collection) {
  const data = validateCollection(collection);
  const items = [];
  for (const entry of data.items) {
    let key = imageKey(entry.image) || imageReferences.get(entry.image);
    if (entry.image.startsWith('data:')) key = await rememberImage(await (await fetch(entry.image)).blob());
    if (entry.image.startsWith('blob:') && !key) throw new Error('画像の保存情報が見つかりません。画像を取り込み直してください。');
    items.push(key ? { ...entry, image: `asset:${key}`, imageGroup: key.slice(0, 64) } : entry);
  }
  return { version: 3, items };
}

async function materializeCollection(collection) {
  const items = [];
  for (const item of collection.items) {
    let key = imageKey(item.image);
    if (item.image.startsWith('data:')) key = await rememberImage(await (await fetch(item.image)).blob());
    if (key) {
      await originalImage(key);
      items.push({ ...item, image: imageCache.get(key).url, imageGroup: key.slice(0, 64) });
    } else items.push(item);
  }
  return validateCollection({ version: 2, items });
}

export async function saveCollection(collection) {
  const data = await normalizeCollection(collection);
  if (isPortableEditor) {
    // Local files have browser-dependent storage permissions. Portable editing
    // stays in this session; the explicit JSON download is the durable copy.
    ME_PORTABLE_SESSION_COLLECTION = data;
    return;
  }
  const db = await openDatabase();
  const keys = new Set(data.items.map(item => imageKey(item.image)).filter(Boolean));
  for (const key of keys) if (!persistedImages.has(key)) await originalImage(key);
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE, ASSET_STORE], 'readwrite');
    const images = transaction.objectStore(ASSET_STORE);
    for (const key of keys) {
      const request = images.getKey(key);
      request.onsuccess = () => { if (request.result === undefined) images.put(imageCache.get(key).blob, key); };
    }
    transaction.objectStore(STORE).put(data, 'active');
    const cursor = images.openKeyCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      if (!keys.has(cursor.result.key)) images.delete(cursor.result.key);
      cursor.result.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error('保存できませんでした。空き容量を確認するか、データを書き出して保管してください。'));
  });
  persistedImages.clear();
  for (const key of keys) persistedImages.add(key);
  // Deleted originals should not remain in memory or occupy browser storage.
  for (const [key, cached] of imageCache) if (!keys.has(key)) {
    URL.revokeObjectURL(cached.url);
    imageReferences.delete(cached.url);
    imageCache.delete(key);
  }
  updateChannel?.postMessage({ type: 'saved' });
  window.dispatchEvent(new Event('me:collection'));
  try { localStorage.setItem('me-eye-grid-saved', String(Date.now())); } catch {}
}

function loadImage(src, cors = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('画像の読み込みが時間切れになりました。ファイルで取り込んでください。')); }, 18000);
    if (cors) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      clearTimeout(timer);
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error('画像サイズを読み取れませんでした。'));
      else resolve(image);
    };
    image.onerror = () => { clearTimeout(timer); reject(new Error('画像を読み込めませんでした。画像ファイルか、画像そのもののURLを指定してください。')); };
    image.src = src;
  });
}

async function imageData(image) {
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を変換できませんでした。');
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .92));
  if (!blob) throw new Error('画像を変換できませんでした。');
  const key = await rememberImage(blob);
  return { image: imageCache.get(key).url, imageGroup: key.slice(0, 64), width, height };
}

export async function readImageFile(file) {
  if (!file || file.size > 40 * 1024 * 1024) throw new Error('画像ファイルは 40 MB 以下にしてください。');
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name || '')) throw new Error('PNG・JPEG・WebP・GIF・AVIF の画像を指定してください。');
  const objectUrl = URL.createObjectURL(file);
  try { return imageData(await loadImage(objectUrl)); }
  finally { URL.revokeObjectURL(objectUrl); }
}

export async function readImageUrl(value) {
  const url = safeUrl(value);
  if (!url) throw new Error('画像URLは http または https で指定してください。');
  const parsed = new URL(url);
  if (/(^|\.)(x|twitter)\.com$/i.test(parsed.hostname) && /\/status\//.test(parsed.pathname)) throw new Error('投稿URLは出典リンク欄へ。画像ファイルか画像そのもののURLを指定してください。');
  try { return imageData(await loadImage(url, true)); }
  catch {
    const image = await loadImage(url);
    return { image: url, width: image.naturalWidth, height: image.naturalHeight };
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function collectionArchive(collection) {
  const { createCollectionArchive } = await import('./collection-archive.js');
  const data = await normalizeCollection(collection);
  return createCollectionArchive(data, originalImage);
}

export async function downloadArchive(collection) {
  downloadBlob(await collectionArchive(collection), 'eyes-backup.zip');
}

export async function publishCollection(collection) {
  if (isPortableEditor || ME_PORTABLE_MODE !== 'draft' || !ROOT_URL) throw new Error('ローカルの編集画面から保存してください。');
  const response = await fetch(new URL('publish/', ROOT_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', 'X-Eyes-Editor': 'local' },
    body: await collectionArchive(collection),
  });
  const result = await response.json();
  if (!response.ok || !result.saved) throw new Error(result.error || '公開用ファイルに保存できませんでした。');
  return result;
}

export async function readCollectionFile(file) {
  if (/\.zip$/i.test(file.name)) {
    const { readCollectionArchive } = await import('./collection-archive.js');
    const { collection, images } = await readCollectionArchive(file);
    for (const [key, blob] of images) await rememberImage(blob, key);
    return materializeCollection(collection);
  }
  let raw;
  try { raw = JSON.parse(await file.text()); }
  catch { throw new Error('バックアップZIPまたは以前のJSONを指定してください。'); }
  const data = validateCollection(raw);
  // Legacy JSON backups must contain their own images or external URLs.
  if (data.items.some(item => imageKey(item.image) || item.image.startsWith('blob:'))) throw new Error('画像を含むバックアップZIPを指定してください。');
  return materializeCollection(data);
}

async function meEmbedCollectionImages(data) {
  const embeddedItems = [];
  for (const entry of data.items) {
    if (entry.image.startsWith('data:')) { embeddedItems.push(entry); continue; }
    let blob;
    try {
      const response = await fetch(entry.image);
      if (!response.ok) throw new Error();
      blob = await response.blob();
    } catch { throw new Error('「' + (entry.title || '画像') + '」を埋め込めません。画像ファイルで取り込み直してください。'); }
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('画像を書き出せませんでした。'));
      reader.readAsDataURL(blob);
    });
    embeddedItems.push({ ...entry, image });
  }
  return { ...data, items: embeddedItems };
}

export async function createSiteHTML(collection) {
  const data = validateCollection(collection);
  const files = ['index.html', 'viewer.css', 'assets/eyes.js', 'field-layout.js', 'field-gl.js', 'format.js', 'model.js', 'shared.js', 'random-field.js', 'viewer.js'];
  const sourcesElement = document.getElementById('me-export-sources');
  let embeddedSources = null;
  if (sourcesElement) {
    try { embeddedSources = JSON.parse(sourcesElement.textContent); }
    catch { throw new Error('埋め込まれた書き出し用ファイルを読み込めませんでした。編集ツールを元のZIPから開き直してください。'); }
    if (!embeddedSources || typeof embeddedSources !== 'object' || Array.isArray(embeddedSources)) {
      throw new Error('埋め込まれた書き出し用ファイルが不正です。');
    }
  }
  const [template, css, graphics, layout, renderer, format, model, shared, random, viewer] = await Promise.all(files.map(async name => {
    if (embeddedSources) {
      if (!Object.prototype.hasOwnProperty.call(embeddedSources, name) || typeof embeddedSources[name] !== 'string') {
        throw new Error('サイトの書き出し用ファイル「' + name + '」が見つかりません。');
      }
      return embeddedSources[name];
    }
    const response = await fetch(new URL(name, ROOT_URL), { cache: 'no-cache' });
    if (!response.ok) throw new Error('サイトの書き出し用ファイルを読み込めませんでした。');
    return response.text();
  }));

  // Preserve the original preset image bytes instead of re-encoding them.
  const presetPairs = await Promise.all(eyePresets.map(async preset => {
    if (preset.image.startsWith('data:')) return [preset.id, preset.image];
    try {
      const response = await fetch(preset.image, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Preset image request failed.');
      const blob = await response.blob();
      if (!blob.size || !/^image\//i.test(blob.type)) throw new Error('Preset response is not an image.');
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) resolve(reader.result);
          else reject(new Error('Preset image could not be embedded.'));
        };
        reader.onerror = reader.onabort = () => reject(new Error('Preset image could not be read.'));
        reader.readAsDataURL(blob);
      });
      return [preset.id, image];
    } catch {
      throw new Error('「' + preset.title + '」の素材を埋め込めませんでした。ページを開き直してから書き出してください。');
    }
  }));
  const presetImages = Object.fromEntries(presetPairs);

  // Every user-supplied external image must also be embedded before downloading.
  const portable = await meEmbedCollectionImages(data);
  const stripExports = text => text.replace(/^export\s+(?=(?:async\s+)?function\b|(?:const|let|var|class)\b)/gm, '');
  const stripImports = text => text.replace(/^(?:import|export)\s+[^;]+\sfrom\s+[^;]+;\s*$/gm, '');
  const stripModuleDeclarations = text => stripExports(stripImports(text));
  // Keep import.meta.url valid by retaining one inline module. Preset data is
  // inserted first, so its image resolver never needs a relative asset fallback.
  const escapeScript = text => text.replace(/<\/script/gi, '<\\/script');
  const bundle = escapeScript(
    [graphics, layout, renderer, format, model, shared, random, viewer].map(stripModuleDeclarations).join('\n\n')
  );
  const serializeForScript = value => JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const serialized = serializeForScript(portable);
  const serializedPresets = serializeForScript(presetImages);
  const stylesheetTag = '<link rel="stylesheet" href="./viewer.css">';
  const viewerScriptTag = '<script type="module" src="./viewer.js"></script>';
  if (!template.includes(stylesheetTag) || !template.includes(viewerScriptTag)) {
    throw new Error('サイトの書き出し用テンプレートを確認できませんでした。ページを開き直してください。');
  }
  const html = template
    .replace(/<html\b([^>]*)>/i, (_tag, attributes) => '<html' + attributes.replace(/\sdata-me-portable=(?:"[^"]*"|'[^']*')/gi, '') + ' data-me-portable="viewer">')
    .replace(stylesheetTag, () => '<style>' + css + '</style>')
    .replace(/<a\b[^>]*\b(?:id=["']admin-edit["']|class=["'][^"']*\bedit-link\b[^"']*["'])[^>]*>[\s\S]*?<\/a\s*>/gi, '')
    .replace(viewerScriptTag, () =>
      '<script type="application/json" id="me-preset-images">' + serializedPresets + '</script>'
      + '<script type="application/json" id="me-collection">' + serialized + '</script>'
      + '<script type="module">' + bundle + '</script>'
    );
  return html;
}

export async function downloadSite(collection) {
  const html = await createSiteHTML(collection);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'me.html');
}
