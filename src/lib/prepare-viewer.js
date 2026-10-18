import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { validateCollection } from './collection-model.js';
import { imageKey } from './collection-format.js';

const SIDE = 384;
const PADDING = 1.5;

// Runs at build time. Originals remain in the editable collection, never in
// the small manifest fetched by the public viewer.
export async function prepareViewerCollection(raw, imageBase, readImage) {
  const collection = validateCollection(raw);
  const assets = new Map();
  const items = [];
  for (const item of collection.items) {
    const stored = imageKey(item.image);
    if (!stored && !item.image.startsWith('data:')) { items.push(item); continue; }
    const group = stored ? stored.slice(0, 64) : createHash('sha256').update(Buffer.from(item.image.slice(item.image.indexOf(',') + 1), 'base64')).digest('hex');
    const key = createHash('sha256').update(group + JSON.stringify(item.eye)).digest('hex').slice(0, 24);
    if (!assets.has(key)) {
      const input = stored ? await readImage(stored) : Buffer.from(item.image.slice(item.image.indexOf(',') + 1), 'base64');
      if (stored && createHash('sha256').update(input).digest('hex') !== group) throw new Error('原本画像が破損しています: ' + item.id);
      const options = { autoOrient: true, limitInputPixels: 100000000 };
      const metadata = await sharp(input, options).metadata();
      const swapped = metadata.orientation >= 5 && metadata.orientation <= 8;
      const width = swapped ? metadata.height : metadata.width;
      const height = swapped ? metadata.width : metadata.height;
      const side = Math.max(1, Math.round(item.eye.r * Math.min(width, height) / .26 * PADDING));
      const left = Math.round(item.eye.x * width - side / 2);
      const top = Math.round(item.eye.y * height - side / 2);
      const x = Math.max(0, left), y = Math.max(0, top);
      const cropWidth = Math.min(width, left + side) - x;
      const cropHeight = Math.min(height, top + side) - y;
      const targetX = Math.round((x - left) * SIDE / side);
      const targetY = Math.round((y - top) * SIDE / side);
      const region = await sharp(input, options)
        .extract({ left: x, top: y, width: cropWidth, height: cropHeight })
        .resize(Math.max(1, Math.min(SIDE - targetX, Math.round(cropWidth * SIDE / side))), Math.max(1, Math.min(SIDE - targetY, Math.round(cropHeight * SIDE / side))))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const image = await sharp({ create: { width: SIDE, height: SIDE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: region.data, raw: { width: region.info.width, height: region.info.height, channels: 4 }, left: targetX, top: targetY }])
        .webp({ quality: 82, effort: 4 }).toBuffer();
      assets.set(key, image);
    }
    items.push({ ...item, image: new URL(key + '.webp', imageBase).href, imageGroup: group, width: SIDE, height: SIDE, eye: { x: .5, y: .5, r: .26 / PADDING } });
  }
  return { collection: { version: 2, items }, assets };
}
