import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateCollection } from '../src/lib/collection-model.js';

const input = process.argv[2];
if (!input) {
  console.error('使い方: npm run data:import -- "C:\\path\\to\\collection.json"');
  process.exitCode = 1;
} else {
  try {
    const collection = validateCollection(JSON.parse(await readFile(resolve(input), 'utf8')));
    const target = fileURLToPath(new URL('../src/data/collection.json', import.meta.url));
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(collection, null, 2) + '\n');
    await rename(temporary, target);
    console.log(`${collection.items.length}枚の画像と64マスの配置を src/data/collection.json に保存しました。`);
    console.log('npm run build で確認後、変更を commit / push すると公開されます。');
  } catch (error) {
    console.error('取り込み失敗: ' + error.message);
    process.exitCode = 1;
  }
}
