/** Stable random placement on an unbounded plane; chunks are caches, not repeating tiles. */
export function createRandomField(items, seed = Math.random() * 0x100000000 >>> 0) {
  const grouped = new Map();
  for (const item of items) {
    const identity = item.imageGroup || item.image;
    if (!grouped.has(identity)) grouped.set(identity, []);
    grouped.get(identity).push(item);
  }
  const groups = [...grouped.values()];
  const chunkSize = Math.max(12, Math.ceil(Math.sqrt(groups.length * 4)));
  const chunks = new Map();
  const hash = (x, y, salt = seed) => {
    let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ salt;
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return (value ^ value >>> 16) >>> 0;
  };
  const makeChunk = (column, row) => {
    let state = hash(column, row);
    const random = () => {
      state = state + 0x6d2b79f5 | 0;
      let value = Math.imul(state ^ state >>> 15, state | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 0x100000000;
    };
    const cells = new Uint16Array(chunkSize * chunkSize).fill(65535);
    let remaining = [];
    for (let index = 0; index < cells.length; index++) {
      if (!remaining.length) {
        remaining = groups.map((_, index) => index);
        for (let end = remaining.length - 1; end > 0; end--) {
          const other = Math.floor(random() * (end + 1));
          [remaining[end], remaining[other]] = [remaining[other], remaining[end]];
        }
      }
      const x = index % chunkSize, y = Math.floor(index / chunkSize);
      const neighbors = [[-1, 0, 100], [0, -1, 100], [-1, -1, 30], [1, -1, 30], [-2, 0, 8], [0, -2, 8]]
        .filter(([dx, dy]) => x + dx >= 0 && x + dx < chunkSize && y + dy >= 0)
        .map(([dx, dy, weight]) => [cells[(y + dy) * chunkSize + x + dx], weight]);
      let best = 0, bestScore = Infinity;
      for (let candidate = 0; candidate < remaining.length; candidate++) {
        const score = neighbors.reduce((sum, [neighbor, weight]) => sum + (neighbor === remaining[candidate] ? weight : 0), 0);
        if (score < bestScore) { best = candidate; bestScore = score; }
        if (score === 0) break;
      }
      cells[index] = remaining.splice(best, 1)[0];
    }
    return cells;
  };

  return {
    uniqueCount: groups.length,
    chunkSize,
    itemAt(column, row) {
      if (!groups.length) return null;
      const chunkColumn = Math.floor(column / chunkSize), chunkRow = Math.floor(row / chunkSize);
      const key = `${chunkColumn}:${chunkRow}`;
      let cells = chunks.get(key);
      if (!cells) cells = makeChunk(chunkColumn, chunkRow);
      chunks.delete(key);
      chunks.set(key, cells);
      if (chunks.size > 64) chunks.delete(chunks.keys().next().value);
      const x = column - chunkColumn * chunkSize, y = row - chunkRow * chunkSize;
      const variants = groups[cells[y * chunkSize + x]];
      // Different crops of one source remain available without increasing its frequency.
      return variants[hash(column, row, seed ^ 0x7f4a7c15) % variants.length];
    },
  };
}
