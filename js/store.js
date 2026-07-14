// Central store: state, dispatch, undo/redo, autosave.
//
// state.assets (images/audio uploaded by the user) is intentionally kept
// OUTSIDE state.doc. Undo snapshots and the 400ms doc-autosave both
// JSON-clone state.doc very frequently (every paint stroke, every commit) —
// if multi-MB media lived inside doc, every one of those would re-serialize
// that media too, which would be slow on low-memory devices. Assets persist
// to their own localStorage key, saved only when they actually change.

import { defaultDoc, migrateDoc, defaultStroke, uid } from './model.js';

const AUTOSAVE_KEY = 'dotmatrix.project.v1';
const ASSETS_KEY = 'dotmatrix.assets.v1';
const UNDO_LIMIT = 80;

const listeners = new Set();
let undoStack = [];
let redoStack = [];

export const state = {
  doc: null,
  projectName: 'Untitled',
  activeLayerId: null,
  selection: new Set(),      // "r,c" keys on active layer
  tool: 'pencil',
  brush: { shape: 'square', size: 1, color: '#FFFFFF', opacity: 1, rotation: 0, stroke: defaultStroke(), anim: null },
  styleClipboard: null,
  assets: {},                // id -> { kind: 'image'|'audio', data: dataURL, name }
  ui: {
    zoom: 1, panX: 0, panY: 0,
    playing: true, time: 0,
    theme: 'dark',
    hoverCell: null,
    timelineOpen: true,
    dragPreview: null,        // transient cells preview for line/rect tools
  },
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function emit(what = 'all') { for (const fn of listeners) fn(what); }

// UI-only mutation: no undo, no autosave, optionally silent scopes.
export function setUI(patch, what = 'ui') {
  Object.assign(state.ui, patch);
  emit(what);
}

// Document mutation. fn mutates state.doc in place.
// opts.undo: push snapshot before mutating (default true).
export function updateDoc(fn, { undo = true, what = 'doc' } = {}) {
  if (undo) pushUndo();
  fn(state.doc);
  emit(what);
  scheduleSave();
}

export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

function snapshot() {
  return JSON.stringify({ doc: state.doc, activeLayerId: state.activeLayerId });
}

function restore(snap) {
  const s = JSON.parse(snap);
  state.doc = s.doc;
  state.activeLayerId = s.activeLayerId;
  state.selection = new Set();
  emit('doc');
  scheduleSave();
}

export function activeLayer() {
  return state.doc.layers.find(l => l.id === state.activeLayerId) || state.doc.layers[state.doc.layers.length - 1];
}

// --- assets (images/audio) ---

export function addAsset(kind, data, name = '') {
  const id = uid('asset');
  state.assets[id] = { kind, data, name };
  scheduleSaveAssets();
  return id;
}

export function getAsset(id) {
  return id ? state.assets[id] : null;
}

export function removeAsset(id) {
  delete state.assets[id];
  scheduleSaveAssets();
}

let assetSaveTimer = null;
function scheduleSaveAssets() {
  clearTimeout(assetSaveTimer);
  assetSaveTimer = setTimeout(saveAssetsNow, 400);
}

export function saveAssetsNow() {
  try { localStorage.setItem(ASSETS_KEY, JSON.stringify(state.assets)); } catch (e) { /* quota — ignore */ }
}

// --- persistence ---

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export function saveNow() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeDocOnly()));
  } catch (e) { /* quota — ignore */ }
}

// Lightweight snapshot used for the frequent autosave — no media, stays fast.
function serializeDocOnly() {
  return { version: 1, name: state.projectName, doc: state.doc, activeLayerId: state.activeLayerId };
}

// Full, self-contained project (used by the explicit "Download project" export).
export function serializeProject() {
  return { ...serializeDocOnly(), assets: state.assets };
}

export function loadProject(data) {
  state.doc = migrateDoc(data.doc);
  state.projectName = data.name || 'Untitled';
  state.activeLayerId = data.activeLayerId && state.doc.layers.some(l => l.id === data.activeLayerId)
    ? data.activeLayerId : state.doc.layers[0].id;
  if (data.assets) { state.assets = data.assets; saveAssetsNow(); }
  state.selection = new Set();
  undoStack = []; redoStack = [];
  emit('doc');
  scheduleSave();
}

export function initStore() {
  try {
    const rawAssets = localStorage.getItem(ASSETS_KEY);
    if (rawAssets) state.assets = JSON.parse(rawAssets);
  } catch (e) { /* corrupted — ignore, keep {} */ }
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) { loadProject(JSON.parse(raw)); return; }
  } catch (e) { /* corrupted — fall through */ }
  state.doc = defaultDoc();
  state.activeLayerId = state.doc.layers[0].id;
}

// Used by "New project" — wipes both the doc and the asset store.
export function clearAllStorage() {
  try { localStorage.removeItem(AUTOSAVE_KEY); localStorage.removeItem(ASSETS_KEY); } catch (e) { /* ignore */ }
}
