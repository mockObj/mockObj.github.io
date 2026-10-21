import { loadCollection, emptyCollection, safeUrl } from '../lib/collection-store.js';
import { eyePresets, eyeMarkup } from './eyes.js';
import { FIELD_GEOMETRY, fieldAppearance } from './field-layout.js';
import { EyeFieldGL } from './field-gl.js';
import { createRandomField } from './random-field.js';
import { createLoadingScreen } from './loading-screen.js';
import { VIEWER_SETTINGS, GLANCE_DURATION_MS } from './viewer-settings.js';

const FIELD_ART_FRACTION = FIELD_GEOMETRY.artFraction;
// Keep surrounding source pixels available while a fixed window clips the image.
const PHOTO_TEXTURE_SCALE = VIEWER_SETTINGS.geometry.textureScale;
const PHOTO_CROP = [.5, .5, 1 / PHOTO_TEXTURE_SCALE, 1 / PHOTO_TEXTURE_SCALE];
const SYMBOL_CROP = [.5, .5, 1, 1];
// Attraction translates the complete source image inside its stationary clip.
const FIELD_ATTRACTION = VIEWER_SETTINGS.attraction;
const PAN_DECAY_MS = VIEWER_SETTINGS.pan.decayMs;
const PAN_SAMPLE_MS = VIEWER_SETTINGS.pan.sampleMs;
// One lottery for the entire field, independent of the number of visible eyes.
const FIELD_IDLE = VIEWER_SETTINGS.idle;

const field = document.getElementById('field');
const tileLayer = document.getElementById('tiles');
const sceneCanvas = document.getElementById('scene');
const gestureHint = document.getElementById('gesture-hint');
const sourceHint = document.getElementById('source-hint');
const viewerStatus = document.getElementById('viewer-status');
const loadingScreen = document.getElementById('loading-screen');
const debugPanel = document.getElementById('field-debug');
const debugStatus = document.getElementById('field-debug-status');
const viewerLoading = createLoadingScreen(loadingScreen, { onDismiss: () => field.removeAttribute('aria-busy') });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const touchPointer = window.matchMedia('(pointer: coarse)');
const embeddedViewer = Boolean(document.getElementById('me-collection'));
const textureRecords = new Map();
const artworkQueue = [];
let artworkJobs = 0;
let textureSide = 256;
let activeCollection = emptyCollection();
let collectionReady = false;
const fieldSeed = Math.random() * 0x100000000 >>> 0;
let randomField = createRandomField([], fieldSeed);
let contentVersion = 0;
let pool = [];
let cellSize = 150;
let pitchX = 150;
let pitchY = 150;
let fieldWidth = 0;
let fieldHeight = 0;
let fieldLeft = 0;
let fieldTop = 0;
let viewportDirty = true;
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
const gaze = { x: 0, y: 0, active: touchPointer.matches, centered: touchPointer.matches };
let artworkOverrides = new Map();
const idleStartedAt = performance.now();
const idleEligibleAt = idleStartedAt + FIELD_IDLE.startDelayMs;
const allBlinkEligibleAt = idleStartedAt + FIELD_IDLE.allBlinkStartDelayMs;
let idleTimer = 0;
let idleLotteryPending = false;
let idleEffect = null;
let debugEffectRequest = '';
const modulo = (value, period) => ((value % period) + period) % period;
const clampValue = (value, low, high) => Math.max(low, Math.min(high, value));

function requestFrame() {
  if (!frameHandle && !document.hidden) frameHandle = requestAnimationFrame(drawFrame);
}

function resetGaze() {
  gaze.active = gaze.centered = touchPointer.matches;
}

function endIdleEffect() {
  const effect = idleEffect;
  idleEffect = null;
  if (!effect) return;
  // A started blink commits its new artwork even when scrolling recycles the
  // DOM tile before the closed pose. The original world cell keeps the result.
  if (effect.type !== 'glance' && effect.start !== null && !effect.swapped) swapIdleArtwork(effect);
  for (const overlay of effect.overlays.values()) overlay.remove();
  if (effect.node) delete effect.node.tile.dataset.idleEffect;
  delete field.dataset.idleEffect;
}

