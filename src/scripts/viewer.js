import { loadCollection, emptyCollection, safeUrl } from '../lib/collection-store.js';
import { eyePattern, eyeMarkup, getEyePreset } from './eyes.js';
import { FIELD_GEOMETRY, fieldAppearance } from './field-layout.js';
import { EyeFieldGL } from './field-gl.js';

const FIELD_ART_FRACTION = FIELD_GEOMETRY.artFraction;
// Keep surrounding source pixels available while a fixed window clips the image.
const PHOTO_TEXTURE_SCALE = 1.5;
// Attraction translates the complete source image inside its stationary clip.
const FIELD_ATTRACTION = Object.freeze({
  clipTravel: .24,
  maximumPixels: 32,
  influenceRadius: .62,
  nearStrength: .78,
  distanceLimit: .32,
  nearResponseMs: 105,
  farResponseMs: 85,
});

const field = document.getElementById('field');
const tileLayer = document.getElementById('tiles');
const sceneCanvas = document.getElementById('scene');
const gestureHint = document.getElementById('gesture-hint');
const sourceHint = document.getElementById('source-hint');
const viewerStatus = document.getElementById('viewer-status');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const embeddedViewer = Boolean(document.getElementById('me-collection'));
const textureRecords = new Map();
let activeCollection = emptyCollection();
let itemLookup = new Map();
let contentVersion = 0;
let pool = [];
let cellSize = 150;
let fieldWidth = 0;
let fieldHeight = 0;
let poolColumns = 0;
let poolRows = 0;
let maximumShift = 0;
let influenceRadius = 1;
const poolMargin = 1;
let frameHandle = 0;
let lastFrame = 0;
let dragState = null;
let hintTimer;
let reloadSequence = 0;
let viewerChannel;
let fieldRenderer = null;
const camera = { x: 0, y: 0, vx: 0, vy: 0, initialized: false };
const gaze = { x: 0, y: 0, active: false };
const modulo = (value, period) => ((value % period) + period) % period;
const clampValue = (value, low, high) => Math.max(low, Math.min(high, value));

function requestFrame() {
  if (!frameHandle && !document.hidden) frameHandle = requestAnimationFrame(drawFrame);
}

try { fieldRenderer = new EyeFieldGL(sceneCanvas, requestFrame); }
catch { sceneCanvas.hidden = true; }

function hideGestureHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => gestureHint.classList.add('is-hidden'), 1400);
}

function showSource(tile) {
  const source = tile?.dataset.source;
  if (!source || dragState?.moved) { sourceHint.classList.remove('is-visible'); return; }
  const host = new URL(source).hostname.replace(/^www\./, '');
  sourceHint.textContent = `${tile.dataset.title ? `${tile.dataset.title} · ` : ''}${host} ↗`;
  sourceHint.classList.add('is-visible');
  gestureHint.classList.add('is-hidden');
}

