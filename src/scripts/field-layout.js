// Keep viewer, WebGL and editor crop geometry in agreement.
export const FIELD_GEOMETRY = Object.freeze({
  imageScale: 1,
  previousArtFraction: .66,
  artFraction: .66,
});

// Fixed depth variation follows world coordinates while scrolling.
function fieldNoise(index, salt = 0) {
  let value = Math.imul((index + 1) ^ (salt + 0x7f4a7c15), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function fieldAppearance(column, row = 0) {
  const position = Math.imul(column | 0, 0x1f123bb5) ^ Math.imul(row | 0, 0x5f356495);
  return {
    light: false,
    opacity: 1,
    depth: (fieldNoise(position, 283) - .5) * 18,
  };
}