function swapIdleArtwork(effect) {
  if (effect.type === 'all-blink') {
    randomField = effect.nextField;
    artworkOverrides = effect.nextOverrides;
    contentVersion++;
    effect.swapped = true;
    sourceHint.classList.remove('is-visible');
    return;
  }
  artworkOverrides.set(`${effect.column}:${effect.row}`, effect.replacement);
  effect.swapped = true;
  if (effect.node.identity === effect.identity) {
    effect.node.identity = '';
    bindTile(effect.node, effect.column, effect.row);
    effect.identity = effect.node.identity;
  }
  sourceHint.classList.remove('is-visible');
}

function idleMotionSuppressed() {
  return reduceMotion.matches && !FIELD_IDLE.allowWithReducedMotion;
}

function attachBlinkOverlays(effect, nodes) {
  const added = [];
  for (const node of nodes) {
    if (effect.overlays.has(node)) continue;
    const overlay = document.createElement('span');
    overlay.className = 'loading-blink eye-blink';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<span class="loading-blink__upper"></span><span class="loading-blink__lower"></span>';
    node.tile.append(overlay);
    effect.overlays.set(node, overlay);
    added.push(overlay);
  }
  // Batch DOM writes before reading animation timings. Every lid uses the same
  // clock, including tiles added by a resize or recycled during a swipe.
  for (const overlay of added) effect.animations.push(...overlay.getAnimations({ subtree: true }));
  effect.duration = Number(effect.animations[0].effect.getComputedTiming().duration);
}

function startAllBlink(requested) {
  const shifted = randomField.shifted(artworkOverrides);
  idleEffect = { type: 'all-blink', nextField: shifted.field, nextOverrides: shifted.overrides,
    start: null, swapped: false, overlays: new Map(), animations: [], duration: 0, debug: requested };
  field.dataset.idleEffect = 'all-blink';
  if (requested) debugStatus.textContent = '全ての目：同時まばたき・画像交換';
  requestFrame();
}

function scheduleIdleLottery() {
  clearTimeout(idleTimer);
  const paused = idleMotionSuppressed();
  if (debugPanel && debugPanel.dataset.idlePaused !== String(paused)) {
    debugPanel.dataset.idlePaused = String(paused);
    debugStatus.textContent = paused
      ? 'OSの「動きを減らす」により自動演出を停止中です。ボタンでの確認は可能です。'
      : `A/Bは中央に近い${FIELD_IDLE.protectedCenterCount}枚を除外。全体まばたきは全ての目で、待ち時間なしで確認します。`;
  }
  if (document.hidden || paused) return;
  idleTimer = setTimeout(() => {
    idleLotteryPending = true;
    requestFrame();
    scheduleIdleLottery();
  }, Math.max(FIELD_IDLE.checkIntervalMs, Math.min(idleEligibleAt, allBlinkEligibleAt) - performance.now()));
}

