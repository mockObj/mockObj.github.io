// Keep viewer, WebGL and editor crop geometry in agreement.
export const FIELD_GEOMETRY = Object.freeze({
  imageScale: 1,
  previousArtFraction: .66,
  artFraction: .66,
});

// Fixed depth variation follows the collection around the loop.
function fieldNoise(index, salt = 0) {
  let value = Math.imul((index + 1) ^ (salt + 0x7f4a7c15), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function fieldAppearance(index) {
  const slot = ((index % 64) + 64) % 64;
  return {
    light: false,
    opacity: 1,
    depth: (fieldNoise(slot, 283) - .5) * 18,
  };
}
