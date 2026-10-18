import { loadCollection, saveCollection, emptyCollection, validateCollection, safeUrl, newId, readImageFile, readImageUrl, downloadArchive, publishCollection, readCollectionFile, downloadSite, createSiteHTML, isPortableEditor } from '../lib/collection-store.js';
import { FIELD_GEOMETRY } from './field-layout.js';

const $ = id => document.getElementById(id);
document.documentElement.style.setProperty('--eye-inset', `${(1 - FIELD_GEOMETRY.artFraction) * 50}%`);
const ME_EDITOR_COMMIT_LABEL = isPortableEditor ? '変更を反映' : '保存して反映';
const ui = {
  stage: $('image-stage'), canvas: $('eye-canvas'), empty: $('stage-empty'),
  preview: $('crop-preview'), title: $('image-title'), source: $('source-url'),
  imageUrl: $('image-url'), radius: $('eye-radius'), radiusValue: $('radius-value'),
  pending: $('pending-source'), draftState: $('draft-state'), name: $('current-image-name'),
  save: $('save-image'), remove: $('delete-image'), reset: $('reset-eye'),
  newImage: $('new-image'), choose: $('choose-images'), importUrl: $('load-image-url'),
  files: $('image-file-input'), dataFile: $('data-file-input'),
  importData: $('import-data'), exportData: $('export-data'), exportSite: $('export-site'),
  publish: $('publish-data'),
  library: $('asset-library'), libraryEmpty: $('library-empty'), count: $('image-count'),
  librarySearch: $('library-search'), libraryFilter: $('library-filter'),
  librarySummary: $('library-summary'), libraryNoResults: $('library-no-results'),
  status: $('status-bar'), statusMessage: $('status-message'),
  loadError: $('load-error'), loadErrorMessage: $('load-error-message'), reload: $('reload-data'),
};
const context = ui.canvas.getContext('2d');
const drafts = new Map();
const dirtyIds = new Set();
const cropEntries = new Map();
const assetNodes = new Map();
let collection = emptyCollection();
let activeId = null;
let pendingSource = '';
let working = false;
let loadReady = false;
let unsavedCollection = false;
let loadedImage = null;
let previewImageSource = null;
let imageLoadToken = 0;
let canvasView = null;
let pointerDrag = null;
let dropDepth = 0;
let portableNeedsExport = false;

const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const copyItem = item => ({ ...item, eye: { ...item.eye } });
const copyCollection = data => ({ ...data, items: data.items.map(copyItem) });
const activeDraft = () => activeId ? drafts.get(activeId) : null;

function setStatus(message, state = '') {
  ui.statusMessage.textContent = message;
  ui.status.classList.toggle('is-error', state === 'error');
  ui.status.classList.toggle('is-busy', state === 'busy');
}

function updateControls() {
  const hasImage = Boolean(activeDraft());
  const blocked = working || !loadReady;
  for (const control of [ui.choose, ui.newImage, ui.importUrl, ui.exportData, ui.exportSite, ui.source, ui.imageUrl, ui.librarySearch, ui.libraryFilter]) control.disabled = blocked;
  if (ui.publish) ui.publish.disabled = blocked || isPortableEditor;
  ui.importData.disabled = working;
  for (const control of [ui.title, ui.radius, ui.reset, ui.save, ui.remove]) control.disabled = blocked || !hasImage;
  ui.draftState.textContent = !loadReady ? 'データを読込' : hasImage ? (dirtyIds.has(activeId) || unsavedCollection ? '未保存の変更' : isPortableEditor ? '反映済み' : '保存済み') : '画像を追加';
  ui.draftState.classList.toggle('is-dirty', hasImage && (dirtyIds.has(activeId) || unsavedCollection));
  ui.loadError.hidden = loadReady || working;
  ui.pending.hidden = hasImage || !pendingSource.trim();
  ui.stage.setAttribute('aria-busy', String(working));
  for (const [id, elements] of assetNodes) {
    elements.card.classList.toggle('is-active', id === activeId);
    elements.badge.hidden = !dirtyIds.has(id);
    elements.open.disabled = blocked;
    elements.edit.disabled = blocked;
    elements.remove.disabled = blocked;
  }
}