function drawIdleLottery(time) {
  if (!idleLotteryPending && !debugEffectRequest) return;
  idleLotteryPending = false;
  // Keep the complete center/hold/return motion intact. A debug request waits
  // for its final frame and then uses the same serial path as automatic effects.
  if (debugEffectRequest && idleEffect?.type === 'glance') return;
  const requested = debugEffectRequest;
  debugEffectRequest = '';
  if (requested) endIdleEffect();
  if (idleEffect || !collectionReady || loadingScreen?.isConnected || (!requested && idleMotionSuppressed())) return;
  // One timer and one active effect. On the same draw, the all-eye blink takes
  // priority over A/B; a running effect finishes before the next lottery.
  if (requested === 'all-blink' || (!requested && time >= allBlinkEligibleAt
      && Math.random() < FIELD_IDLE.checkIntervalMs / FIELD_IDLE.allBlinkMeanIntervalMs)) {
    startAllBlink(Boolean(requested));
    return;
  }
  if (!requested && (time < idleEligibleAt || Math.random() >= FIELD_IDLE.checkIntervalMs / FIELD_IDLE.meanIntervalMs)) return;
  const focal = Math.max(fieldWidth, fieldHeight) * 1.7;
  const occluded = debugPanel?.open ? debugPanel.getBoundingClientRect() : null;
  const visibleEyes = [];
  for (const node of pool) {
    if (!node.art || node.visibility !== 'visible') continue;
    const x = node.tile._screenX + cellSize / 2;
    const y = node.tile._screenY + cellSize / 2;
    const depth = reduceMotion.matches ? 0 : node.appearance.depth;
    const radius = cellSize * FIELD_ART_FRACTION * .5 * focal / (focal - depth);
    const left = Math.max(0, x - radius), right = Math.min(fieldWidth, x + radius);
    const top = Math.max(0, y - radius), bottom = Math.min(fieldHeight, y + radius);
    // Use the visible artwork frame, including partly clipped mobile edge eyes.
    if (right <= left || bottom <= top) continue;
    visibleEyes.push({ node, left, right, top, bottom, distance: (x - fieldWidth / 2) ** 2 + (y - fieldHeight / 2) ** 2 });
  }
  // Recompute from the live camera at each draw, including during touch inertia.
  visibleEyes.sort((a, b) => a.distance - b.distance || a.node.row - b.node.row || a.node.column - b.node.column);
  const candidates = visibleEyes.slice(FIELD_IDLE.protectedCenterCount).filter(({ left, right, top, bottom }) =>
    !occluded || right + fieldLeft <= occluded.left || left + fieldLeft >= occluded.right
      || bottom + fieldTop <= occluded.top || top + fieldTop >= occluded.bottom);
  if (!candidates.length) return;
  const { node } = candidates[Math.floor(Math.random() * candidates.length)];
  const blink = requested ? requested === 'blink' : Math.random() < FIELD_IDLE.blinkProbability;
  let replacement = null;
  if (blink) {
    replacement = randomField.replacementAt(Number(node.tile.dataset.column), Number(node.tile.dataset.row), artworkOverrides);
    if (requested && !replacement) { debugStatus.textContent = '周囲8マスと重複しない交換先がありません。'; return; }
    if (replacement) ensureTexture(`${activeCollection.items.length ? 'item' : 'preset'}:${replacement.id}`, replacement);
  }
  const type = replacement ? 'blink' : 'glance';
  idleEffect = { node, column: node.column, row: node.row, identity: node.identity, type, replacement, start: replacement ? null : time, swapped: false, overlays: new Map(), animations: [], duration: GLANCE_DURATION_MS, debug: Boolean(requested) };
  node.tile.dataset.idleEffect = idleEffect.type;
  if (requested) debugStatus.textContent = `${node.tile.dataset.title || '目'}：${type === 'blink' ? '個別まばたき・画像交換' : '視線を戻す'}`;
  requestFrame();
}

function updateIdleEffect(time) {
  const effect = idleEffect;
  if (!effect) return;
  if ((effect.node && (effect.node.identity !== effect.identity || !effect.node.tile.isConnected))
      || (idleMotionSuppressed() && !effect.debug)) { endIdleEffect(); return; }
  if (effect.type !== 'glance' && effect.start === null) {
    const nodes = effect.type === 'all-blink' ? pool : [effect.node];
    let ready = true;
    for (const node of nodes) {
      const art = effect.type === 'all-blink'
        ? effect.nextOverrides.get(`${node.column}:${node.row}`) || effect.nextField.itemAt(node.column, node.row)
        : effect.replacement;
      const record = ensureTexture(`${activeCollection.items.length ? 'item' : 'preset'}:${art.id}`, art);
      if (record.phase === 'error') { endIdleEffect(); return; }
      if (record.phase !== 'ready') ready = false;
    }
    if (!ready) return;
    attachBlinkOverlays(effect, nodes);
    effect.start = time;
  }
  let elapsed = time - effect.start;
  const swapAt = effect.duration * VIEWER_SETTINGS.blink.swapAt;
  if (effect.type !== 'glance' && !effect.swapped && elapsed >= swapAt) {
    // A missed frame must still show a fully closed pose during the swap.
    effect.start += elapsed - swapAt;
    elapsed = swapAt;
    swapIdleArtwork(effect);
  }
  for (const animation of effect.animations) animation.currentTime = Math.min(elapsed, effect.duration);
  if (elapsed >= effect.duration) endIdleEffect();
}

