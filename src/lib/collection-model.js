const MAX_ITEMS = 256;

export function newId() {
  return globalThis.crypto?.randomUUID?.() || `eye-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

export function emptyCollection() {
  return { version: 1, columns: 8, rows: 8, slots: Array(64).fill(null), items: [] };
}

function validImage(value) {
  if (typeof value !== 'string') return false;
  return /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+$/.test(value) || Boolean(safeUrl(value));
}

export function validateCollection(raw) {
  if (!raw || raw.version !== 1 || raw.columns !== 8 || raw.rows !== 8 || !Array.isArray(raw.items) || !Array.isArray(raw.slots) || raw.slots.length !== 64) {
    throw new Error('対応する目のデータではありません。8 × 8 のデータを指定してください。');
  }
  if (raw.items.length > MAX_ITEMS) throw new Error(`画像は ${MAX_ITEMS} 枚まで登録できます。`);
  const ids = new Set();
  const items = raw.items.map((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 150 || ids.has(entry.id)) throw new Error(`${index + 1} 枚目の画像IDが不正です。`);
    if (!validImage(entry.image) || entry.image.length > 32000000) throw new Error(`${index + 1} 枚目の画像データを読み込めません。`);
    if (![entry.width, entry.height].every(n => Number.isFinite(n) && n > 0 && n <= 50000)) throw new Error(`${index + 1} 枚目の画像サイズが不正です。`);
    if (!entry.eye || !['x', 'y', 'r'].every(key => Number.isFinite(entry.eye[key]))) throw new Error(`${index + 1} 枚目の目の位置が不正です。`);
    if (entry.sourceUrl && !safeUrl(entry.sourceUrl)) throw new Error(`${index + 1} 枚目のリンクは http または https のURLにしてください。`);
    ids.add(entry.id);
    return {
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 200) : '',
      image: safeUrl(entry.image) || entry.image,
      width: entry.width,
      height: entry.height,
      sourceUrl: safeUrl(entry.sourceUrl),
      eye: {
        x: Math.min(.98, Math.max(.02, entry.eye.x)),
        y: Math.min(.98, Math.max(.02, entry.eye.y)),
        r: Math.min(.5, Math.max(.02, entry.eye.r)),
      },
    };
  });
  const slots = raw.slots.map(id => {
    if (id === null) return null;
    if (typeof id !== 'string' || !ids.has(id)) throw new Error('配置データに見つからない画像が含まれています。');
    return id;
  });
  return { version: 1, columns: 8, rows: 8, slots, items };
}
