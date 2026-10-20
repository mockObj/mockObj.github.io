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
  let bestDistance = 0, bestVertical = 0, bestRank = Infinity;
  const consider = (x, y) => {
    if (!x || !y || gcd(gcd(x, y), count) !== 1) return;
    let distance = radius * radius + 1;
    for (const [dx, dy, squared] of offsets) {
      const difference = modulo(x * dx + y * dy);
      // Independent cell jitter changes a difference by at most one. Exclude
      // those possible collisions too, rather than fixing repeats after drawing.
      if (Math.min(difference, count - difference) <= jitter) { distance = squared; break; }
    }
    if (distance < bestDistance) return;
    // Equal overall spacing can still stack one image every four rows.
    // Prefer the lattice with the longest vertical repeat distance.
    let vertical = 1;
    for (; vertical < count; vertical++) {
      const difference = modulo(y * vertical);
      if (Math.min(difference, count - difference) <= jitter) break;
    }
    const rank = hash(x, y, seed ^ 0x514e2a37);
    if (distance > bestDistance || vertical > bestVertical || vertical === bestVertical && rank < bestRank) {
      stepX = x; stepY = y; bestDistance = distance; bestVertical = vertical; bestRank = rank;
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
  const groupPositions = new Map(order.map((index, position) => [groups[index][0].imageGroup || groups[index][0].image, position]));
  const variantAt = (variants, column, row) => variants[hash(column, row, seed ^ 0x7f4a7c15) % variants.length];
  function placement(imageOffset = 0) {
    function itemAt(column, row) {
      if (!count) return null;
      // Coordinate noise breaks repeating tiles; spacing holds across every
      // boundary and negative axis, independently of the order of queries.
      const variation = jitter ? hash(column, row, seed ^ 0x6d2b79f5) & 1 : 0;
      const variants = groups[order[modulo(column * stepX + row * stepY + phase + variation + imageOffset)]];
      return variantAt(variants, column, row);
    }
    return {
      uniqueCount: count,
      itemAt,
      shifted(overrides, random = Math.random) {
        // A cyclic permutation changes every image while preserving all existing
        // spacing, including individual overrides and cells outside the viewport.
        const shift = count > 1 ? 1 + Math.floor(random() * (count - 1)) : 0;
        const nextOverrides = new Map();
        for (const [coordinate, art] of overrides) {
          const [column, row] = coordinate.split(':').map(Number);
          const position = groupPositions.get(art.imageGroup || art.image);
          nextOverrides.set(coordinate, variantAt(groups[order[modulo(position + shift)]], column, row));
        }
        return { field: placement(count ? modulo(imageOffset + shift) : 0), overrides: nextOverrides };
      },
      replacementAt(column, row, overrides, random = Math.random) {
        const excluded = new Set();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const art = overrides.get(`${column + dx}:${row + dy}`) || itemAt(column + dx, row + dy);
          if (art) excluded.add(art.imageGroup || art.image);
        }
        const candidates = groups.filter(group => !excluded.has(group[0].imageGroup || group[0].image));
        if (!candidates.length) return null;
        const variants = candidates[Math.floor(random() * candidates.length)];
        return variants[Math.floor(random() * variants.length)];
      },
    };
  }
  return placement();
}
