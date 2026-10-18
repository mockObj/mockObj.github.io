import { eyePresets } from '../scripts/eyes.js';
import { emptyCollection, safeUrl, validateCollection } from './collection-model.js';
export { emptyCollection, safeUrl, newId, validateCollection } from './collection-model.js';

const ME_PORTABLE_MODE = document.documentElement.dataset.mePortable || '';
export const isPortableEditor = ME_PORTABLE_MODE === 'editor';
// An embedded viewer can also be opened from a Blob URL. Relative URL creation
// is unnecessary there, and a blob: URL cannot be used as a relative base.
const ROOT_URL = document.getElementById('me-collection') ? null : new URL(document.documentElement.dataset.meRoot || '/content/me/', window.location.href);
const DATABASE = 'mockobj-content-me-v1';
const STORE = 'collections';
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
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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
    return validateCollection(ME_PORTABLE_SESSION_COLLECTION);
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
  if (saved !== undefined) return validateCollection(saved);
  return loadPublishedCollection();
}

async function loadPublishedCollection() {
  const response = await fetch(new URL('collection.json', ROOT_URL), { cache: 'no-cache' });
  if (!response.ok) throw new Error('画像データを読み込めませんでした。');
  return validateCollection(await response.json());
}

export async function saveCollection(collection) {
  const data = validateCollection(collection);
  if (isPortableEditor) {
    // Local files have browser-dependent storage permissions. Portable editing
    // stays in this session; the explicit JSON download is the durable copy.
    ME_PORTABLE_SESSION_COLLECTION = data;
    return;
  }
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(data, 'active');
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error('保存できませんでした。空き容量を確認するか、データを書き出して保管してください。'));
  });
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

function imageData(image) {
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を変換できませんでした。');
  context.drawImage(image, 0, 0, width, height);
  const data = canvas.toDataURL('image/webp', .92);
  if (!data.startsWith('data:image/')) throw new Error('画像を変換できませんでした。');
  return { image: data, width, height };
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

export async function downloadJSON(collection) {
  const validated = validateCollection(collection);
  const data = isPortableEditor ? await meEmbedCollectionImages(validated) : validated;
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'collection.json');
}

async function meEmbedCollectionImages(data) {
  const embeddedItems = [];
  for (const entry of data.items) {
    if (entry.image.startsWith('data:')) { embeddedItems.push(entry); continue; }
    const result = await readImageUrl(entry.image);
    if (!result.image.startsWith('data:')) throw new Error('「' + (entry.title || '画像') + '」を埋め込めません。画像ファイルで取り込み直してから書き出してください。');
    embeddedItems.push({ ...entry, ...result });
  }
  return { ...data, items: embeddedItems };
}

export async function createSiteHTML(collection) {
  const data = validateCollection(collection);
  const files = ['index.html', 'viewer.css', 'assets/eyes.js', 'field-layout.js', 'field-gl.js', 'model.js', 'shared.js', 'random-field.js', 'viewer.js'];
  const sourcesElement = document.getElementById('me-export-sources');
  let embeddedSources = null;
  if (sourcesElement) {
    try { embeddedSources = JSON.parse(sourcesElement.textContent); }
    catch { throw new Error('埋め込まれた書き出し用ファイルを読み込めませんでした。編集ツールを元のZIPから開き直してください。'); }
    if (!embeddedSources || typeof embeddedSources !== 'object' || Array.isArray(embeddedSources)) {
      throw new Error('埋め込まれた書き出し用ファイルが不正です。');
    }
  }
  const [template, css, graphics, layout, renderer, model, shared, random, viewer] = await Promise.all(files.map(async name => {
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
    [graphics, layout, renderer, model, shared, random, viewer].map(stripModuleDeclarations).join('\n\n')
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