function resizeField() {
  const previousSize = cellSize;
  fieldWidth = Math.max(1, field.clientWidth);
  fieldHeight = Math.max(1, field.clientHeight);
  const visibleColumns = fieldWidth < 600 ? 4.2 : fieldWidth < 1000 ? 6.4 : 9.4;
  const referenceCellSize = Math.round(clampValue(fieldWidth / visibleColumns, 80, 180));
  // Keep image size and grid pitch at the original scale.
  cellSize = Math.round(referenceCellSize * FIELD_GEOMETRY.imageScale * FIELD_GEOMETRY.previousArtFraction / FIELD_ART_FRACTION);
  const shortViewport = Math.min(fieldWidth, fieldHeight);
  maximumShift = Math.min(cellSize * FIELD_ART_FRACTION * FIELD_ATTRACTION.clipTravel, FIELD_ATTRACTION.maximumPixels);
  influenceRadius = Math.max(1, shortViewport * FIELD_ATTRACTION.influenceRadius);
  tileLayer.style.setProperty('--eye-inset', `${((1 - FIELD_ART_FRACTION) * 50).toFixed(3)}%`);
  tileLayer.style.setProperty('--eye-focal', `${Math.max(fieldWidth, fieldHeight) * 1.7}px`);
  if (camera.initialized) {
    camera.x *= cellSize / previousSize;
    camera.y *= cellSize / previousSize;
  } else {
    camera.x = -cellSize * .29;
    camera.y = -cellSize * .34;
    camera.initialized = true;
  }
  poolColumns = Math.ceil(fieldWidth / cellSize) + poolMargin * 2 + 1;
  poolRows = Math.ceil(fieldHeight / cellSize) + poolMargin * 2 + 1;
  const count = poolColumns * poolRows;
  while (pool.length < count) {
    const tile = document.createElement('a');
    tile.className = 'eye-tile';
    tile.draggable = false;
    tile.tabIndex = -1;
    const surface = document.createElement('div');
    surface.className = 'eye-surface';
    const hit = document.createElement('span');
    hit.className = 'eye-hit';
    hit.setAttribute('aria-hidden', 'true');
    tile.append(surface, hit);
    tile.addEventListener('pointerenter', () => showSource(tile));
    tile.addEventListener('pointerleave', () => sourceHint.classList.remove('is-visible'));
    tile.addEventListener('focus', () => {
      showSource(tile);
      const cx = tile._screenX + cellSize / 2;
      const cy = tile._screenY + cellSize / 2;
      const radius = tile._screenRadius || cellSize / 2;
      if (!dragState && tile.matches(':focus-visible') && (cx - radius < 0 || cx + radius > fieldWidth || cy - radius < 0 || cy + radius > fieldHeight)) {
        camera.x += fieldWidth / 2 - cx;
        camera.y += fieldHeight / 2 - cy;
        camera.vx = camera.vy = 0;
      }
      requestFrame();
    });
    tile.addEventListener('blur', () => sourceHint.classList.remove('is-visible'));
    tileLayer.append(tile);
    pool.push({ tile, surface, content: null, geometry: null, identity: '', dx: 0, dy: 0, art: null, textureKey: '' });
  }
  while (pool.length > count) pool.pop().tile.remove();
  for (const node of pool) {
    node.tile.style.width = `${cellSize}px`;
    node.tile.style.height = `${cellSize}px`;
    node.identity = '';
  }
  fieldRenderer?.resize(fieldWidth, fieldHeight, Math.min(window.devicePixelRatio || 1, 1.75));
  requestFrame();
}

function cropSide(art) {
  return art.eye.r * Math.min(art.width, art.height) / .26;
}

function photoGeometry(art, side, cropScale = 1) {
  const scale = side / (cropSide(art) * cropScale);
  return {
    width: art.width * scale,
    height: art.height * scale,
    x: side / 2 - art.eye.x * art.width * scale,
    y: side / 2 - art.eye.y * art.height * scale,
  };
}

