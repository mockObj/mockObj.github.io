import { readFile, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { resolve } from 'node:path';
import { readStoredCollection, readStoredImage, writeStoredCollection } from '../src/lib/collection-files.js';
import { readCollectionArchive } from '../src/lib/collection-archive.js';
import { IMAGE_TYPES } from '../src/lib/collection-format.js';

const input = process.argv[2];
if (!input) {
  console.error('使い方: npm run data:import -- "C:\\path\\to\\eyes-backup.zip"（以前のJSON・展開済みフォルダも可）');
  process.exitCode = 1;
} else {
  try {
    const path = resolve(input);
    let collection, readImage;
    if ((await stat(path)).isDirectory()) {
      collection = await readStoredCollection(path);
      readImage = async key => new Blob([await readStoredImage(key, path)], { type: IMAGE_TYPES[key.split('.').at(-1)] });
    } else if (/\.zip$/i.test(path)) {
      const archive = await readCollectionArchive(await openAsBlob(path));
      collection = archive.collection;
      readImage = key => archive.images.get(key);
    } else collection = JSON.parse(await readFile(path, 'utf8'));
    const result = await writeStoredCollection(collection, readImage);
    console.log(`${result.items.length}枚を src/data/collection/ に保存しました。画像は重複をまとめて個別保存します。`);
    console.log('変更を commit / push すると公開されます。');
  } catch (error) {
    console.error('取り込み失敗: ' + error.message);
    process.exitCode = 1;
  }
}
