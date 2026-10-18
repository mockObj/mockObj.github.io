import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { emptyCollection, validateCollection, safeUrl } from '../src/lib/collection-model.js';

const item = () => ({
  id: 'example', title: '目', image: 'data:image/png;base64,aGVsbG8=', width: 100, height: 100,
  sourceUrl: 'https://example.com/eyes', eye: { x: .5, y: .5, r: .2 },
});

test('rejects broken layouts, missing images and duplicated IDs', () => {
  const data = { version: 1, columns: 8, rows: 8, slots: Array(64).fill(null), items: [] };
  data.slots[0] = 'missing';
  assert.throws(() => validateCollection(data));
  assert.throws(() => validateCollection({ ...data, slots: [] }));
  assert.throws(() => validateCollection({ ...emptyCollection(), items: [item(), item()] }));
});

test('rejects executable URLs and preserves valid crop data', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://user:password@example.com/'), '');
  assert.throws(() => validateCollection({ ...emptyCollection(), items: [{ ...item(), sourceUrl: 'javascript:alert(1)' }] }));
  assert.throws(() => validateCollection({ ...emptyCollection(), items: [{ ...item(), image: 'data:image/svg+xml,<svg></svg>' }] }));
  const data = { ...emptyCollection(), items: [item()] };
  assert.deepEqual(validateCollection(data), data);
});

test('legacy collections migrate all images, including images beyond the former 64 slots', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...item(), id: 'eye-' + index }));
  const data = { version: 1, columns: 8, rows: 8, slots: Array(64).fill(null), items };
  data.slots[0] = items[0].id;
  assert.deepEqual(validateCollection(data), { version: 2, items });
  assert.deepEqual(validateCollection({ ...data, columns: 10, rows: 10, slots: Array(100).fill(null) }), { version: 2, items });
});

test('an invalid JSON import never overwrites the published collection', async () => {
  const before = await readFile(new URL('../src/data/collection.json', import.meta.url), 'utf8');
  const directory = await mkdtemp(join(tmpdir(), 'eyes-invalid-'));
  try {
    const file = join(directory, 'broken.json');
    await writeFile(file, JSON.stringify({ version: 1 }));
    assert.throws(() => execFileSync(process.execPath, ['scripts/import-collection.mjs', file], { stdio: 'pipe' }));
    assert.equal(await readFile(new URL('../src/data/collection.json', import.meta.url), 'utf8'), before);
  } finally {
    await unlink(join(directory, 'broken.json'));
    await rmdir(directory);
  }
});