async function runAction(action, message, allowWithoutData = false) {
  if (working) return;
  if (!loadReady && !allowWithoutData) {
    setStatus('データを読み込めていません。再読込か「データを読込」で復元してください。', 'error');
    return;
  }
  working = true;
  updateControls();
  if (message) setStatus(message, 'busy');
  try { await action(); }
  catch (error) {
    const message = error?.message || '処理できませんでした。もう一度お試しください。';
    setStatus(message, 'error');
    if (!loadReady) ui.loadErrorMessage.textContent = message;
  }
  finally { working = false; updateControls(); }
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  return safeUrl(/^(?:www\.)?(?:x|twitter|pbs\.twimg)\.com\//i.test(text) ? `https://${text}` : text);
}

function sourceValue(value) {
  if (!String(value || '').trim()) return '';
  const url = normalizeUrl(value);
  if (!url) throw new Error('元の投稿・リンクには http または https のURLを指定してください。');
  return url;
}

function normalizeDraft(item) {
  return {
    ...item,
    title: item.title.trim().slice(0, 160) || '無題',
    sourceUrl: sourceValue(item.sourceUrl),
    eye: {
      x: Number(clamp(item.eye.x, .02, .98).toFixed(6)),
      y: Number(clamp(item.eye.y, .02, .98).toFixed(6)),
      r: Number(clamp(item.eye.r, .02, .5).toFixed(6)),
    },
  };
}

function collectionWithDrafts(ids) {
  const candidate = copyCollection(collection);
  for (const id of ids) {
    const draft = drafts.get(id);
    const index = candidate.items.findIndex(item => item.id === id);
    if (draft && index !== -1) candidate.items[index] = normalizeDraft(draft);
  }
  return validateCollection(candidate);
}

async function persist(candidate, cleanIds = []) {
  collection = validateCollection(candidate);
  unsavedCollection = true;
  renderArrangement();
  await saveCollection(collection);
  if (isPortableEditor) portableNeedsExport = true;
  unsavedCollection = false;
  for (const id of cleanIds) {
    const saved = collection.items.find(item => item.id === id);
    if (saved) drafts.set(id, copyItem(saved));
    dirtyIds.delete(id);
  }
  renderActiveValues();
  updateControls();
}

function markDirty() {
  if (!activeId) return;
  dirtyIds.add(activeId);
  updateControls();
}

function cropGeometry(item, size) {
  const x = clamp(item.eye.x, .02, .98) * item.width;
  const y = clamp(item.eye.y, .02, .98) * item.height;
  const radius = clamp(item.eye.r, .02, .5) * Math.min(item.width, item.height);
  const cropSide = radius / .26;
  const scale = size / cropSide;
  return { width: item.width * scale, height: item.height * scale, left: size / 2 - x * scale, top: size / 2 - y * scale };
}

function positionCrop(container, item) {
  const image = container.querySelector('img');
  if (!image) return;
  const geometry = cropGeometry(item, (container.clientWidth || 100) * FIELD_GEOMETRY.artFraction);
  for (const [key, value] of Object.entries(geometry)) image.style[key] = `${value}px`;
}

function createCrop(container, item) {
  const plane = document.createElement('span');
  plane.className = 'crop-art';
  const image = document.createElement('img');
  image.src = item.image;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  image.addEventListener('error', () => {
    image.hidden = true;
    const fallback = document.createElement('span');
    fallback.className = 'crop-error';
    fallback.textContent = '読込不可';
    container.append(fallback);
  }, { once: true });
  plane.append(image);
  container.replaceChildren(plane);
  container.classList.add('has-image');
  cropEntries.set(container, item);
  positionCrop(container, item);
}

function refreshCrops() {
  for (const [container, item] of cropEntries) {
    if (!container.isConnected) { cropEntries.delete(container); continue; }
    positionCrop(container, item);
  }
}

function renderMainPreview() {
  const draft = activeDraft();
  if (!draft) {
    ui.preview.replaceChildren();
    ui.preview.classList.remove('has-image');
    cropEntries.delete(ui.preview);
    previewImageSource = null;
    return;
  }
  if (ui.preview.dataset.imageId !== draft.id || previewImageSource !== draft.image || !ui.preview.querySelector('img')) {
    createCrop(ui.preview, draft);
    ui.preview.dataset.imageId = draft.id;
    previewImageSource = draft.image;
  }
  cropEntries.set(ui.preview, draft);
  positionCrop(ui.preview, draft);
}

function renderActiveValues() {
  const draft = activeDraft();
  ui.title.value = draft?.title || '';
  ui.source.value = draft ? draft.sourceUrl : pendingSource;
  ui.radius.value = String((draft?.eye.r || .2) * 100);
  ui.radiusValue.value = `${Number(((draft?.eye.r || .2) * 100).toFixed(1))}%`;
  ui.name.textContent = draft ? `${draft.title || '無題'}  /  ${draft.width} × ${draft.height}` : '画像をドロップ';
  renderMainPreview();
  updateControls();
}

function openItem(id) {
  if (pointerDrag) endPointer();
  const item = collection.items.find(entry => entry.id === id);
  if (id && !item) return;
  activeId = id || null;
  if (item && !drafts.has(id)) drafts.set(id, copyItem(item));
  loadedImage = null;
  canvasView = null;
  const token = ++imageLoadToken;
  ui.imageUrl.value = '';
  ui.stage.classList.toggle('has-image', Boolean(item));
  ui.empty.hidden = Boolean(item);
  ui.empty.querySelector('p').textContent = '画像をドロップ';
  renderActiveValues();
  drawCanvas();
  if (!item) return;
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (token !== imageLoadToken) return;
    loadedImage = image;
    drawCanvas();
  };
  image.onerror = () => {
    if (token !== imageLoadToken) return;
    ui.empty.hidden = false;
    ui.stage.classList.remove('has-image');
    ui.empty.querySelector('p').textContent = '画像を表示できませんでした。';
    setStatus('画像を表示できませんでした。画像ファイルを取り込み直してください。', 'error');
  };
  image.src = activeDraft().image;
}

