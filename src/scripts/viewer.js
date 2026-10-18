import { loadCollection, emptyCollection, safeUrl } from '../lib/collection-store.js';
import { eyePresets, eyeMarkup } from './eyes.js';
import { FIELD_GEOMETRY, fieldAppearance } from './field-layout.js';
import { EyeFieldGL } from './field-gl.js';
import { createRandomField } from './random-field.js';

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
const PAN_DECAY_MS = 325;
const PAN_SAMPLE_MS = 100;

const field = document.getElementById('field');
const tileLayer = document.getElementById('tiles');
const sceneCanvas = document.getElementById('scene');
const gestureHint = document.getElementById('gesture-hint');
const sourceHint = document.getElementById('source-hint');
const viewerStatus = document.getElementById('viewer-status');
const loadingScreen = document.getElementById('loading-screen');
const loadingStartedAt = performance.now();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const embeddedViewer = Boolean(document.getElementById('me-collection'));
const textureRecords = new Map();
const artworkQueue = [];
let artworkJobs = 0;
let loadingReady = false;
let textureSide = 256;
let activeCollection = emptyCollection();
let collectionReady = false;
const fieldSeed = Math.random() * 0x100000000 >>> 0;
let randomField = createRandomField([], fieldSeed);
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
const gaze = { x: 0, y: 0, active: false, centered: false };
const modulo = (value, period) => ((value % period) + period) % period;
const clampValue = (value, low, high) => Math.max(low, Math.min(high, value));

function requestFrame() {
  if (!frameHandle && !document.hidden) frameHandle = requestAnimationFrame(drawFrame);
}

try { fieldRenderer = new EyeFieldGL(sceneCanvas, requestFrame); }
catch { sceneCanvas.hidden = true; }

function dismissLoading() {
  field.removeAttribute('aria-busy');
  if (!loadingScreen || loadingScreen.classList.contains('is-leaving')) return;
  loadingScreen.classList.add('is-leaving');
  const remove = () => loadingScreen.remove();
  loadingScreen.addEventListener('transitionend', event => {
    if (event.target === loadingScreen && event.propertyName === 'opacity') remove();
  });
  setTimeout(remove, 750);
}

function readyToReveal() {
  if (loadingReady) return;
  loadingReady = true;
  if (!loadingScreen) { dismissLoading(); return; }
  loadingScreen.dataset.ready = 'true';
  const eyes = loadingScreen.querySelector('.loader');
  if (!eyes) { dismissLoading(); return; }
  // A cached load needs no ceremonial full blink or extra second of waiting.
  if (performance.now() - loadingStartedAt < 160) {
    loadingScreen.style.setProperty('--fade-duration', '.22s');
    dismissLoading();
    return;
  }
  // Read the actual CSS pose once. The pending animation runs on its own
  // timeline, never on a byte counter or the final all-images-ready boolean.
  const eye = eyes.querySelector('.loader__eye');
  const transform = getComputedStyle(eye, '::after').transform;
  const closed = clampValue(transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42 / 16, 0, 1);
  const duration = Math.max(180, (1 - closed) * 1000 * (reduceMotion.matches ? 1.5 : 1) * 1.15 + 60);
  eyes.style.setProperty('--lid-duration', '0ms');
  eyes.style.setProperty('--lid-transform', transform);
  eyes.style.setProperty('--lid-clip', getComputedStyle(eye, '::before').clipPath);
  eyes.classList.remove('loader--auto');
  getComputedStyle(eye, '::after').transform;
  requestAnimationFrame(() => {
    eyes.style.setProperty('--lid-duration', `${duration}ms`);
    eyes.style.setProperty('--lid-transform', 'translateY(16px)');
    eyes.style.setProperty('--lid-clip', 'inset(19px 0 0)');
    setTimeout(dismissLoading, duration + 80);
  });
}

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
  const width = Math.max(1, field.clientWidth);
  const height = Math.max(1, field.clientHeight);
  if (width === fieldWidth && height === fieldHeight) return;
  fieldWidth = width;
  fieldHeight = height;
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
    if (dragState) {
      const last = dragState.samples[dragState.samples.length - 1];
      dragState.cameraX = camera.x - (last.x - dragState.originX);
      dragState.cameraY = camera.y - (last.y - dragState.originY);
    }
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
    if (cellSize !== previousSize) node.identity = '';
  }
  const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5, Math.sqrt(1200000 / (fieldWidth * fieldHeight)));
  textureSide = Math.min(512, Math.max(128, 2 ** Math.ceil(Math.log2(cellSize * FIELD_ART_FRACTION * dpr * PHOTO_TEXTURE_SCALE))));
  fieldRenderer?.resize(fieldWidth, fieldHeight, dpr);
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
  const side = textureSide;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image preparation is unavailable.');
  const geometry = photoGeometry(art, side, PHOTO_TEXTURE_SCALE);
  context.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
  return canvas;
}