// A padded square retains the source background beyond the visible crop.
// The fixed window samples its center and can pan without exposing a baked edge.
// Source pixels only translate and uniformly scale; they never deform.
function textureImage(image, art) {
  if (art.symbol) return image;
  const side = Math.min(1024, Math.max(192, Math.ceil(cropSide(art) * PHOTO_TEXTURE_SCALE)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image preparation is unavailable.');
  const geometry = photoGeometry(art, side, PHOTO_TEXTURE_SCALE);
  context.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
  return canvas;
}

function ensureTexture(key, art) {
  if (!fieldRenderer) return;
  const signature = `${art.width}:${art.height}:${art.eye.x}:${art.eye.y}:${art.eye.r}:${Boolean(art.symbol)}`;
  const previous = textureRecords.get(key);
  if (previous?.source === art.image && previous.signature === signature) return;
  fieldRenderer.removeTexture(key);
  const record = { source: art.image, signature };
  textureRecords.set(key, record);
  const image = new Image();
  image.decoding = 'async';
  if (/^https?:/i.test(art.image)) image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (textureRecords.get(key) !== record) return;
    try { fieldRenderer.setTexture(key, textureImage(image, art)); }
    catch { /* The unmodified DOM image remains available when CORS blocks GL. */ }
    requestFrame();
  };
  image.onerror = requestFrame;
  image.src = art.image;
}

function bindTile(node, slot) {
  const identity = `${contentVersion}:${slot}`;
  if (node.identity === identity) return;
  node.identity = identity;
  const item = itemLookup.get(activeCollection.slots[slot]);
  const presetKind = eyePattern[slot];
  const art = item || getEyePreset(presetKind);
  const appearance = fieldAppearance(slot);
  node.art = art;
  node.appearance = appearance;
  node.textureKey = `${item ? 'item' : 'preset'}:${art.id}`;
  node.tile.className = 'eye-tile';
  node.surface.className = `eye-surface${art.symbol ? '' : ' is-photo'}`;
  const source = safeUrl(art.sourceUrl);
  node.tile.dataset.linked = String(Boolean(source));
  node.tile.dataset.source = source;
  node.tile.dataset.title = art.title || '';
  if (source) {
    node.tile.href = source;
    node.tile.target = '_blank';
    node.tile.rel = 'noopener noreferrer';
    node.tile.tabIndex = 0;
    node.tile.removeAttribute('aria-hidden');
    node.tile.setAttribute('aria-label', `${art.title || '画像'}の出典を開く`);
  } else {
    node.tile.removeAttribute('href');
    node.tile.removeAttribute('target');
    node.tile.removeAttribute('rel');
    node.tile.tabIndex = -1;
    node.tile.setAttribute('aria-hidden', 'true');
    node.tile.removeAttribute('aria-label');
  }
  if (art.symbol) {
    node.surface.innerHTML = eyeMarkup(presetKind, appearance.light);
    node.content = node.surface.firstElementChild;
    node.geometry = { x: 0, y: 0 };
  } else {
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    const geometry = photoGeometry(art, cellSize * FIELD_ART_FRACTION);
    node.content = image;
    node.geometry = geometry;
    image.style.width = `${geometry.width}px`;
    image.style.height = `${geometry.height}px`;
    image.style.transform = `translate3d(${geometry.x}px,${geometry.y}px,0)`;
    image.onerror = () => {
      if (node.identity !== identity) return;
      node.surface.classList.remove('is-photo');
      node.surface.innerHTML = eyeMarkup('sheikah', appearance.light);
      node.content = node.surface.firstElementChild;
      node.geometry = { x: 0, y: 0 };
      node.tile.setAttribute('aria-label', `${art.title || '画像'}（画像を読み込めません）の出典を開く`);
      requestFrame();
    };
    node.surface.replaceChildren(image);
    image.src = art.image;
  }
  ensureTexture(node.textureKey, art);
}

function drawFrame(time) {
  frameHandle = 0;
  const dt = clampValue(lastFrame ? time - lastFrame : 16.67, 1, 32);
  lastFrame = time;
  let moving = false;
  if (!dragState) {
    camera.x += camera.vx * dt;
    camera.y += camera.vy * dt;
    const friction = Math.exp(-dt / (reduceMotion.matches ? 55 : 205));
    camera.vx *= friction;
    camera.vy *= friction;
    if (Math.abs(camera.vx) < .002) camera.vx = 0;
    if (Math.abs(camera.vy) < .002) camera.vy = 0;
    moving = camera.vx !== 0 || camera.vy !== 0;
  }
  // Multiples of both the content and node-pool periods preserve continuity.
  const periodX = activeCollection.columns * poolColumns * cellSize;
  const periodY = activeCollection.rows * poolRows * cellSize;
  if (Math.abs(camera.x) > periodX * 2) camera.x = modulo(camera.x, periodX);
  if (Math.abs(camera.y) > periodY * 2) camera.y = modulo(camera.y, periodY);
  const firstColumn = Math.floor(-camera.x / cellSize) - poolMargin;
  const firstRow = Math.floor(-camera.y / cellSize) - poolMargin;
  const renderTiles = [];
  const gpuAvailable = Boolean(fieldRenderer?.valid);
  sceneCanvas.hidden = !gpuAvailable;

  for (let row = 0; row < poolRows; row++) {
    for (let column = 0; column < poolColumns; column++) {
      const worldColumn = firstColumn + column;
      const worldRow = firstRow + row;
      const node = pool[modulo(worldRow, poolRows) * poolColumns + modulo(worldColumn, poolColumns)];
      const x = camera.x + worldColumn * cellSize;
      const y = camera.y + worldRow * cellSize;
      const localColumn = modulo(worldColumn, activeCollection.columns);
      const localRow = modulo(worldRow, activeCollection.rows);
      const slot = localRow * activeCollection.columns + localColumn;
      const previousIdentity = node.identity;
      bindTile(node, slot);
      let targetX = 0;
      let targetY = 0;
      let distanceWeight = 0;
      let shiftLimit = maximumShift;
      if (gaze.active && !reduceMotion.matches) {
        // Use the unchanged grid center, never the moving image or hover target.
        // The frame and its hit area stay aligned with the grid.
        const dx = gaze.x - (x + cellSize / 2);
        const dy = gaze.y - (y + cellSize / 2);
        const distance = Math.hypot(dx, dy);
        // Increase attraction smoothly with distance, without exceeding the clip.
        distanceWeight = 1 - Math.exp(-.5 * (distance / influenceRadius) ** 2);
        const strength = FIELD_ATTRACTION.nearStrength + (1 - FIELD_ATTRACTION.nearStrength) * distanceWeight;
        shiftLimit = Math.min(maximumShift, distance * FIELD_ATTRACTION.distanceLimit);
        const amplitude = Math.min(maximumShift * strength, shiftLimit);
        targetX = dx / Math.max(distance, 1) * amplitude;
        targetY = dy / Math.max(distance, 1) * amplitude;
      }
      const responseMs = FIELD_ATTRACTION.nearResponseMs + distanceWeight * (FIELD_ATTRACTION.farResponseMs - FIELD_ATTRACTION.nearResponseMs);
      const ease = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / responseMs);
      if (node.identity !== previousIdentity) {
        node.dx = targetX; node.dy = targetY;
      } else {
        node.dx += (targetX - node.dx) * ease;
        node.dy += (targetY - node.dy) * ease;
      }
      // Bound the interpolated image position as the pointer approaches its eye.
      const displacement = Math.hypot(node.dx, node.dy);
      if (displacement > shiftLimit) {
        node.dx *= shiftLimit / displacement;
        node.dy *= shiftLimit / displacement;
      }
      if (Math.abs(targetX - node.dx) > .015 || Math.abs(targetY - node.dy) > .015) moving = true;
      const depth = reduceMotion.matches ? 0 : node.appearance.depth;
      const screenX = x;
      const screenY = y;
      const centerX = screenX + cellSize / 2;
      const centerY = screenY + cellSize / 2;
      const boundsRadius = cellSize * .5 + Math.abs(depth) + 8;
      const visible = centerX + boundsRadius > 0 && centerY + boundsRadius > 0 && centerX - boundsRadius < fieldWidth && centerY - boundsRadius < fieldHeight;
      node.tile.style.transform = `translate3d(${screenX.toFixed(3)}px,${screenY.toFixed(3)}px,0)`;
      node.tile.style.setProperty('--plane-transform', `translateZ(${depth.toFixed(2)}px)`);
      if (node.content && node.geometry) {
        node.content.style.transform = `translate3d(${(node.geometry.x + node.dx).toFixed(3)}px,${(node.geometry.y + node.dy).toFixed(3)}px,0)`;
      }
      node.tile.style.visibility = visible || node.tile === document.activeElement ? 'visible' : 'hidden';
      node.tile._screenX = screenX;
      node.tile._screenY = screenY;
      node.tile._screenRadius = boundsRadius;
      const textureReady = gpuAvailable && fieldRenderer.hasTexture(node.textureKey);
      node.tile.classList.toggle('is-gpu', textureReady);
      // DOM fallback artwork is above the canvas, so its links must be too.
      node.tile.style.zIndex = String((textureReady ? 0 : pool.length) + row * poolColumns + column);
      if (textureReady && visible) {
        renderTiles.push({
          x, y, size: cellSize, textureKey: node.textureKey,
          imageX: node.dx, imageY: node.dy, tiltX: 0, tiltY: 0, boundsRadius,
          ...node.appearance, depth,
          crop: node.art.symbol ? [.5, .5, 1, 1] : [.5, .5, 1 / PHOTO_TEXTURE_SCALE, 1 / PHOTO_TEXTURE_SCALE],
          symbol: Boolean(node.art.symbol),
        });
      }
    }
  }
  if (gpuAvailable) fieldRenderer.render(renderTiles, {
    width: fieldWidth, height: fieldHeight,
    panX: camera.x, panY: camera.y,
    time, reduceMotion: reduceMotion.matches,
  });
  if (moving) requestFrame();
  else lastFrame = 0;
}