function drawCanvas() {
  if (!context) return;
  const bounds = ui.stage.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const physicalWidth = Math.round(width * ratio);
  const physicalHeight = Math.round(height * ratio);
  if (ui.canvas.width !== physicalWidth) ui.canvas.width = physicalWidth;
  if (ui.canvas.height !== physicalHeight) ui.canvas.height = physicalHeight;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const draft = activeDraft();
  if (!draft || !loadedImage) { canvasView = null; return; }
  const padding = clamp(Math.min(width, height) * .06, 17, 30);
  const scale = Math.min((width - padding * 2) / draft.width, (height - padding * 2) / draft.height);
  const imageWidth = draft.width * scale;
  const imageHeight = draft.height * scale;
  const left = (width - imageWidth) / 2;
  const top = (height - imageHeight) / 2;
  canvasView = { left, top, width: imageWidth, height: imageHeight, scale };
  context.drawImage(loadedImage, left, top, imageWidth, imageHeight);
  const centerX = left + draft.eye.x * imageWidth;
  const centerY = top + draft.eye.y * imageHeight;
  const radius = draft.eye.r * Math.min(draft.width, draft.height) * scale;
  context.save();
  context.beginPath();
  context.rect(left, top, imageWidth, imageHeight);
  context.moveTo(centerX + radius, centerY);
  context.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
  context.fillStyle = 'rgba(0,0,0,.45)';
  context.fill('evenodd');
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(0,0,0,.8)';
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = '#fff';
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.moveTo(centerX - 6, centerY); context.lineTo(centerX + 6, centerY);
  context.moveTo(centerX, centerY - 6); context.lineTo(centerX, centerY + 6);
  context.strokeStyle = '#111'; context.lineWidth = 3; context.stroke();
  context.strokeStyle = '#fff'; context.lineWidth = 1; context.stroke();
  for (const [x, y] of [[centerX + radius, centerY], [centerX, centerY + radius], [centerX - radius, centerY], [centerX, centerY - radius]]) {
    context.beginPath(); context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fillStyle = '#fff'; context.fill();
    context.strokeStyle = '#111'; context.lineWidth = 1; context.stroke();
  }
  context.restore();
}

