import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { describeImage, imageKey, imagePath } from '../src/lib/collection-format.js';
import { readStoredCollection, readStoredImage, writeStoredCollection } from '../src/lib/collection-files.js';
import { createCollectionArchive, readCollectionArchive } from '../src/lib/collection-archive.js';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const item = (id = 'one') => ({ id, title: 'Eye', image: 'data:image/png;base64,' + bytes.toString('base64'), width: 1, height: 1, sourceUrl: '', eye: { x: .5, y: .5, r: .2 } });

test('split storage preserves originals, shares duplicate bytes, round-trips ZIP and discards only unused assets', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'eyes-files-'));
  const root = join(parent, 'collection');
  try {
    const saved = await writeStoredCollection({ version: 2, items: [item(), { ...item('two'), eye: { x: .3, y: .4, r: .1 } }] }, null, root);
    const key = imageKey(saved.items[0].image);
    assert.equal(saved.items[0].image, saved.items[1].image);
    assert.equal((await readdir(join(root, 'images', key.slice(0, 2)))).length, 1);
    assert.deepEqual(await readStoredImage(key, root), bytes);
    assert.ok(JSON.stringify(saved).length < 1000);
    const archive = await createCollectionArchive(saved, async key => new Blob([await readStoredImage(key, root)], { type: 'image/png' }));
    const restored = await readCollectionArchive(archive);
    assert.deepEqual(restored.collection, saved);
    assert.equal(restored.images.size, 1);
    await writeStoredCollection(restored.collection, key => restored.images.get(key), root);
    assert.deepEqual(await readStoredCollection(root), saved);
    await assert.rejects(writeStoredCollection({ version: 2, items: [item(), item()] }, null, root));
    await assert.rejects(writeStoredCollection(saved, () => new Blob(['corrupt']), root));
    assert.deepEqual(await readStoredCollection(root), saved);
    assert.deepEqual(await readStoredImage(key, root), bytes);
    await writeStoredCollection({ version: 2, items: saved.items.slice(1) }, key => restored.images.get(key), root);
    assert.deepEqual(await readStoredImage(key, root), bytes, 'other crops keep their original');
    await writeStoredCollection({ version: 2, items: [] }, null, root);
    assert.equal((await readdir(join(root, 'images'))).length, 0);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('archive imports reject path traversal, missing or damaged originals and duplicate IDs', async () => {
  const blob = new Blob([bytes], { type: 'image/png' });
  const { key } = await describeImage(blob);
  const saved = { version: 3, items: [{ ...item(), image: `asset:${key}` }] };
  const archive = await createCollectionArchive(saved, () => blob);
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const changed = { ...files, [imagePath(key)]: new TextEncoder().encode('corrupt') };
  await assert.rejects(readCollectionArchive(new Blob([zipSync(changed)])));
  const missing = { ...files }; delete missing[imagePath(key)];
  await assert.rejects(readCollectionArchive(new Blob([zipSync(missing)])));
  await assert.rejects(readCollectionArchive(new Blob([zipSync({ ...files, '../outside.json': new Uint8Array() })])));
  await assert.rejects(readCollectionArchive(archive.slice(0, archive.size / 2)));
});