field.addEventListener('wheel', event => {
  if (event.ctrlKey || dragState) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? fieldHeight : 1;
  let dx = event.deltaX * unit;
  let dy = event.deltaY * unit;
  if (event.shiftKey && Math.abs(dx) < .5) { dx = dy; dy = 0; }
  if (reduceMotion.matches) {
    camera.x -= dx; camera.y -= dy;
    camera.vx = camera.vy = 0;
  } else {
    camera.vx = clampValue(camera.vx - dx / 205, -3.8, 3.8);
    camera.vy = clampValue(camera.vy - dy / 205, -3.8, 3.8);
  }
  gaze.x = event.clientX; gaze.y = event.clientY; gaze.active = true;
  sourceHint.classList.remove('is-visible');
  hideGestureHint();
  requestFrame();
}, { passive: false });

field.addEventListener('pointerdown', event => {
  if (event.button !== 0 || dragState || !event.isPrimary) return;
  const tile = event.target.closest('.eye-tile');
  camera.vx = camera.vy = 0;
  dragState = {
    id: event.pointerId,
    x: event.clientX, y: event.clientY,
    originX: event.clientX, originY: event.clientY,
    time: performance.now(), moved: false,
    source: tile?.dataset.source || '',
  };
  gaze.x = event.clientX; gaze.y = event.clientY; gaze.active = true;
  field.setPointerCapture(event.pointerId);
  requestFrame();
});