function pointerPosition(event) {
  const bounds = ui.canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function setEye(eye) {
  const draft = activeDraft();
  if (!draft) return;
  draft.eye = { x: clamp(eye.x, .02, .98), y: clamp(eye.y, .02, .98), r: clamp(eye.r, .02, .5) };
  ui.radius.value = String(draft.eye.r * 100);
  ui.radiusValue.value = `${Number((draft.eye.r * 100).toFixed(1))}%`;
  markDirty();
  drawCanvas();
  renderMainPreview();
}

function startPointer(event) {
  if (working || !canvasView || !activeDraft() || pointerDrag || event.button !== 0) return;
  const position = pointerPosition(event);
  const view = canvasView;
  if (position.x < view.left || position.y < view.top || position.x > view.left + view.width || position.y > view.top + view.height) return;
  const draft = activeDraft();
  const center = { x: view.left + draft.eye.x * view.width, y: view.top + draft.eye.y * view.height };
  const distance = Math.hypot(position.x - center.x, position.y - center.y);
  const radius = draft.eye.r * Math.min(view.width, view.height);
  const edgeHit = Math.min(12, radius * .35);
  const mode = Math.abs(distance - radius) <= edgeHit ? 'resize' : distance < radius ? 'move' : 'create';
  const x = (position.x - view.left) / view.width;
  const y = (position.y - view.top) / view.height;
  pointerDrag = { pointerId: event.pointerId, mode, x, y, startX: position.x, startY: position.y, offsetX: x - draft.eye.x, offsetY: y - draft.eye.y, before: { ...draft.eye }, wasDirty: dirtyIds.has(activeId), moved: false };
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.focus({ preventScroll: true });
  if (mode === 'create') setEye({ x, y, r: .02 });
  event.preventDefault();
}

function movePointer(event) {
  if (!canvasView || !activeDraft() || working) return;
  const position = pointerPosition(event);
  const view = canvasView;
  const draft = activeDraft();
  if (!pointerDrag) {
    const distance = Math.hypot(position.x - view.left - draft.eye.x * view.width, position.y - view.top - draft.eye.y * view.height);
    const radius = draft.eye.r * Math.min(view.width, view.height);
    const edgeHit = Math.min(12, radius * .35);
    ui.canvas.style.cursor = Math.abs(distance - radius) <= edgeHit ? 'nwse-resize' : distance < radius ? 'move' : 'crosshair';
    return;
  }
  if (event.pointerId !== pointerDrag.pointerId) return;
  const drag = pointerDrag;
  const x = (position.x - view.left) / view.width;
  const y = (position.y - view.top) / view.height;
  drag.moved ||= Math.hypot(position.x - drag.startX, position.y - drag.startY) > 3;
  if (drag.mode === 'move') {
    setEye({ ...draft.eye, x: x - drag.offsetX, y: y - drag.offsetY });
  } else {
    const centerX = drag.mode === 'create' ? clamp(drag.x, .02, .98) : draft.eye.x;
    const centerY = drag.mode === 'create' ? clamp(drag.y, .02, .98) : draft.eye.y;
    const radius = Math.hypot((x - centerX) * view.width, (y - centerY) * view.height) / Math.min(view.width, view.height);
    setEye({ x: centerX, y: centerY, r: radius });
  }
  event.preventDefault();
}

function endPointer(event) {
  if (!pointerDrag || (event && event.pointerId !== pointerDrag.pointerId)) return;
  const drag = pointerDrag;
  pointerDrag = null;
  if (event?.type === 'pointercancel') {
    const draft = activeDraft();
    if (draft) draft.eye = drag.before;
    if (!drag.wasDirty) dirtyIds.delete(activeId);
    renderActiveValues();
    drawCanvas();
  } else if (drag.mode === 'create' && !drag.moved) {
    setEye({ ...activeDraft().eye, r: drag.before.r });
  }
  try { ui.canvas.releasePointerCapture(drag.pointerId); } catch {}
  ui.canvas.style.cursor = 'crosshair';
}

function renderLibrary() {
  assetNodes.clear();
  const fragment = document.createDocumentFragment();
  const groups = new Map();
  collection.items.forEach((item, index) => {
    if (!groups.has(item.image)) groups.set(item.image, []);
    groups.get(item.image).push(index + 1);
  });
  const search = ui.librarySearch.value.trim().toLocaleLowerCase();
  const filter = ui.libraryFilter.value;
  let duplicateCount = 0;
  for (const [index, item] of collection.items.entries()) {
    const sameImage = groups.get(item.image);
    const duplicate = sameImage.length > 1;
    if (duplicate) duplicateCount++;
    if (filter === 'duplicates' && !duplicate) continue;
    if (search && !item.title.toLocaleLowerCase().includes(search)) continue;
    const card = document.createElement('div'); card.className = 'asset-card';
    card.dataset.id = item.id;
    const open = document.createElement('button'); open.className = 'asset-open'; open.type = 'button';
    open.setAttribute('aria-label', `${item.title || '無題'}を編集`);
    const original = document.createElement('img'); original.className = 'asset-original';
    original.src = item.image; original.alt = item.title || '無題'; original.loading = 'lazy'; original.decoding = 'async'; original.draggable = false;
    const number = document.createElement('span'); number.className = 'asset-number'; number.textContent = `#${index + 1}`;
    const title = document.createElement('span'); title.className = 'asset-title'; title.textContent = item.title || '無題';
    title.title = item.title || '無題';
    open.append(original, title);
    const meta = document.createElement('div'); meta.className = 'asset-meta';
    const count = document.createElement('span'); count.className = 'asset-display-state';
    count.textContent = duplicate ? '同じ画像は1種類として表示' : '自動配置の対象';
    const size = document.createElement('span'); size.className = 'asset-size'; size.textContent = `${item.width} × ${item.height}`;
    meta.append(count, size);
    const duplicateBadge = document.createElement('p'); duplicateBadge.className = 'asset-duplicate';
    duplicateBadge.hidden = !duplicate;
    duplicateBadge.textContent = duplicate ? `重複：${sameImage.map(number => `#${number}`).join('・')}` : '';
    const actions = document.createElement('div'); actions.className = 'asset-actions';
    const edit = document.createElement('button'); edit.className = 'text-button asset-edit'; edit.type = 'button'; edit.textContent = '編集 ↗';
    edit.setAttribute('aria-label', `${item.title || '無題'}の目とリンクを編集`);
    const editItem = () => {
      if (working) return;
      openItem(item.id);
      ui.stage.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      setStatus(`円とリンクを編集し「${ME_EDITOR_COMMIT_LABEL}」で確定してください。`);
    };
    open.addEventListener('click', editItem);
    edit.addEventListener('click', editItem);
    const remove = document.createElement('button'); remove.className = 'text-button asset-delete'; remove.type = 'button'; remove.textContent = '削除';
    remove.setAttribute('aria-label', `${item.title || '無題'}（登録${index + 1}）を削除`);
    remove.addEventListener('click', () => { void runAction(() => deleteItem(item.id)); });
    actions.append(edit, remove);
    const badge = document.createElement('span'); badge.className = 'asset-unsaved'; badge.textContent = '未保存'; badge.hidden = !dirtyIds.has(item.id);
    card.append(number, open, meta, duplicateBadge, actions, badge);
    fragment.append(card);
    assetNodes.set(item.id, { card, open, edit, remove, badge });
  }
  ui.library.replaceChildren(fragment);
  ui.libraryEmpty.hidden = collection.items.length > 0;
  ui.count.textContent = String(collection.items.length);
  ui.librarySummary.textContent = `登録 ${collection.items.length}件 ／ 表示対象 ${groups.size}種類 ／ 重複 ${duplicateCount}件`;
  ui.libraryNoResults.hidden = !collection.items.length || assetNodes.size > 0;
}

async function deleteItem(id) {
  const item = collection.items.find(item => item.id === id);
  if (!item) return;
  if (!window.confirm(`「${item.title || '無題'}」を登録画像から削除しますか？\nほかの登録画像は残ります。`)) return;
  const candidate = copyCollection(collection);
  candidate.items = candidate.items.filter(item => item.id !== id);
  // Save successfully before removing the image from the editor.
  await saveCollection(candidate);
  collection = candidate;
  unsavedCollection = false;
  if (isPortableEditor) portableNeedsExport = true;
  drafts.delete(id); dirtyIds.delete(id);
  if (activeId === id) openItem(null);
  renderArrangement();
  setStatus(`「${item.title || '無題'}」を削除しました。残った画像を自動で配置します。`);
}

function renderArrangement() {
  renderLibrary();
  refreshCrops();
  updateControls();
}

function titleFromUrl(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '画像').replace(/\.[a-z0-9]+$/i, '').slice(0, 160); }
  catch { return '画像'; }
}

