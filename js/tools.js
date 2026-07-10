// Pointer tools: pencil, eraser, line, rect, ellipse, fill, select, text, style eyedropper.

import { state, setUI, updateDoc, pushUndo, emit, activeLayer } from './store.js';
import {
  key, parseKey, defaultCell, copyStyle, pasteStyle, inGrid,
  lineCells, rectCells, ellipseCells, floodCells,
} from './model.js';
import { eventToCell, screenToArtboard } from './viewport.js';
import { toast } from './ui/components.js';
import { rebuildTextLayer } from './textlayer.js';

export const TOOLS = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: '<path d="M4 3l7 17 2.5-7 7-2.5L4 3z"/>' },
  { id: 'pencil', label: 'Pencil', shortcut: 'P', icon: '<path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/>' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: '<path d="M7 21h10M5.5 13.5L13 6l5 5-7.5 7.5a2 2 0 01-2.8 0l-2.2-2.2a2 2 0 010-2.8z"/>' },
  { id: 'line', label: 'Line', shortcut: 'L', icon: '<path d="M5 19L19 5"/>' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: '<rect x="4" y="5" width="16" height="14" rx="1"/>' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: '<ellipse cx="12" cy="12" rx="8" ry="7"/>' },
  { id: 'fill', label: 'Fill', shortcut: 'F', icon: '<path d="M12 3l7 7-8.5 8.5a2 2 0 01-2.8 0L3.5 14a2 2 0 010-2.8L12 3zM19 15s2 2.4 2 4a2 2 0 11-4 0c0-1.6 2-4 2-4z"/>' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>' },
  { id: 'picker', label: 'Copy style (eyedropper)', shortcut: 'I', icon: '<path d="M14 6l4 4M6 18l-2 2M18 4l2 2-3.5 3.5-2-2L18 4zM6 18l8.5-8.5 2 2L8 20l-3 1 1-3z"/>' },
];

let drag = null; // { start:[r,c], last:[r,c], erase, painted:Set }

function paintCell(layer, r, c, erase) {
  const k = key(r, c);
  if (erase) delete layer.cells[k];
  else layer.cells[k] = defaultCell(state.brush);
}

function commitShape(cells, erase) {
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  updateDoc(() => {
    for (const [r, c] of cells) paintCell(layer, r, c, erase);
  });
}

function selectRect(r0, c0, r1, c1, additive) {
  const layer = activeLayer();
  const next = additive ? new Set(state.selection) : new Set();
  for (const [r, c] of rectCells(r0, c0, r1, c1, { filled: true })) {
    const k = key(r, c);
    if (layer.cells[k]) next.add(k);
  }
  state.selection = next;
  emit('selection');
}

export function applyStyleToSelection() {
  if (!state.styleClipboard) { toast('Nothing in style clipboard — copy a dot style first (I tool or ⌥click)'); return; }
  const layer = activeLayer();
  const targets = state.selection.size ? [...state.selection] : Object.keys(layer.cells);
  updateDoc(() => {
    for (const k of targets) if (layer.cells[k]) pasteStyle(layer.cells[k], state.styleClipboard);
  });
  toast(`Style pasted to ${targets.length} dot${targets.length === 1 ? '' : 's'}`);
}

export function copyStyleFromCell(k) {
  const layer = activeLayer();
  const cell = layer.cells[k];
  if (!cell) return false;
  state.styleClipboard = copyStyle(cell);
  // Also make it the active brush so new dots match.
  Object.assign(state.brush, copyStyle(cell));
  emit('brush');
  toast('Dot style copied');
  return true;
}

export function deleteSelection() {
  if (!state.selection.size) return;
  const layer = activeLayer();
  updateDoc(() => { for (const k of state.selection) delete layer.cells[k]; });
  state.selection = new Set();
  emit('selection');
}

export function selectAll() {
  const layer = activeLayer();
  state.selection = new Set(Object.keys(layer.cells));
  emit('selection');
}

