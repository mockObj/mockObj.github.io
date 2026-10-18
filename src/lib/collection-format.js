// Version 3 keeps every image and registration in a separate, sharded file.
export const IMAGE_KEY = /^[a-f0-9]{64}\.(?:png|jpg|webp|gif|avif)$/;
export const RECORD_PATH = /^items\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/;
export const IMAGE_PATH = /^images\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:png|jpg|webp|gif|avif)$/;
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export function imageKey(reference) {
  const key = typeof reference === 'string' && reference.startsWith('asset:') ? reference.slice(6) : '';
  return IMAGE_KEY.test(key) ? key : '';
}

export function imagePath(key) {
  if (!IMAGE_KEY.test(key)) throw new Error('画像の保存先が不正です。');
  return `images/${key.slice(0, 2)}/${key}`;
}

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}

export async function recordPath(id) {
  const hash = await sha256(new TextEncoder().encode(id));
  return `items/${hash.slice(0, 2)}/${hash}.json`;
}

export async function describeImage(blob) {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('画像ファイルは 40 MB 以下にしてください。');
  const type = blob.type.toLowerCase().split(';')[0].replace('image/jpg', 'image/jpeg');
  const extension = Object.keys(IMAGE_TYPES).find(key => IMAGE_TYPES[key] === type);
  if (!extension) throw new Error('PNG・JPEG・WebP・GIF・AVIF の画像を指定してください。');
  const hash = await sha256(await blob.arrayBuffer());
  return { key: `${hash}.${extension}`, hash };
}

export async function verifyImage(key, blob) {
  if (!IMAGE_KEY.test(key) || !blob || !blob.size || blob.size > MAX_IMAGE_BYTES || await sha256(await blob.arrayBuffer()) !== key.slice(0, 64)) {
    throw new Error('画像の欠落または破損を検出しました。元データは変更していません。');
  }
}
