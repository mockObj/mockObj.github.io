import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRandomField } from '../src/scripts/random-field.js';

const images = count => Array.from({ length: count }, (_, index) => ({ id: String(index), image: 'image-' + index }));

test('all 130 images participate across the field', () => {
  const items = images(130), field = createRandomField(items, 42);
  const seen = new Set();
  for (let y = -64; y < 64; y++) for (let x = -64; x < 64; x++) seen.add(field.itemAt(x, y).image);
  assert.equal(seen.size, 130);
  assert.equal(field.uniqueCount, 130);
});

test('duplicate registrations do not increase an image frequency, and all crop variants remain available', () => {
  const items = images(12);
  items.push({ ...items[0], id: 'alternate-crop' });
  const field = createRandomField(items, 17);
  assert.equal(field.uniqueCount, 12);
  const original = createRandomField(images(12), 17);
  const seen = new Set();
  for (let row = 0; row < 30; row++) for (let column = 0; column < 30; column++) {
    seen.add(field.itemAt(column, row).id);
    assert.equal(field.itemAt(column, row).image, original.itemAt(column, row).image);
  }
  assert.ok(seen.has('0') && seen.has('alternate-crop'));
});

test('placement stays fixed at negative and distant coordinates regardless of query order', () => {
  const items = images(80), field = createRandomField(items, 1234);
  const coordinates = [[-100, -59], [-1, -1], [0, 0], [10007, -30002]];
  const original = coordinates.map(([x, y]) => field.itemAt(x, y).id);
  for (let index = 0; index < 100; index++) field.itemAt(index * 100, index * 150);
  assert.deepEqual(coordinates.map(([x, y]) => field.itemAt(x, y).id), original);
  const other = createRandomField(items, 9876);
  assert.notDeepEqual(coordinates.map(([x, y]) => other.itemAt(x, y).id), original);
  const patch = offset => Array.from({ length: 100 }, (_, index) => field.itemAt(offset + index % 10, Math.floor(index / 10)).id);
  assert.notDeepEqual(patch(0), patch(8));
});

test('nine or more distinct eyes never repeat in any of the eight neighboring cells', () => {
  for (const count of [9, 10, 12, 23, 100, 256]) for (const seed of [1, 42, 1234]) {
    const field = createRandomField(images(count), seed);
    for (const origin of [-10007, -25, 0, 10007]) for (let y = origin; y < origin + 20; y++) for (let x = origin; x < origin + 20; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        assert.notEqual(field.itemAt(x, y).image, field.itemAt(x + dx, y + dy).image, `${count} eyes, seed ${seed}, (${x}, ${y})`);
      }
    }
  }
});

test('with 23 eyes even the surrounding two-cell radius stays free of repeats', () => {
  for (const seed of [1, 42, 1234]) {
    const field = createRandomField(images(23), seed);
    for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx || dy) assert.notEqual(field.itemAt(x, y).image, field.itemAt(x + dx, y + dy).image);
      }
    }
  }
});

test('nearby repetition is substantially lower than independent random picks', () => {
  for (const seed of [1, 42, 1234]) {
    const field = createRandomField(images(12), seed);
    let repeated = 0, pairs = 0;
    for (let row = -20; row < 20; row++) for (let column = -20; column < 20; column++) {
      const image = field.itemAt(column, row).image;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        pairs++;
        if (image === field.itemAt(column + dx, row + dy).image) repeated++;
      }
    }
    assert.ok(repeated / pairs < .04, `seed ${seed}: ${repeated}/${pairs} adjacent repeats`);
  }
});

test('empty and single-image collections work without special dimensions', () => {
  assert.equal(createRandomField([], 1).itemAt(-1, 200), null);
  const field = createRandomField(images(1), 1);
  assert.equal(field.itemAt(-120, 300).id, '0');
});
