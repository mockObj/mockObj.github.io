import { Zip, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';
import { IMAGE_PATH, RECORD_PATH, IMAGE_TYPES, MAX_IMAGE_BYTES, imageKey, imagePath, recordPath, verifyImage } from './collection-format.js';
import { validateCollection } from './collection-model.js';

const encode = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');

// Stream one original at a time instead of making an aggregate Base64 JSON.
export async function createCollectionArchive(raw, readImage) {
  const collection = validateCollection(raw);
  const chunks = [];
  let failure;
  const zip = new Zip((error, chunk) => { if (error) failure = error; else chunks.push(chunk); });
  const add = async (name, blob) => {
    const file = new ZipPassThrough(name);
    zip.add(file);
    for await (const chunk of blob.stream()) { file.push(chunk); if (failure) throw failure; }
    file.push(new Uint8Array(), true);
  };
  await add('format.json', new Blob([encode({ version: 3 })]));
  const included = new Set();
  for (const [order, item] of collection.items.entries()) {
    const key = imageKey(item.image);
    if (!key && !/^https?:/.test(item.image)) throw new Error('保存する画像の参照が不正です。');
    if (key && !included.has(key)) {
      const blob = await readImage(key);
      await verifyImage(key, blob);
      await add(imagePath(key), blob);
      included.add(key);
    }
    await add(await recordPath(item.id), new Blob([encode({ order, ...item })]));
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks, { type: 'application/zip' });
}

// Restrict paths, sizes and hashes before callers replace any saved data.
export async function readCollectionArchive(blob) {
  const files = new Map();
  let failure;
  const unzip = new Unzip(file => {
    const name = file.name;
    if (name.endsWith('/')) return;
    if (files.has(name) || !(name === 'format.json' || RECORD_PATH.test(name) || IMAGE_PATH.test(name))) {
      failure = new Error('バックアップ内のファイル名が不正です。'); return;
    }
    if (IMAGE_PATH.test(name) && name.split('/')[1] !== name.split('/')[2].slice(0, 2)) {
      failure = new Error('画像の保存先が不正です。'); return;
    }
    const chunks = [];
    let size = 0;
    const limit = IMAGE_PATH.test(name) ? MAX_IMAGE_BYTES : 65536;
    files.set(name, null);
    file.ondata = (error, bytes, final) => {
      if (error) { failure = error; return; }
      size += bytes.length;
      if (size > limit) { failure = new Error('バックアップ内のファイルが大きすぎます。'); return; }
      chunks.push(bytes);
      if (final) files.set(name, new Blob(chunks, { type: IMAGE_TYPES[name.split('.').at(-1)] || 'application/json' }));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of blob.stream()) { unzip.push(chunk); if (failure) throw failure; }
  unzip.push(new Uint8Array(), true);
  if (failure || [...files.values()].some(value => !value)) throw failure || new Error('バックアップが途中で切れています。');
  if (JSON.parse(await files.get('format.json')?.text() || 'null')?.version !== 3) throw new Error('対応するバックアップではありません。');
  const records = [];
  const images = new Map();
  for (const [name, file] of files) {
    if (RECORD_PATH.test(name)) {
      const item = JSON.parse(await file.text());
      if (!Number.isSafeInteger(item.order) || item.order < 0 || name !== await recordPath(item.id)) throw new Error('画像の登録情報が不正です。');
      records.push(item);
    } else if (IMAGE_PATH.test(name)) images.set(name.split('/').at(-1), file);
  }
  records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const collection = validateCollection({ version: 3, items: records });
  for (const item of collection.items) {
    const key = imageKey(item.image);
    if (!key && !/^https?:/.test(item.image)) throw new Error('画像の参照が不正です。');
    if (key && !images.has(key)) throw new Error('バックアップに画像が見つかりません。');
  }
  for (const [key, image] of images) await verifyImage(key, image);
  return { collection, images };
}
