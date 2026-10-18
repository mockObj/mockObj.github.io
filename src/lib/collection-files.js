import { readFile, writeFile, readdir, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateCollection } from './collection-model.js';
import { describeImage, imageKey, imagePath, recordPath, verifyImage } from './collection-format.js';

// import.meta.url changes when Astro bundles this module for prerendering.
export const COLLECTION_DIRECTORY = resolve('src/data/collection');

async function recordFiles(root) {
  const files = [];
  let shards;
  try { shards = await readdir(join(root, 'items'), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const shard of shards) {
    if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) throw new Error('登録画像のフォルダが不正です。');
    for (const file of await readdir(join(root, 'items', shard.name), { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) throw new Error('登録画像のファイル名が不正です。');
      files.push(`items/${shard.name}/${file.name}`);
    }
  }
  return files;
}

export async function readStoredCollection(root = COLLECTION_DIRECTORY) {
  if (JSON.parse(await readFile(join(root, 'format.json'), 'utf8')).version !== 3) throw new Error('保存形式が不正です。');
  const records = [];
  for (const file of await recordFiles(root)) {
    if ((await stat(join(root, file))).size > 65536) throw new Error('登録情報が大きすぎます。');
    const record = JSON.parse(await readFile(join(root, file), 'utf8'));
    if (!Number.isSafeInteger(record.order) || record.order < 0 || file !== await recordPath(record.id)) throw new Error('登録情報が不正です。');
    records.push(record);
  }
  records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const collection = validateCollection({ version: 3, items: records });
  for (const item of collection.items) if (!imageKey(item.image) && !/^https?:/.test(item.image)) throw new Error('原本の画像参照が不正です。');
  return collection;
}

export async function readStoredImage(key, root = COLLECTION_DIRECTORY) {
  return readFile(join(root, imagePath(key)));
}

// Complete and validate a stage before swapping it with the current directory.
export async function writeStoredCollection(raw, readImage, root = COLLECTION_DIRECTORY) {
  root = resolve(root);
  const collection = validateCollection(raw);
  const stage = join(dirname(root), `.collection-stage-${randomUUID()}`);
  const previous = join(dirname(root), `.collection-previous-${randomUUID()}`);
  if ([stage, previous].some(path => relative(dirname(root), path).startsWith('..') || dirname(path) !== dirname(root))) throw new Error('保存先が不正です。');
  let moved = false;
  try {
    await mkdir(join(stage, 'items'), { recursive: true });
    await mkdir(join(stage, 'images'));
    const written = new Set();
    for (const [order, entry] of collection.items.entries()) {
      let item = { ...entry };
      let key = imageKey(item.image);
      if (item.image.startsWith('data:')) {
        const blob = await (await fetch(item.image)).blob();
        const info = await describeImage(blob);
        key = info.key;
        if (!written.has(key)) {
          const path = join(stage, imagePath(key));
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
          written.add(key);
        }
      } else if (key && !written.has(key)) {
        const blob = await readImage(key);
        await verifyImage(key, blob);
        const path = join(stage, imagePath(key));
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        written.add(key);
      } else if (!key && !/^https?:/.test(item.image)) throw new Error('原本の画像参照が不正です。');
      if (key) item = { ...item, image: `asset:${key}`, imageGroup: key.slice(0, 64) };
      const path = join(stage, await recordPath(item.id));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ order, ...item }, null, 2) + '\n');
    }
    await writeFile(join(stage, 'format.json'), '{"version":3}\n');
    const result = await readStoredCollection(stage);
    try { await rename(root, previous); moved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, root); }
    catch (error) { if (moved) await rename(previous, root); throw error; }
    if (moved) await rm(previous, { recursive: true });
    return result;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