function makeItem(result, title, source) {
  return { id: newId(), title: title || '無題', ...result, sourceUrl: source, eye: { x: .5, y: .5, r: .2 } };
}

async function addItems(items) {
  const candidate = copyCollection(collection);
  candidate.items.push(...items);
  collection = validateCollection(candidate);
  for (const item of items) { drafts.set(item.id, copyItem(item)); dirtyIds.add(item.id); }
  pendingSource = '';
  renderArrangement();
  openItem(items[0].id);
  await persist(collection, items.map(item => item.id));
}

async function importFiles(files, suppliedSource) {
  if (!files.length) return;
  const source = sourceValue(suppliedSource || (!activeId ? pendingSource : ''));
  const items = [];
  const errors = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    setStatus(`画像を取り込んでいます… ${index + 1} / ${files.length}`, 'busy');
    try {
      const result = await readImageFile(file);
      items.push(makeItem(result, file.name.replace(/\.[^.]+$/, '').slice(0, 160), source));
    } catch (error) { errors.push(`${file.name || '画像'}：${error.message || '読み込めませんでした。'}`); }
  }
  if (!items.length) throw new Error(errors.join(' / ') || '画像を取り込めませんでした。');
  await addItems(items);
  if (errors.length) setStatus(`${items.length}枚を取り込みました。${errors.join(' / ')}`, 'error');
  else setStatus(`${items.length}枚を取り込みました。円で目の範囲を指定し「${ME_EDITOR_COMMIT_LABEL}」を押してください。`);
}

