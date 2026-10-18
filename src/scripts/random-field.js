/** Seeded placement with a guaranteed minimum repeat distance. */
export function createRandomField(items, seed = Math.random() * 0x100000000 >>> 0) {
  const grouped = new Map();
  for (const item of items) {
    const identity = item.imageGroup || item.image;
    if (!grouped.has(identity)) grouped.set(identity, []);
    grouped.get(identity).push(item);
  }
  const groups = [...grouped.values()];
  const count = groups.length;
  const modulo = value => ((value % count) + count) % count;
  const hash = (x, y, salt = seed) => {
    let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ salt;
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return (value ^ value >>> 16) >>> 0;
  };
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const jitter = count >= 9 ? 1 : 0;
  const radius = Math.ceil(Math.sqrt(count * 2));
  const offsets = [];
  for (let y = 0; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    if (y === 0 && x <= 0 || x * x + y * y > radius * radius) continue;
    offsets.push([x, y, x * x + y * y]);
  }
  offsets.sort((a, b) => a[2] - b[2]);
  let stepX = count >= 9 ? 2 : 1, stepY = count >= 9 ? 5 : 1;
  let bestDistance = 0, bestRank = Infinity;
  const consider = (x, y) => {
    if (!x || !y || gcd(gcd(x, y), count) !== 1) return;
    let distance = radius * radius + 1;
    for (const [dx, dy, squared] of offsets) {
      const difference = modulo(x * dx + y * dy);
      // Independent cell jitter changes a difference by at most one. Exclude
      // those possible collisions too, rather than fixing repeats after drawing.
      if (Math.min(difference, count - difference) <= jitter) { distance = squared; break; }
    }
    const rank = hash(x, y, seed ^ 0x514e2a37);
    if (distance > bestDistance || distance === bestDistance && rank < bestRank) {
      stepX = x; stepY = y; bestDistance = distance; bestRank = rank;
    }
  };
  if (count > 1) {
    consider(stepX, stepY);
    if (count <= 32) {
      for (let x = 1; x < count; x++) for (let y = 1; y < count; y++) consider(x, y);
    } else {
      for (let index = 0; index < 160; index++) consider(1 + hash(index, 11) % (count - 1), 1 + hash(index, 29) % (count - 1));
    }
  }
  const order = groups.map((_, index) => index);
  for (let end = order.length - 1; end > 0; end--) {
    const other = hash(end, 53) % (end + 1);
    [order[end], order[other]] = [order[other], order[end]];
  }
  const phase = count ? hash(31, 71) % count : 0;
  return {
    uniqueCount: count,
    chunkSize: Math.max(12, Math.ceil(Math.sqrt(count * 4))),
    itemAt(column, row) {
      if (!count) return null;
      // Coordinate noise breaks repeating tiles; spacing holds across every
      // boundary and negative axis, independently of the order of queries.
      const variation = jitter ? hash(column, row, seed ^ 0x6d2b79f5) & 1 : 0;
      const variants = groups[order[modulo(column * stepX + row * stepY + phase + variation)]];
      return variants[hash(column, row, seed ^ 0x7f4a7c15) % variants.length];
    },
  };
}
