import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('collections are not limited to 256 registrations', () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({ ...item(), id: `eye-${index}` }));
  assert.equal(validateCollection({ version: 2, items }).items.length, 1000);
});