function isPostUrl(value) {
  try { const url = new URL(value); return /(^|\.)(x|twitter)\.com$/i.test(url.hostname) && /\/status\//i.test(url.pathname); }
  catch { return false; }
}

function isImageUrl(value) {
  try { const url = new URL(value); return /(^|\.)pbs\.twimg\.com$/i.test(url.hostname) || /\.(?:jpe?g|png|webp|gif|avif|bmp)(?::\w+)?$/i.test(url.pathname); }
  catch { return false; }
}

function applySourceLink(value) {
  const source = sourceValue(value);
  if (activeDraft()) {
    activeDraft().sourceUrl = source;
    ui.source.value = source;
    markDirty();
    setStatus(`この画像にリンクを設定しました。「${ME_EDITOR_COMMIT_LABEL}」で確定してください。`);
  } else {
    pendingSource = source;
    ui.source.value = source;
    updateControls();
    setStatus('リンクを控えました。画像ファイルか画像URLを追加してください。');
  }
}

async function importImageUrl(value, suppliedSource) {
  const url = normalizeUrl(value);
  if (!url) throw new Error('画像そのものの http または https のURLを指定してください。');
  if (isPostUrl(url)) { applySourceLink(url); ui.imageUrl.value = ''; return; }
  const source = sourceValue(suppliedSource || (!activeId ? pendingSource : ''));
  setStatus('画像URLを読み込んでいます…', 'busy');
  const result = await readImageUrl(url);
  await addItems([makeItem(result, titleFromUrl(url), source)]);
  ui.imageUrl.value = '';
  if (!result.image.startsWith('http')) setStatus('画像を取り込みました。円で目の範囲を指定してください。');
  else setStatus('画像URLを登録しました。配布用のサイトに埋め込むには、画像ファイルで取り込んでください。');
}

function readTransfer(transfer) {
  const files = Array.from(transfer.files || []).filter(file => file.type.startsWith('image/') || /\.(?:jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(file.name));
  const urls = [];
  for (const format of ['text/uri-list', 'text/plain']) {
    const text = transfer.getData(format);
    for (const line of text.split(/[\r\n]+/)) {
      if (line.trim().startsWith('#')) continue;
      const url = normalizeUrl(line.trim());
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  let htmlImage = '';
  const htmlLinks = [];
  const html = transfer.getData('text/html');
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    for (const image of document.querySelectorAll('img')) {
      const url = normalizeUrl(image.getAttribute('src'));
      if (url && !isPostUrl(url)) { htmlImage = url; break; }
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const url = normalizeUrl(link.getAttribute('href'));
      if (url) htmlLinks.push(url);
    }
  }
  const allLinks = [...htmlLinks, ...urls];
  const image = htmlImage || urls.find(isImageUrl) || '';
  const source = allLinks.find(isPostUrl) || allLinks.find(url => url !== image && !isImageUrl(url)) || '';
  return { files, image, source };
}

async function importTransfer(data) {
  if (data.files.length) { await importFiles(data.files, data.source); return; }
  if (data.image) { await importImageUrl(data.image, data.source); return; }
  if (data.source) { applySourceLink(data.source); return; }
  throw new Error('画像ファイル・画像URL・元の投稿リンクをドロップしてください。');
}

async function exportCollection(asSite) {
  const ids = [...dirtyIds];
  const candidate = collectionWithDrafts(ids);
  let saved = true;
  try { await persist(candidate, ids); }
  catch { saved = false; }
  if (asSite) {
    setStatus('配布用サイトを書き出しています…', 'busy');
    await downloadSite(candidate);
  } else {
    await downloadArchive(candidate);
    if (isPortableEditor) portableNeedsExport = false;
  }
  if (isPortableEditor) {
    setStatus(asSite
      ? 'me.html を書き出しました。再編集用には「データを書出」でZIPを保管してください。'
      : 'eyes-backup.zip を書き出しました。画像と編集情報が入っています。');
    return;
  }
  setStatus(`${asSite ? '配布用の me.html' : '画像と編集情報のZIPバックアップ'}を書き出しました。${saved ? '' : 'このブラウザへの保存には失敗しています。書き出したファイルを保管してください。'}`, saved ? '' : 'error');
}

if (isPortableEditor) {
  if (ui.publish) ui.publish.hidden = true;
  ui.save.innerHTML = '変更を反映 <span aria-hidden="true">↗</span>';
  const footer = document.querySelector('.page-footer span');
  if (footer) footer.textContent = '編集はこの画面で保持。閉じる前に「データを書出」で保存してください。';
  for (const link of document.querySelectorAll('.editor-title, .viewer-link')) {
    link.href = './preview.html';
    link.setAttribute('aria-label', '現在の配置でサイトを開く');
    link.addEventListener('click', event => {
      event.preventDefault();
      if (working) return;
      if (!loadReady) { setStatus('「データを読込」で配置データを読み込んでください。', 'error'); return; }
      // Open synchronously with the click so the browser can allow the tab.
      const previewWindow = window.open('about:blank', '_blank');
      if (!previewWindow) { setStatus('別タブを開けませんでした。「サイトを書出」で保存した me.html を開いてください。', 'error'); return; }
      previewWindow.opener = null;
      void runAction(async () => {
        try {
          const html = await createSiteHTML(collectionWithDrafts([...dirtyIds]));
          const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
          previewWindow.location.replace(url);
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          setStatus('現在の画像と配置を別タブで開きました。');
        } catch (error) { previewWindow.close(); throw error; }
      }, '現在の配置を開いています…');
    });
  }
}

ui.choose.addEventListener('click', () => { if (!working) ui.files.click(); });
ui.files.addEventListener('change', () => {
  const files = [...ui.files.files]; ui.files.value = '';
  void runAction(() => importFiles(files));
});
ui.newImage.addEventListener('click', () => {
  if (working) return;
  pendingSource = '';
  openItem(null);
  setStatus('新しい画像を追加してください。未保存の編集は、画像を切り替えても保持されます。');
});
ui.importUrl.addEventListener('click', () => { void runAction(() => importImageUrl(ui.imageUrl.value)); });
ui.imageUrl.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); void runAction(() => importImageUrl(ui.imageUrl.value)); }
});
ui.title.addEventListener('input', () => {
  if (!activeDraft() || working) return;
  activeDraft().title = ui.title.value;
  markDirty();
});
ui.source.addEventListener('input', () => {
  if (working) return;
  if (activeDraft()) { activeDraft().sourceUrl = ui.source.value; markDirty(); }
  else { pendingSource = ui.source.value; updateControls(); }
});
ui.source.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); });
ui.source.addEventListener('drop', event => {
  event.preventDefault(); event.stopPropagation();
  const data = readTransfer(event.dataTransfer);
  void runAction(async () => {
    const url = data.source || data.image;
    if (!url) throw new Error('この欄には元の投稿やページのURLをドロップしてください。');
    applySourceLink(url);
  });
});
ui.radius.addEventListener('input', () => { if (!working && activeDraft()) setEye({ ...activeDraft().eye, r: Number(ui.radius.value) / 100 }); });
ui.reset.addEventListener('click', () => { if (!working && activeDraft()) setEye({ x: .5, y: .5, r: .2 }); });
ui.save.addEventListener('click', () => {
  if (!activeId) return;
  void runAction(async () => {
    const id = activeId;
    await persist(collectionWithDrafts([id]), [id]);
    setStatus(isPortableEditor ? '変更を反映しました。「サイトへ」で確認し、「データを書出」で保存してください。' : 'このブラウザに保存しました。公開用ファイルへ保存するときは「公開データに反映」を使ってください。');
  }, '保存しています…');
});
ui.remove.addEventListener('click', () => {
  if (!activeId) return;
  void runAction(() => deleteItem(activeId));
});
for (const [control, event] of [[ui.librarySearch, 'input'], [ui.libraryFilter, 'change']]) {
  control.addEventListener(event, () => { renderLibrary(); refreshCrops(); updateControls(); });
}
ui.importData.addEventListener('click', () => { if (!working) ui.dataFile.click(); });
ui.dataFile.addEventListener('change', () => {
  const file = ui.dataFile.files[0]; ui.dataFile.value = '';
  if (!file) return;
  void runAction(async () => {
    const imported = await readCollectionFile(file);
    drafts.clear(); dirtyIds.clear(); pendingSource = ''; activeId = null;
    loadReady = true;
    collection = imported;
    renderArrangement();
    openItem(imported.items[0]?.id || null);
    await persist(imported);
    if (isPortableEditor) portableNeedsExport = false;
    setStatus(`データを読み込みました（${imported.items.length}枚）。${isPortableEditor ? '画像・円・配置を編集できます。' : 'このブラウザに保存しました。'}`);
  }, 'データを読み込んでいます…', true);
});
ui.reload.addEventListener('click', () => window.location.reload());
ui.exportData.addEventListener('click', () => { void runAction(() => exportCollection(false), 'データを書き出しています…'); });
ui.exportSite.addEventListener('click', () => { void runAction(() => exportCollection(true), '配布用サイトを書き出しています…'); });
ui.publish?.addEventListener('click', () => {
  void runAction(async () => {
    const ids = [...dirtyIds];
    const candidate = collectionWithDrafts(ids);
    const result = await publishCollection(candidate);
    let browserSaved = true;
    try { await persist(candidate, ids); } catch { browserSaved = false; }
    const message = result.staged
      ? `${result.count}枚を公開用ファイルに保存し、Gitのステージへ追加しました。commit / pushすると公開されます。`
      : `${result.count}枚を公開用ファイルに保存しました。ステージへの追加は失敗したため、git add src/data/collection を実行してください。`;
    setStatus(message + (browserSaved ? '' : ' ブラウザの下書き保存には失敗しています。'), result.staged && browserSaved ? '' : 'error');
  }, '公開用ファイルに保存しています…');
});