window.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  if (event.pointerType === 'mouse' || dragState?.id === event.pointerId) {
    gaze.x = event.clientX; gaze.y = event.clientY; gaze.active = true;
  }
  if (dragState?.id === event.pointerId) {
    const now = performance.now();
    const dt = clampValue(now - dragState.time, 4, 80);
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    if (Math.hypot(event.clientX - dragState.originX, event.clientY - dragState.originY) > 6) dragState.moved = true;
    if (dragState.moved) {
      camera.x += dx; camera.y += dy;
      camera.vx = camera.vx * .35 + clampValue(dx / dt, -4, 4) * .65;
      camera.vy = camera.vy * .35 + clampValue(dy / dt, -4, 4) * .65;
      field.classList.add('is-dragging');
      sourceHint.classList.remove('is-visible');
      hideGestureHint();
    }
    dragState.x = event.clientX; dragState.y = event.clientY; dragState.time = now;
  }
  requestFrame();
});

function releasePointer(event, cancelled = false) {
  if (dragState?.id !== event.pointerId) return;
  const ended = dragState;
  dragState = null;
  if (field.hasPointerCapture(event.pointerId)) field.releasePointerCapture(event.pointerId);
  field.classList.remove('is-dragging');
  if (cancelled || !ended.moved || performance.now() - ended.time > 100 || reduceMotion.matches) camera.vx = camera.vy = 0;
  if (event.pointerType !== 'mouse') gaze.active = false;
  if (!cancelled && !ended.moved && ended.source) window.open(ended.source, '_blank', 'noopener,noreferrer');
  requestFrame();
}
window.addEventListener('pointerup', event => releasePointer(event));
window.addEventListener('pointercancel', event => releasePointer(event, true));
field.addEventListener('lostpointercapture', event => releasePointer(event, true));
// Pointer navigation is handled on release; keyboard activation retains native links.
field.addEventListener('click', event => { if (event.detail > 0) event.preventDefault(); });
field.addEventListener('dragstart', event => event.preventDefault());
document.documentElement.addEventListener('pointerleave', () => { gaze.active = false; requestFrame(); });
window.addEventListener('blur', () => {
  gaze.active = false;
  dragState = null;
  camera.vx = camera.vy = 0;
  field.classList.remove('is-dragging');
  requestFrame();
});

field.addEventListener('keydown', event => {
  const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], PageUp: [0, 3], PageDown: [0, -3] };
  const direction = directions[event.key];
  if (direction) {
    event.preventDefault();
    if (reduceMotion.matches) { camera.x += direction[0] * cellSize; camera.y += direction[1] * cellSize; }
    else { camera.vx = clampValue(camera.vx + direction[0] * .8, -4, 4); camera.vy = clampValue(camera.vy + direction[1] * .8, -4, 4); }
    hideGestureHint(); requestFrame();
  }
  if (event.key === 'Escape') { camera.vx = camera.vy = 0; gaze.active = false; requestFrame(); }
});

async function refreshCollection() {
  const sequence = ++reloadSequence;
  try {
    const loaded = await loadCollection();
    if (sequence !== reloadSequence) return;
    activeCollection = loaded;
    itemLookup = new Map(loaded.items.map(item => [item.id, item]));
    const retained = new Set(loaded.slots.filter(Boolean).map(id => `item:${id}`));
    for (const key of textureRecords.keys()) {
      if (key.startsWith('item:') && !retained.has(key)) {
        textureRecords.delete(key);
        fieldRenderer?.removeTexture(key);
      }
    }
    contentVersion++;
    viewerStatus.textContent = '';
    requestFrame();
  } catch (error) {
    if (sequence === reloadSequence) viewerStatus.textContent = error.message || '画像データを読み込めませんでした。';
  }
}


window.addEventListener('resize', resizeField);
window.addEventListener('focus', () => { refreshCollection(); });
window.addEventListener('me:collection', refreshCollection);
window.addEventListener('storage', event => { if (event.key === 'me-eye-grid-saved') refreshCollection(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frameHandle); frameHandle = 0; lastFrame = 0; camera.vx = camera.vy = 0; }
  else { refreshCollection(); requestFrame(); }
});
reduceMotion.addEventListener('change', requestFrame);
if (!embeddedViewer) {
  try {
    viewerChannel = new BroadcastChannel('me-eye-grid-updates');
    viewerChannel.onmessage = event => { if (event.data?.type === 'saved') refreshCollection(); };
  } catch {}
}
resizeField();
refreshCollection();