try { fieldRenderer = new EyeFieldGL(sceneCanvas, requestFrame); }
catch { sceneCanvas.hidden = true; }

function dismissLoading() {
  viewerLoading.dismiss();
}

function readyToReveal() {
  viewerLoading.finish();
}

function hideGestureHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => gestureHint.classList.add('is-hidden'), VIEWER_SETTINGS.pan.hintDelayMs);
}

function showSource(tile) {
  const source = tile?.dataset.source;
  if (!source || dragState?.moved) { sourceHint.classList.remove('is-visible'); return; }
  const host = new URL(source).hostname.replace(/^www\./, '');
  sourceHint.textContent = `${tile.dataset.title ? `${tile.dataset.title} · ` : ''}${host} ↗`;
  sourceHint.classList.add('is-visible');
  gestureHint.classList.add('is-hidden');
}

function requestViewportUpdate() {
  viewportDirty = true;
  requestFrame();
}

function syncViewport() {
  const viewport = window.visualViewport;
  // Browser bars and keyboards can change the visible area without a window
  // resize. Keep the field and its footer on the same visible rectangle.
  const values = {
    '--viewer-width': viewport?.width || window.innerWidth,
    '--viewer-height': viewport?.height || window.innerHeight,
    '--viewer-left': viewport?.offsetLeft || 0,
    '--viewer-top': viewport?.offsetTop || 0,
  };
  for (const [name, value] of Object.entries(values)) {
    const pixels = `${value}px`;
    if (document.body.style.getPropertyValue(name) !== pixels) document.body.style.setProperty(name, pixels);
  }
  resizeField();
}

function resizeField() {
  const previousSize = cellSize;
  const previousPitchX = pitchX, previousPitchY = pitchY;
  const width = Math.max(1, field.clientWidth);
  const height = Math.max(1, field.clientHeight);
  const rect = field.getBoundingClientRect();
  fieldLeft = rect.left;
  fieldTop = rect.top;
  if (width === fieldWidth && height === fieldHeight) return;
  fieldWidth = width;
  fieldHeight = height;
  const { columns, breakpoints, minCellSize, maxCellSize, sizeScale, gapXScale, gapYScale } = FIELD_GEOMETRY;
  const visibleColumns = fieldWidth < breakpoints.tablet ? columns.mobile : fieldWidth < breakpoints.desktop ? columns.tablet : columns.desktop;
  const referenceCellSize = Math.round(clampValue(fieldWidth / visibleColumns, minCellSize, maxCellSize));
  // Frame size and the empty space between frames scale independently.
  cellSize = referenceCellSize * sizeScale;
  pitchX = referenceCellSize * (FIELD_ART_FRACTION * sizeScale + (1 - FIELD_ART_FRACTION) * gapXScale);
  pitchY = referenceCellSize * (FIELD_ART_FRACTION * sizeScale + (1 - FIELD_ART_FRACTION) * gapYScale);
  const shortViewport = Math.min(fieldWidth, fieldHeight);
  maximumShift = Math.min(cellSize * FIELD_ART_FRACTION * FIELD_ATTRACTION.clipTravel, FIELD_ATTRACTION.maximumPixels);
  influenceRadius = Math.max(1, shortViewport * FIELD_ATTRACTION.influenceRadius);
  tileLayer.style.setProperty('--eye-inset', `${((1 - FIELD_ART_FRACTION) * 50).toFixed(3)}%`);
  tileLayer.style.setProperty('--eye-focal', `${Math.max(fieldWidth, fieldHeight) * 1.7}px`);
  if (camera.initialized) {
    camera.x *= pitchX / previousPitchX;
    camera.y *= pitchY / previousPitchY;
    if (dragState) {
      const last = dragState.samples[dragState.samples.length - 1];
      dragState.cameraX = camera.x - (last.x - dragState.originX);
      dragState.cameraY = camera.y - (last.y - dragState.originY);
    }
  } else {
    camera.x = -pitchX * .29;
    camera.y = -pitchY * .34;
    camera.initialized = true;
  }
  poolColumns = Math.ceil(fieldWidth / pitchX) + poolMargin * 2 + 1;
  poolRows = Math.ceil(fieldHeight / pitchY) + poolMargin * 2 + 1;
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
  if (idleEffect?.type === 'all-blink' && idleEffect.start !== null) attachBlinkOverlays(idleEffect, pool);
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
  // Most animation frames retain these coordinates. Avoid allocating a world
  // key and identity string for every pooled tile on every frame.
  if (node.identity && node.column === column && node.row === row && node.version === contentVersion) return;
  const override = artworkOverrides.get(`${column}:${row}`);
  const identity = `${contentVersion}:${column}:${row}:${override?.id || ''}`;
  if (node.identity === identity) return;
  if (idleEffect?.node === node && node.identity !== '') endIdleEffect();
  node.identity = identity;
  node.column = column;
  node.row = row;
  node.version = contentVersion;
  const art = collectionReady ? override || randomField.itemAt(column, row) : null;
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
  if (node.content) node.surface.replaceChildren();
  node.content = null;
  node.geometry = null;
  node.fallbackReady = false;
}