function ensureTexture(key, art) {
  const previous = textureRecords.get(key);
  if (previous?.art === art && previous.side === textureSide) return previous;
  const signature = `${art.width}:${art.height}:${art.eye.x}:${art.eye.y}:${art.eye.r}:${Boolean(art.symbol)}:${textureSide}`;
  if (previous?.source === art.image && previous.signature === signature) { previous.art = art; return previous; }
  const record = { source: art.image, art, side: textureSide, signature, phase: 'queued', dom: !fieldRenderer?.valid };
  textureRecords.set(key, record);
  artworkQueue.push({ key, art, record });
  pumpArtwork();
  return record;
}

function pumpArtwork() {
  // Yield between decodes/uploads so the CSS loader and touch input keep running.
  while (artworkJobs < 2 && artworkQueue.length) {
    const { key, art, record } = artworkQueue.shift();
    if (textureRecords.get(key) !== record) continue;
    artworkJobs++;
    record.phase = 'loading';
    const image = new Image();
    image.decoding = 'async';
    if (/^https?:/i.test(art.image)) image.crossOrigin = 'anonymous';
    const complete = () => {
      image.onload = image.onerror = null;
      artworkJobs--;
      requestFrame();
      setTimeout(pumpArtwork, 0);
    };
    image.onload = () => setTimeout(() => {
      if (textureRecords.get(key) === record) {
        try { record.dom = !fieldRenderer?.valid || !fieldRenderer.setTexture(key, textureImage(image, art)); }
        catch { record.dom = true; }
        record.phase = 'ready';
      }
      complete();
    }, 0);
    image.onerror = () => { record.phase = 'error'; record.dom = true; complete(); };
    image.src = art.image;
  }
}

function bindTile(node, column, row) {
  const identity = `${contentVersion}:${column}:${row}`;
  if (node.identity === identity) return;
  node.identity = identity;
  const art = collectionReady ? randomField.itemAt(column, row) : null;
  const item = activeCollection.items.length > 0 ? art : null;
  const appearance = fieldAppearance(column, row);
  node.art = art;
  node.appearance = appearance;
  node.textureKey = art ? `${item ? 'item' : 'preset'}:${art.id}` : '';
  node.tile.className = 'eye-tile';
  node.gpu = undefined;
  node.imagePosition = '';
  node.tile.dataset.kind = item ? 'item' : art ? 'preset' : 'empty';
  node.tile.dataset.column = String(column);
  node.tile.dataset.row = String(row);
  node.tile.dataset.imageId = art?.id || '';
  node.surface.className = `eye-surface${art && !art.symbol ? ' is-photo' : ''}`;
  const source = safeUrl(art?.sourceUrl);
  node.tile.dataset.linked = String(Boolean(source));
  node.tile.dataset.source = source;
  node.tile.dataset.title = art?.title || '';
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
  if (!art) {
    node.surface.replaceChildren();
    node.content = null;
    node.geometry = null;
    return;
  }
  if (art.symbol) {
    node.surface.innerHTML = eyeMarkup(art.id, appearance.light);
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
      if (item) node.surface.replaceChildren();
      else node.surface.innerHTML = eyeMarkup('sheikah', appearance.light);
      node.content = node.surface.firstElementChild;
      node.geometry = { x: 0, y: 0 };
      node.tile.setAttribute('aria-label', `${art.title || '画像'}（画像を読み込めません）の出典を開く`);
      requestFrame();
    };
    node.surface.replaceChildren(image);
    // The shared artwork job handles decoding. Only the DOM fallback needs src.
  }
}