ui.canvas.addEventListener('pointerdown', startPointer);
ui.canvas.addEventListener('pointermove', movePointer);
ui.canvas.addEventListener('pointerup', endPointer);
ui.canvas.addEventListener('pointercancel', endPointer);
ui.canvas.addEventListener('keydown', event => {
  if (working || !activeDraft()) return;
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? .02 : .002;
  const eye = activeDraft().eye;
  setEye({ ...eye, x: eye.x + direction[0] * step, y: eye.y + direction[1] * step });
});

ui.stage.addEventListener('dragenter', event => {
  if (working) return;
  event.preventDefault(); dropDepth++; ui.stage.classList.add('is-dragover');
});
ui.stage.addEventListener('dragleave', () => {
  dropDepth = Math.max(0, dropDepth - 1);
  if (!dropDepth) ui.stage.classList.remove('is-dragover');
});
document.addEventListener('dragover', event => {
  if (event.dataTransfer.types.some(type => ['Files', 'text/uri-list', 'text/plain', 'text/html'].includes(type))) event.preventDefault();
});
document.addEventListener('drop', event => {
  event.preventDefault();
  dropDepth = 0; ui.stage.classList.remove('is-dragover');
  const data = readTransfer(event.dataTransfer);
  void runAction(() => importTransfer(data));
});
document.addEventListener('paste', event => {
  if (working || !event.clipboardData) return;
  const files = Array.from(event.clipboardData.files || []).filter(file => file.type.startsWith('image/'));
  if (files.length) {
    event.preventDefault();
    void runAction(() => importFiles(files));
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
  const data = readTransfer(event.clipboardData);
  if (data.image || data.source) { event.preventDefault(); void runAction(() => importTransfer(data)); }
});
window.addEventListener('beforeunload', event => {
  if (!dirtyIds.size && !unsavedCollection && !portableNeedsExport) return;
  event.preventDefault();
});

if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(() => { drawCanvas(); renderMainPreview(); refreshCrops(); });
  for (const element of [ui.stage, ui.preview, ui.library]) observer.observe(element);
} else window.addEventListener('resize', () => { drawCanvas(); renderMainPreview(); refreshCrops(); });

void runAction(async () => {
  collection = validateCollection(await loadCollection());
  loadReady = true;
  renderArrangement();
  openItem(collection.items[0]?.id || null);
  setStatus(collection.items.length ? '登録した画像を読み込みました。「編集」から目とリンクを変更できます。' : '画像を取り込み、円で目の範囲を指定してください。');
}, '画像データを読み込んでいます…', true);