function ensureFallbackArtwork(node) {
  if (node.fallbackReady || !node.art) return;
  // Failed images also count as attempted; never retry them every frame.
  node.fallbackReady = true;
  node.imagePosition = '';
  const { art, appearance, identity } = node;
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
      if (activeCollection.items.length) node.surface.replaceChildren();
      else node.surface.innerHTML = eyeMarkup('sheikah', appearance.light);
      node.content = node.surface.firstElementChild;
      node.geometry = { x: 0, y: 0 };
      node.tile.setAttribute('aria-label', `${art.title || '画像'}（画像を読み込めません）の出典を開く`);
      requestFrame();
    };
    node.surface.replaceChildren(image);
    image.src = art.image;
  }
}

function drawFrame(time) {
  frameHandle = 0;
  if (viewportDirty) { viewportDirty = false; syncViewport(); }
  const dt = clampValue(lastFrame ? time - lastFrame : 16.67, 1, 64);
  lastFrame = time;
  updateIdleEffect(time);
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
  const firstColumn = Math.floor(-camera.x / pitchX) - poolMargin;
  const firstRow = Math.floor(-camera.y / pitchY) - poolMargin;
  const offsetX = (pitchX - cellSize) / 2, offsetY = (pitchY - cellSize) / 2;
  // One compositor transform pans all hit targets. Keep local coordinates near
  // the viewport so an unbounded world never creates an enormous DOM layer.
  const panTransform = `translate3d(${(camera.x + firstColumn * pitchX).toFixed(3)}px,${(camera.y + firstRow * pitchY).toFixed(3)}px,0)`;
  if (tileLayer.style.transform !== panTransform) tileLayer.style.transform = panTransform;
  const renderTiles = [];
  const gpuAvailable = Boolean(fieldRenderer?.valid);
  if (sceneCanvas.hidden === gpuAvailable) sceneCanvas.hidden = !gpuAvailable;
  const neededArtwork = loadingScreen?.isConnected ? [] : null;
  const focusedTile = document.activeElement;
  const reducedMotion = reduceMotion.matches;

  for (let row = 0; row < poolRows; row++) {
    for (let column = 0; column < poolColumns; column++) {
      const worldColumn = firstColumn + column;
      const worldRow = firstRow + row;
      const node = pool[modulo(worldRow, poolRows) * poolColumns + modulo(worldColumn, poolColumns)];
      const x = camera.x + worldColumn * pitchX + offsetX;
      const y = camera.y + worldRow * pitchY + offsetY;
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
      const ease = reducedMotion ? 1 : 1 - Math.exp(-dt / responseMs);
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
      let gazeScale = 1;
      if (idleEffect?.node === node && idleEffect.type === 'glance') {
        const elapsed = time - idleEffect.start;
        const { centerMs, holdMs, returnMs } = VIEWER_SETTINGS.glance;
        const amount = clampValue(elapsed < centerMs ? elapsed / centerMs
          : elapsed < centerMs + holdMs ? 1 : 1 - (elapsed - centerMs - holdMs) / returnMs, 0, 1);
        gazeScale = 1 - amount * amount * (3 - 2 * amount);
      }
      const imageX = node.dx * gazeScale;
      const imageY = node.dy * gazeScale;
      const depth = reducedMotion ? 0 : node.appearance.depth;
      const screenX = x;
      const screenY = y;
      const centerX = screenX + cellSize / 2;
      const centerY = screenY + cellSize / 2;
      const boundsRadius = cellSize * .5 + Math.abs(depth) + 8;
      const visible = centerX + boundsRadius > 0 && centerY + boundsRadius > 0 && centerX - boundsRadius < fieldWidth && centerY - boundsRadius < fieldHeight;
      const position = `translate3d(${column * pitchX + offsetX}px,${row * pitchY + offsetY}px,0)`;
      if (node.position !== position) { node.position = position; node.tile.style.transform = position; }
      const plane = `translateZ(${depth.toFixed(2)}px)`;
      if (node.plane !== plane) { node.plane = plane; node.tile.style.setProperty('--plane-transform', plane); }
      const visibility = visible || node.tile === focusedTile ? 'visible' : 'hidden';
      if (node.visibility !== visibility) { node.visibility = visibility; node.tile.style.visibility = visibility; }
      node.tile._screenX = screenX;
      node.tile._screenY = screenY;
      node.tile._screenRadius = boundsRadius;
      node.tile._imageX = imageX;
      node.tile._imageY = imageY;
      const record = visible && node.art ? ensureTexture(node.textureKey, node.art) : null;
      if (record && neededArtwork) neededArtwork.push(record);
      const textureReady = gpuAvailable && fieldRenderer.hasTexture(node.textureKey);
      if (node.gpu !== textureReady) { node.gpu = textureReady; node.tile.classList.toggle('is-gpu', textureReady); }
      // GPU rendering needs no duplicate DOM image. Create fallback artwork only
      // when needed, including after context loss, and release it on recovery.
      if (textureReady && node.fallbackReady) {
        node.surface.replaceChildren();
        node.content = null;
        node.geometry = null;
        node.fallbackReady = false;
      }
      if (!textureReady && visible && record && (record.phase === 'ready' || record.phase === 'error') && (!gpuAvailable || record.dom)) ensureFallbackArtwork(node);
      if (!textureReady && node.content && node.geometry && visible) {
        const imagePosition = `translate3d(${(node.geometry.x + imageX).toFixed(3)}px,${(node.geometry.y + imageY).toFixed(3)}px,0)`;
        if (node.imagePosition !== imagePosition) { node.imagePosition = imagePosition; node.content.style.transform = imagePosition; }
      }
      // DOM fallback artwork is above the canvas, so its links must be too.
      const order = String((textureReady ? 0 : pool.length) + row * poolColumns + column);
      if (node.order !== order) { node.order = order; node.tile.style.zIndex = order; }
      if (textureReady && visible) {
        const render = node.render || (node.render = {});
        render.x = x; render.y = y; render.size = cellSize;
        render.textureKey = node.textureKey;
        render.imageX = imageX; render.imageY = imageY;
        render.boundsRadius = boundsRadius; render.depth = depth;
        render.symbol = Boolean(node.art.symbol);
        render.crop = render.symbol ? SYMBOL_CROP : PHOTO_CROP;
        renderTiles.push(render);
      }
    }
  }
  if (gpuAvailable) fieldRenderer.render(renderTiles, {
    width: fieldWidth, height: fieldHeight,
    panX: camera.x, panY: camera.y,
    time, reduceMotion: reduceMotion.matches,
  });
  if (collectionReady && neededArtwork?.length && neededArtwork.every(record => record.phase === 'ready' || record.phase === 'error')) readyToReveal();
  drawIdleLottery(time);
  if (moving || (idleEffect && idleEffect.start !== null)) requestFrame();
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
    tile,
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
  gaze.x = event.clientX - fieldLeft;
  gaze.y = event.clientY - fieldTop;
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
  if (cancelled) resetGaze();
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
  if (event.pointerType === 'mouse' && !dragState) { resetGaze(); requestFrame(); }
});
window.addEventListener('blur', () => {
  resetGaze();
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
    if (reduceMotion.matches) { camera.x += direction[0] * pitchX; camera.y += direction[1] * pitchY; }
    else { camera.vx = clampValue(camera.vx + direction[0] * .8, -4, 4); camera.vy = clampValue(camera.vy + direction[1] * .8, -4, 4); }
    hideGestureHint(); requestFrame();
  }
  if (event.key === 'Escape') { camera.vx = camera.vy = 0; resetGaze(); requestFrame(); }
});