function drawFrame(time) {
  frameHandle = 0;
  const dt = clampValue(lastFrame ? time - lastFrame : 16.67, 1, 64);
  lastFrame = time;
  let moving = false;
  if (!dragState) {
    const decay = reduceMotion.matches ? 55 : PAN_DECAY_MS;
    const friction = Math.exp(-dt / decay);
    // Integrate the decaying velocity, so missed frames cannot add a large step.
    const travel = decay * (1 - friction);
    camera.x += camera.vx * travel;
    camera.y += camera.vy * travel;
    camera.vx *= friction;
    camera.vy *= friction;
    if (Math.abs(camera.vx) < .002) camera.vx = 0;
    if (Math.abs(camera.vy) < .002) camera.vy = 0;
    moving = camera.vx !== 0 || camera.vy !== 0;
  }
  const firstColumn = Math.floor(-camera.x / cellSize) - poolMargin;
  const firstRow = Math.floor(-camera.y / cellSize) - poolMargin;
  // One compositor transform pans all hit targets. Keep local coordinates near
  // the viewport so an unbounded world never creates an enormous DOM layer.
  tileLayer.style.transform = `translate3d(${(camera.x + firstColumn * cellSize).toFixed(3)}px,${(camera.y + firstRow * cellSize).toFixed(3)}px,0)`;
  const renderTiles = [];
  const gpuAvailable = Boolean(fieldRenderer?.valid);
  sceneCanvas.hidden = !gpuAvailable;
  const neededArtwork = [];

  for (let row = 0; row < poolRows; row++) {
    for (let column = 0; column < poolColumns; column++) {
      const worldColumn = firstColumn + column;
      const worldRow = firstRow + row;
      const node = pool[modulo(worldRow, poolRows) * poolColumns + modulo(worldColumn, poolColumns)];
      const x = camera.x + worldColumn * cellSize;
      const y = camera.y + worldRow * cellSize;
      const previousIdentity = node.identity;
      bindTile(node, worldColumn, worldRow);
      let targetX = 0;
      let targetY = 0;
      let distanceWeight = 0;
      let shiftLimit = maximumShift;
      if (gaze.active) {
        // Use the unchanged grid center, never the moving image or hover target.
        // The frame and its hit area stay aligned with the grid.
        const dx = (gaze.centered ? fieldWidth / 2 : gaze.x) - (x + cellSize / 2);
        const dy = (gaze.centered ? fieldHeight / 2 : gaze.y) - (y + cellSize / 2);
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
      const position = `translate3d(${column * cellSize}px,${row * cellSize}px,0)`;
      if (node.position !== position) { node.position = position; node.tile.style.transform = position; }
      const plane = `translateZ(${depth.toFixed(2)}px)`;
      if (node.plane !== plane) { node.plane = plane; node.tile.style.setProperty('--plane-transform', plane); }
      const visibility = visible || node.tile === document.activeElement ? 'visible' : 'hidden';
      if (node.visibility !== visibility) { node.visibility = visibility; node.tile.style.visibility = visibility; }
      node.tile._screenX = screenX;
      node.tile._screenY = screenY;
      node.tile._screenRadius = boundsRadius;
      node.tile._imageX = node.dx;
      node.tile._imageY = node.dy;
      const record = visible && node.art ? ensureTexture(node.textureKey, node.art) : null;
      if (record) neededArtwork.push(record);
      const textureReady = gpuAvailable && fieldRenderer.hasTexture(node.textureKey);
      if (node.gpu !== textureReady) { node.gpu = textureReady; node.tile.classList.toggle('is-gpu', textureReady); }
      if (textureReady && node.content?.tagName === 'IMG' && node.content.hasAttribute('src')) node.content.removeAttribute('src');
      if (visible && node.content?.tagName === 'IMG' && record && ['ready', 'error'].includes(record.phase) && (!gpuAvailable || record.dom) && node.content.getAttribute('src') !== node.art.image) node.content.src = node.art.image;
      if (!textureReady && node.content && node.geometry && visible) {
        const imagePosition = `translate3d(${(node.geometry.x + node.dx).toFixed(3)}px,${(node.geometry.y + node.dy).toFixed(3)}px,0)`;
        if (node.imagePosition !== imagePosition) { node.imagePosition = imagePosition; node.content.style.transform = imagePosition; }
      }
      // DOM fallback artwork is above the canvas, so its links must be too.
      const order = String((textureReady ? 0 : pool.length) + row * poolColumns + column);
      if (node.order !== order) { node.order = order; node.tile.style.zIndex = order; }
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
  if (collectionReady && neededArtwork.length && neededArtwork.every(record => ['ready', 'error'].includes(record.phase))) readyToReveal();
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
    camera.vx = clampValue(camera.vx - dx / PAN_DECAY_MS, -3.8, 3.8);
    camera.vy = clampValue(camera.vy - dy / PAN_DECAY_MS, -3.8, 3.8);
  }
  updateGaze(event);
  sourceHint.classList.remove('is-visible');
  hideGestureHint();
  requestFrame();
}, { passive: false });

field.addEventListener('pointerdown', event => {
  if (event.button !== 0 || dragState || !event.isPrimary) return;
  // The field owns this gesture; native link focus/scroll must not move it too.
  event.preventDefault();
  const tile = event.target.closest('.eye-tile');
  camera.vx = camera.vy = 0;
  dragState = {
    id: event.pointerId,
    originX: event.clientX, originY: event.clientY,
    cameraX: camera.x, cameraY: camera.y,
    samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
    moved: false,
    source: tile?.dataset.source || '',
  };
  updateGaze(event);
  field.setPointerCapture(event.pointerId);
  requestFrame();
});

function updateGaze(event) {
  // Touch scrolls the eyes past a fixed point on screen, instead of moving
  // that point with the same finger and leaving their relative gaze unchanged.
  gaze.centered = event.pointerType === 'touch';
  gaze.x = event.clientX;
  gaze.y = event.clientY;
  gaze.active = true;
}

window.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  if (event.pointerType === 'mouse' || dragState?.id === event.pointerId) {
    updateGaze(event);
  }
  if (dragState?.id === event.pointerId) {
    const dx = event.clientX - dragState.originX;
    const dy = event.clientY - dragState.originY;
    if (Math.hypot(dx, dy) > 6) dragState.moved = true;
    if (dragState.moved) {
      camera.x = dragState.cameraX + dx;
      camera.y = dragState.cameraY + dy;
      field.classList.add('is-dragging');
      sourceHint.classList.remove('is-visible');
      hideGestureHint();
    }
    const samples = dragState.samples;
    samples.push({ x: event.clientX, y: event.clientY, time: event.timeStamp });
    while (samples.length > 2 && samples[1].time < event.timeStamp - PAN_SAMPLE_MS) samples.shift();
  }
  requestFrame();
});