export function initTools(canvas) {
  let spaceDown = false;
  let panDrag = null;

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = ''; }
  });

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);

    if (spaceDown || e.button === 1) {
      panDrag = { x: e.clientX, y: e.clientY, panX: state.ui.panX, panY: state.ui.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const layer = activeLayer();
    const hit = eventToCell(e);
    const tool = state.tool;

    // Alt+click anywhere = eyedrop style.
    if (e.altKey && hit) { copyStyleFromCell(key(...hit)); return; }

    if (tool === 'select') {
      const [x, y] = screenToArtboard(e.clientX, e.clientY);
      drag = { mode: 'marquee', additive: e.shiftKey };
      setUI({ marquee: { x0: x, y0: y, x1: x, y1: y } }, 'silent');
      return;
    }

    if (!hit || !layer || layer.locked) return;
    const [r, c] = hit;

    if (layer.type === 'text' && ['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill'].includes(tool)) {
      toast('Text layers are generated from text — edit the text in the inspector, or draw on a dots layer');
      return;
    }

    switch (tool) {
      case 'pencil': case 'eraser': {
        const erase = tool === 'eraser' || (tool === 'pencil' && e.shiftKey && layer.cells[key(r, c)]);
        pushUndo();
        drag = { mode: 'paint', erase, last: [r, c] };
        updateDoc(() => paintCell(layer, r, c, erase), { undo: false });
        break;
      }
      case 'line': case 'rect': case 'ellipse':
        drag = { mode: tool, start: [r, c], erase: e.shiftKey };
        setUI({ dragPreview: { cells: [[r, c]], erase: drag.erase } }, 'silent');
        break;
      case 'fill': {
        const cells = floodCells(state.doc, layer, r, c);
        commitShape(cells, e.shiftKey);
        break;
      }
      case 'picker':
        if (!copyStyleFromCell(key(r, c))) toast('Empty cell — click a dot to copy its style');
        break;
      case 'text':
        setUI({ pendingTextAt: [r, c] });
        emit('request-text-tool');
        break;
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (panDrag) {
      setUI({ panX: panDrag.panX + e.clientX - panDrag.x, panY: panDrag.panY + e.clientY - panDrag.y }, 'silent');
      return;
    }
    const hit = eventToCell(e);
    state.ui.hoverCell = hit;
    updateStatus(hit);

    if (!drag) return;
    const layer = activeLayer();

    if (drag.mode === 'marquee') {
      const [x, y] = screenToArtboard(e.clientX, e.clientY);
      state.ui.marquee.x1 = x; state.ui.marquee.y1 = y;
      return;
    }
    if (!hit) return;
    const [r, c] = hit;

    if (drag.mode === 'paint') {
      if (drag.last[0] === r && drag.last[1] === c) return;
      // Interpolate to avoid gaps on fast strokes.
      const seg = lineCells(drag.last[0], drag.last[1], r, c);
      updateDoc(() => { for (const [rr, cc] of seg) paintCell(layer, rr, cc, drag.erase); }, { undo: false });
      drag.last = [r, c];
    } else if (['line', 'rect', 'ellipse'].includes(drag.mode)) {
      const [r0, c0] = drag.start;
      const cells =
        drag.mode === 'line' ? lineCells(r0, c0, r, c) :
        drag.mode === 'rect' ? rectCells(r0, c0, r, c, { filled: e.ctrlKey || e.metaKey }) :
        ellipseCells(r0, c0, r, c, { filled: e.ctrlKey || e.metaKey });
      setUI({ dragPreview: { cells, erase: drag.erase } }, 'silent');
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (panDrag) { panDrag = null; canvas.style.cursor = spaceDown ? 'grab' : ''; return; }
    if (!drag) return;

    if (drag.mode === 'marquee') {
      const m = state.ui.marquee;
      const g = state.doc.grid;
      const stride = g.cellSize + g.gap;
      const cellAt = (x, y) => [
        Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.gap) / stride))),
        Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.gap) / stride))),
      ];
      const a = cellAt(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
      const b = cellAt(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
      const isClick = Math.abs(m.x1 - m.x0) < 4 && Math.abs(m.y1 - m.y0) < 4;
      if (isClick) {
        const hit = eventToCell(e);
        const layer = activeLayer();
        if (hit && layer.cells[key(...hit)]) {
          const k = key(...hit);
          if (drag.additive) {
            state.selection.has(k) ? state.selection.delete(k) : state.selection.add(k);
          } else state.selection = new Set([k]);
        } else if (!drag.additive) state.selection = new Set();
        emit('selection');
      } else {
        selectRect(a[0], a[1], b[0], b[1], drag.additive);
      }
      setUI({ marquee: null }, 'silent');
    } else if (['line', 'rect', 'ellipse'].includes(drag.mode)) {
      const cells = state.ui.dragPreview?.cells || [];
      setUI({ dragPreview: null }, 'silent');
      commitShape(cells, drag.erase);
    }
    drag = null;
  });

  canvas.addEventListener('pointerleave', () => { state.ui.hoverCell = null; updateStatus(null); });

  window.addEventListener('keydown', onKeydown);
}

function updateStatus(hit) {
  const bar = document.getElementById('statusbar');
  const g = state.doc.grid;
  bar.textContent = hit
    ? `R${hit[0] + 1} C${hit[1] + 1}  ·  ${g.cols}×${g.rows}`
    : `${g.cols}×${g.rows}`;
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

import { undo, redo } from './store.js';

function onKeydown(e) {
  if (isTyping(e)) return;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod && e.altKey && e.code === 'KeyC') {
    e.preventDefault();
    const k = state.selection.size ? [...state.selection][0] : (state.ui.hoverCell ? key(...state.ui.hoverCell) : null);
    if (k) copyStyleFromCell(k);
    return;
  }
  if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); applyStyleToSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); return; }
  if (e.key === 'Escape') { state.selection = new Set(); emit('selection'); return; }

  if (mod || e.altKey) return;
  const tool = TOOLS.find(t => t.shortcut.toLowerCase() === e.key.toLowerCase());
  if (tool) { state.tool = tool.id; emit('tool'); }
}
