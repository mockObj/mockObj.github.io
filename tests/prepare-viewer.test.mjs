import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareViewerCollection } from '../src/lib/prepare-viewer.js';
import { createRandomField } from '../src/scripts/random-field.js';

test('publication produces small, padded WebP crops without changing editable originals or duplicate weighting', async () => {
  const width = 1200, height = 600;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    pixels[at] = x < width / 2 ? 0 : 255;
    pixels[at + 2] = x < width / 2 ? 255 : 0;
  }
  const original = await sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const image = 'data:image/png;base64,' + original.toString('base64');
  const item = { id: 'blue', title: 'Eye', image, width, height, sourceUrl: 'https://example.com/source', eye: { x: .25, y: .5, r: .1 } };
  const raw = { version: 2, items: [item, { ...item, id: 'red', eye: { ...item.eye, x: .75 } }] };
  const { collection, assets } = await prepareViewerCollection(raw, 'https://example.com/images/');
  assert.equal(raw.items[0].image, image);
  assert.deepEqual(raw.items[0].eye, { x: .25, y: .5, r: .1 });
  assert.equal(assets.size, 2);
  assert.ok(JSON.stringify(collection).length < 2000);
  assert.equal(collection.items[0].imageGroup, collection.items[1].imageGroup);
  assert.equal(createRandomField(collection.items).uniqueCount, 1);
  for (const [index, item] of collection.items.entries()) {
    const key = new URL(item.image).pathname.split('/').at(-1).replace('.webp', '');
    const image = assets.get(key);
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 384);
    assert.ok(image.length < original.length / 20);
    const { data } = await sharp(image).extract({ left: 192, top: 192, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[index === 0 ? 2 : 0] > 240, 'the chosen eye center stays aligned');
  }
});

test('edge crops retain transparent padding and external images remain valid', async () => {
  const image = 'data:image/png;base64,' + (await sharp({ create: { width: 64, height: 64, channels: 4, background: '#fff' } }).png().toBuffer()).toString('base64');
  const item = { id: 'edge', title: '', image, width: 64, height: 64, sourceUrl: '', eye: { x: .02, y: .02, r: .5 } };
  const { collection, assets } = await prepareViewerCollection({ version: 2, items: [item, { ...item, id: 'remote', image: 'https://example.com/eye.png' }] }, 'https://example.com/images/');
  const corner = await sharp([...assets.values()][0]).extract({ left: 0, top: 0, width: 1, height: 1 }).ensureAlpha().raw().toBuffer();
  assert.equal(corner[3], 0);
  assert.equal(collection.items[1].image, 'https://example.com/eye.png');
});