async function refreshCollection() {
  const sequence = ++reloadSequence;
  try {
    const loaded = await loadCollection();
    if (sequence !== reloadSequence) return;
    viewerStatus.textContent = '';
    // Refocusing an unchanged page must not rebuild every tile or interrupt an
    // effect. Compare metadata without copying embedded image strings.
    if (collectionReady && loaded.items.length === activeCollection.items.length && loaded.items.every((art, index) => {
      const current = activeCollection.items[index];
      return ['id', 'title', 'image', 'imageGroup', 'width', 'height', 'sourceUrl'].every(key => art[key] === current[key])
        && ['x', 'y', 'r'].every(key => art.eye[key] === current.eye[key]);
    })) { requestFrame(); return; }
    endIdleEffect();
    activeCollection = loaded;
    collectionReady = true;
    randomField = createRandomField(loaded.items.length ? loaded.items : eyePresets, fieldSeed);
    const available = new Map((loaded.items.length ? loaded.items : eyePresets).map(art => [art.id, art]));
    for (const [coordinate, art] of artworkOverrides) {
      if (available.has(art.id)) artworkOverrides.set(coordinate, available.get(art.id));
      else artworkOverrides.delete(coordinate);
    }
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


window.addEventListener('resize', requestViewportUpdate);
window.visualViewport?.addEventListener('resize', requestViewportUpdate);
window.visualViewport?.addEventListener('scroll', requestViewportUpdate);
new ResizeObserver(resizeField).observe(field);
window.addEventListener('pageshow', () => {
  cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  lastFrame = 0;
  requestViewportUpdate();
  scheduleIdleLottery();
});
window.addEventListener('focus', () => { if (!embeddedViewer) refreshCollection(); });
window.addEventListener('me:collection', refreshCollection);
window.addEventListener('storage', event => { if (event.key === 'me-eye-grid-saved') refreshCollection(); });
document.addEventListener('visibilitychange', () => {
  idleLotteryPending = false;
  endIdleEffect();
  scheduleIdleLottery();
  if (document.hidden) { cancelAnimationFrame(frameHandle); frameHandle = 0; lastFrame = 0; camera.vx = camera.vy = 0; }
  else { if (!embeddedViewer) refreshCollection(); requestViewportUpdate(); }
});
reduceMotion.addEventListener('change', () => { endIdleEffect(); scheduleIdleLottery(); requestFrame(); });
touchPointer.addEventListener('change', () => { resetGaze(); requestFrame(); });
debugPanel?.addEventListener('click', event => {
  const button = event.target.closest('button[data-effect]');
  if (!button) return;
  debugEffectRequest = button.dataset.effect;
  if (idleEffect?.type === 'glance') debugStatus.textContent = `視線を元に戻した後に「${button.textContent.trim()}」を実行します。`;
  requestFrame();
});
document.getElementById('debug-blink-duration')?.addEventListener('input', event => {
  const input = event.target;
  if (input.validity.valid && input.valueAsNumber > 0) document.documentElement.style.setProperty('--blink-duration', `${input.valueAsNumber}ms`);
});
if (!embeddedViewer) {
  try {
    viewerChannel = new BroadcastChannel('me-eye-grid-updates');
    viewerChannel.onmessage = event => { if (event.data?.type === 'saved') refreshCollection(); };
  } catch {}
}
syncViewport();
refreshCollection();
scheduleIdleLottery();
