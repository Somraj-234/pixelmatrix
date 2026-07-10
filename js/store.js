// Central store: state, dispatch, undo/redo, autosave.

import { defaultDoc, migrateDoc } from './model.js';

const AUTOSAVE_KEY = 'dotmatrix.project.v1';
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
  brush: { shape: 'square', size: 1, color: '#FFFFFF', opacity: 1, rotation: 0, anim: null },
  styleClipboard: null,
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

// --- persistence ---

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export function saveNow() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
  } catch (e) { /* quota — ignore */ }
}

export function serializeProject() {
  return { version: 1, name: state.projectName, doc: state.doc, activeLayerId: state.activeLayerId };
}

export function loadProject(data) {
  state.doc = migrateDoc(data.doc);
  state.projectName = data.name || 'Untitled';
  state.activeLayerId = data.activeLayerId && state.doc.layers.some(l => l.id === data.activeLayerId)
    ? data.activeLayerId : state.doc.layers[0].id;
  state.selection = new Set();
  undoStack = []; redoStack = [];
  emit('doc');
  scheduleSave();
}

export function initStore() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) { loadProject(JSON.parse(raw)); return; }
  } catch (e) { /* corrupted — fall through */ }
  state.doc = defaultDoc();
  state.activeLayerId = state.doc.layers[0].id;
}