// Safari must not also hand a swipe to the document/viewport scroller.
field.addEventListener('touchmove', event => { if (event.cancelable) event.preventDefault(); }, { passive: false });

function releasePointer(event, cancelled = false) {
  if (dragState?.id !== event.pointerId) return;
  const ended = dragState;
  dragState = null;
  if (field.hasPointerCapture(event.pointerId)) field.releasePointerCapture(event.pointerId);
  field.classList.remove('is-dragging');
  const last = ended.samples[ended.samples.length - 1];
  let first = ended.samples[0];
  for (const sample of ended.samples) if (sample.time <= event.timeStamp - PAN_SAMPLE_MS) first = sample;
  const elapsed = event.timeStamp - first.time;
  if (!cancelled && ended.moved && elapsed >= 8 && event.timeStamp - last.time < PAN_SAMPLE_MS) {
    camera.vx = clampValue((last.x - first.x) / elapsed, -3.8, 3.8);
    camera.vy = clampValue((last.y - first.y) / elapsed, -3.8, 3.8);
  } else camera.vx = camera.vy = 0;
  // Keep the central gaze during the coast; releasing a finger must not reset it.
  if (cancelled) gaze.active = false;
  if (!cancelled && !ended.moved && ended.source) window.open(ended.source, '_blank', 'noopener,noreferrer');
  requestFrame();
}
window.addEventListener('pointerup', event => releasePointer(event));
window.addEventListener('pointercancel', event => releasePointer(event, true));
field.addEventListener('lostpointercapture', event => releasePointer(event, true));
// Pointer navigation is handled on release; keyboard activation retains native links.
field.addEventListener('click', event => { if (event.detail > 0) event.preventDefault(); });
field.addEventListener('dragstart', event => event.preventDefault());
document.documentElement.addEventListener('pointerleave', event => {
  if (event.pointerType === 'mouse' && !dragState) { gaze.active = false; requestFrame(); }
});
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
    collectionReady = true;
    randomField = createRandomField(loaded.items.length ? loaded.items : eyePresets, fieldSeed);
    const retained = new Set(loaded.items.map(item => `item:${item.id}`));
    for (const key of textureRecords.keys()) {
      if (key.startsWith('item:') && !retained.has(key) || loaded.items.length > 0 && key.startsWith('preset:')) {
        textureRecords.delete(key);
        fieldRenderer?.removeTexture(key);
      }
    }
    contentVersion++;
    viewerStatus.textContent = '';
    requestFrame();
  } catch (error) {
    if (sequence === reloadSequence) { viewerStatus.textContent = error.message || '画像データを読み込めませんでした。'; dismissLoading(); }
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
