// Left sidebar (tools + layers), right inspector, top bar actions, zoom HUD.

import {
  el, icon, section, row, numInput, slider, colorInput, select, segmented,
  button, iconButton, toast, modal, checkbox,
} from './components.js';
import {
  state, setUI, updateDoc, subscribe, emit, activeLayer,
  undo, redo, serializeProject, loadProject, saveNow,
  addAsset, getAsset, removeAsset, clearAllStorage,
} from '../store.js';
import {
  SHAPES, makeLayer, resizeGrid, uid, defaultGroupAnim, defaultDotAnim, key, defaultStroke,
} from '../model.js';
import { TOOLS, applyStyleToSelection, copyStyleFromCell } from '../tools.js';
import { GROUP_PRESETS, LOOP_PRESETS, DOT_PRESETS, EASING_TYPES, STAGGER_MODES } from '../animation.js';
import { FONTS } from '../fonts.js';
import { rebuildTextLayer, makeTextLayer } from '../textlayer.js';
import { drawDotShape } from '../render.js';
import { fitToView, zoomAt } from '../viewport.js';
import { curvePreview, bezierEditor } from './curve.js';
import { openExportDialog } from '../export/index.js';
import { openBackgroundImageEditor } from './imageEditor.js';
import { downscaleImageFile } from '../imageUtils.js';

const I = {
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 016 6v0a6 6 0 01-6 6h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 00-6 6v0a6 6 0 006 6h3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0112 5c6.5 0 10 7 10 7a17.4 17.4 0 01-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10.7 10.7 0 005.4-1.4M9.9 9.9a3 3 0 104.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.8-1.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  dots: '<circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  file: '<path d="M13 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V9l-6-6zM13 3v6h6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
  paste: '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  fit: '<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/>',
};

// ---------------------------------------------------------------- top bar

function renderTopbar() {
  const box = document.getElementById('topbar-actions');
  box.innerHTML = '';
  box.append(
    iconButton(I.undo, undo, { title: 'Undo (⌘Z)' }),
    iconButton(I.redo, redo, { title: 'Redo (⇧⌘Z)' }),
    el('div', { class: 'w-px h-5 bg-line mx-1' }),
    iconButton(I.file, openProjectMenu, { title: 'Project (save / open / new)' }),
    iconButton(state.ui.theme === 'dark' ? I.sun : I.moon, toggleTheme, { title: 'Toggle theme' }),
    el('div', { class: 'w-px h-5 bg-line mx-1' }),
    button([icon(I.export, 14), 'Export'], () => openExportDialog(), { variant: 'primary' }),
  );

  const name = document.getElementById('project-name');
  name.value = state.projectName;
  name.onchange = e => { state.projectName = e.target.value || 'Untitled'; saveNow(); };
}

function toggleTheme() {
  const next = state.ui.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('light', next === 'light');
  document.documentElement.classList.toggle('dark', next === 'dark');
  setUI({ theme: next });
  renderTopbar();
}

function openProjectMenu() {
  const body = el('div', { class: 'flex flex-col gap-2' },
    button('Download project (.json)', () => {
      const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${state.projectName.replace(/\s+/g, '-')}.dotmatrix.json`);
    }, { variant: 'outline' }),
    button('Open project (.json)', () => {
      const input = el('input', { type: 'file', accept: '.json,application/json' });
      input.onchange = async () => {
        try {
          loadProject(JSON.parse(await input.files[0].text()));
          toast('Project loaded');
          document.getElementById('modal-root').innerHTML = '';
          renderTopbar();
          fitToView();
        } catch (e) { toast('Could not read that file'); }
      };
      input.click();
    }, { variant: 'outline' }),
    button('New project (clears canvas)', () => {
      if (!confirm('Start a new project? Current work is replaced (it stays in your downloads if you saved it).')) return;
      clearAllStorage();
      location.reload();
    }, { variant: 'outline' }),
  );
  modal('Project', body);
}

export function downloadBlob(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- toolbar

function renderToolbar() {
  const box = document.getElementById('toolbar');
  box.innerHTML = '';
  const grid = el('div', { class: 'grid grid-cols-5 gap-1' });
  for (const t of TOOLS) {
    grid.append(el('button', {
      title: `${t.label} (${t.shortcut})`,
      class: 'tool-btn p-2 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-ink-3 flex items-center justify-center transition-colors '
        + (state.tool === t.id ? 'active' : ''),
      onclick: () => { state.tool = t.id; emit('tool'); },
    }, icon(t.icon, 16)));
  }
  box.append(grid);
}

// ---------------------------------------------------------------- layers

function renderLayers() {
  const box = document.getElementById('layers-panel');
  box.innerHTML = '';
  box.append(el('div', { class: 'flex items-center justify-between px-3 pt-3 pb-1.5' },
    el('span', { class: 'text-[11px] font-medium uppercase tracking-wider text-muted' }, 'Layers'),
    el('div', { class: 'flex' },
      iconButton(I.text, () => addLayer('text'), { title: 'Add text layer', size: 13 }),
      iconButton(I.plus, () => addLayer('dots'), { title: 'Add layer', size: 13 }))));

  const list = el('div', { class: 'px-2 pb-2 flex flex-col-reverse gap-[2px]' });
  const clearDropIndicators = () => {
    for (const child of list.children) child.classList.remove('border-t-2', 'border-b-2', 'border-t-accent', 'border-b-accent');
  };

  state.doc.layers.forEach((layer, idx) => {
    const isActive = layer.id === state.activeLayerId;
    const item = el('div', {
      class: 'group flex items-center gap-1.5 px-2 py-[7px] rounded-md cursor-pointer border '
        + (isActive ? 'bg-ink-3 border-line-2' : 'border-transparent hover:bg-ink-3/60'),
      draggable: true,
      onclick: () => { state.activeLayerId = layer.id; state.selection = new Set(); emit('doc'); },
      ondragstart: e => {
        e.dataTransfer.setData('text/plain', String(idx));
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => item.classList.add('opacity-40'), 0);
      },
      ondragend: () => { item.classList.remove('opacity-40'); clearDropIndicators(); },
      ondragover: e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Flip on flex-col-reverse: the upper half of a row visually sits
        // toward a HIGHER array index (rendered first-in-array = bottom).
        const above = (e.clientY - item.getBoundingClientRect().top) < item.offsetHeight / 2;
        clearDropIndicators();
        item.classList.add(above ? 'border-t-2' : 'border-b-2', above ? 'border-t-accent' : 'border-b-accent');
        item.dataset.dropAbove = above ? '1' : '0';
      },
      ondrop: e => {
        e.preventDefault();
        clearDropIndicators();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from)) return;
        const insertAt = item.dataset.dropAbove === '1' ? idx + 1 : idx;
        if (from === insertAt || from + 1 === insertAt) return; // dropped back where it started
        updateDoc(d => {
          const [moved] = d.layers.splice(from, 1);
          const target = from < insertAt ? insertAt - 1 : insertAt;
          d.layers.splice(Math.max(0, Math.min(d.layers.length, target)), 0, moved);
        });
      },
    },
      icon(layer.type === 'text' ? I.text : I.dots, 13),
      el('span', {
        class: 'flex-1 truncate ' + (layer.visible ? '' : 'opacity-40'),
        ondblclick: e => {
          e.stopPropagation();
          const v = prompt('Layer name', layer.name);
          if (v) updateDoc(d => { d.layers[idx].name = v; }, { undo: false });
        },
      }, layer.name),
      layer.groupAnim && layer.groupAnim.preset !== 'none'
        ? el('span', { class: 'text-[9px] px-1 py-[1px] rounded bg-accent-dim text-accent font-mono', title: 'Has animation' }, '~')
        : null,
      el('span', { class: 'flex opacity-0 group-hover:opacity-100 ' + (!layer.visible || layer.locked ? '!opacity-100' : '') },
        iconButton(layer.locked ? I.lock : I.unlock, e => {
          updateDoc(d => { d.layers[idx].locked = !layer.locked; }, { undo: false });
        }, { title: 'Lock', size: 12, class: layer.locked ? 'text-accent' : '' }),
        iconButton(layer.visible ? I.eye : I.eyeOff, () => {
          updateDoc(d => { d.layers[idx].visible = !layer.visible; }, { undo: false });
        }, { title: 'Visibility', size: 12 })),
    );
    list.append(item);
  });
  box.append(list);
}

function addLayer(type) {
  const n = state.doc.layers.length + 1;
  const layer = type === 'text'
    ? makeTextLayer('TEXT', Math.max(0, Math.floor(state.doc.grid.rows / 2) - 3), 1, state.brush)
    : makeLayer(`Layer ${n}`);
  updateDoc(d => d.layers.push(layer));
  state.activeLayerId = layer.id;
  emit('doc');
}

// ---------------------------------------------------------------- inspector

function renderInspector() {
  const box = document.getElementById('inspector');
  box.innerHTML = '';
  const layer = activeLayer();

  box.append(sectionGrid());
  if (layer?.type === 'text') box.append(sectionText(layer));
  box.append(sectionDot(layer));
  box.append(sectionGroupAnim(layer));
  if (layer?.type !== 'text') box.append(sectionDotAnim(layer));
  box.append(sectionLayerMisc(layer));
}

function sectionGrid() {
  const g = state.doc.grid;
  let anchor = state.ui.resizeAnchor || 'tl';

  const anchorPicker = el('div', { class: 'grid grid-cols-3 gap-[3px] w-[54px]' },
    ...['tl', 'tc', 'tr', 'ml', 'mm', 'mr', 'bl', 'bc', 'br'].map(a =>
      el('button', {
        class: 'w-4 h-4 rounded-[3px] border ' + (a === anchor ? 'bg-accent border-accent' : 'bg-ink-3 border-line hover:border-line-2'),
        title: 'Anchor: where existing dots stay when resizing',
        onclick: () => { setUI({ resizeAnchor: a }, 'silent'); renderInspector(); },
      })));

  const bgImage = g.bgImage;
  const bgImageRow = bgImage
    ? el('div', { class: 'flex items-center gap-1.5 w-full' },
        el('img', { src: getAsset(bgImage.assetId)?.data || '', class: 'w-6 h-6 rounded object-cover border border-line' }),
        button('Edit…', () => openBackgroundImageEditor(), { variant: 'outline', class: 'flex-1' }),
        button('Remove', () => {
          updateDoc(d => { d.grid.bgImage = null; });
          removeAsset(bgImage.assetId);
          renderInspector();
        }, { variant: 'outline' }))
    : button('Add background image…', () => openBackgroundImageEditor(), { variant: 'outline', class: 'w-full' });

  return section('Grid',
    row('Columns', numInput(g.cols, v => updateDoc(d => resizeGrid(d, v, d.grid.rows, anchor)), { min: 1, max: 128 })),
    row('Rows', numInput(g.rows, v => updateDoc(d => resizeGrid(d, d.grid.cols, v, anchor)), { min: 1, max: 128 })),
    row('Resize from', anchorPicker),
    row('Dot cell', numInput(g.cellSize, v => updateDoc(d => { d.grid.cellSize = v; }), { min: 2, max: 80, suffix: 'px' })),
    row('Gap', numInput(g.gap, v => updateDoc(d => { d.grid.gap = v; }), { min: 0, max: 60, suffix: 'px' })),
    row('Background', colorInput(g.bg, v => updateDoc(d => { d.grid.bg = v; }, { undo: false }))),
    el('div', { class: 'mt-1' }, bgImageRow),
  );
}

function shapePicker(value, imageId, onSelect, onUploadImage) {
  const grid = el('div', { class: 'grid grid-cols-8 gap-1' });
  for (const shape of SHAPES) {
    const c = el('canvas', { width: 18, height: 18 });
    const cx = c.getContext('2d');
    cx.fillStyle = '#e6e8ee';
    drawDotShape(cx, shape, 2, 2, 14);
    grid.append(el('button', {
      title: shape,
      class: 'p-1 rounded-md border flex items-center justify-center '
        + (shape === value ? 'border-accent bg-accent-dim' : 'border-line bg-ink-3 hover:border-line-2'),
      onclick: () => onSelect(shape),
    }, c));
  }

  const asset = imageId ? getAsset(imageId) : null;
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', class: 'hidden',
    onchange: async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        // Small cap — this is a tiny per-dot shape, not a photo, so keep it
        // light for memory and redraw speed on low-end devices.
        const dataUrl = await downscaleImageFile(file, 128, 0.86);
        onUploadImage(dataUrl);
      } catch { toast('Could not read that image'); }
      e.target.value = '';
    },
  });
  const imageTile = el('button', {
    class: 'flex items-center gap-2 px-2 py-1.5 rounded-md border w-full text-left mt-1.5 '
      + (value === 'image' ? 'border-accent bg-accent-dim' : 'border-line bg-ink-3 hover:border-line-2'),
    onclick: () => fileInput.click(),
  },
    asset ? el('img', { src: asset.data, class: 'w-5 h-5 rounded object-cover' })
      : el('div', { class: 'w-5 h-5 rounded bg-ink-3 border border-line' }),
    el('span', { class: 'text-[11px] text-zinc-300 flex-1' }, asset ? 'Custom image — click to change' : 'Use a custom image…'),
    fileInput);

  return el('div', { class: 'flex flex-col' }, grid, imageTile);
}

// Which cells do brush/style edits apply to?
function targetCells(layer) {
  if (!layer) return [];
  if (state.selection.size) return [...state.selection].filter(k => layer.cells[k]);
  return [];
}

// `live: true` marks a drag-in-progress update: it still writes the real
// value into state.doc/brush (so the canvas — which repaints every rAF frame
// straight from state regardless of any emit — reflects it immediately), but
// it skips the full inspector re-render that a normal commit does. Without
// this, every pixel of a slider/color drag would tear down and rebuild the
// very control being dragged, killing the browser's native drag session.
function applyDotProp(layer, prop, v, { undo = true, live = false } = {}) {
  state.brush[prop] = v;
  const targets = targetCells(layer);
  if (layer?.type === 'text') {
    updateDoc(d => {
      const l = d.layers.find(x => x.id === layer.id);
      l.style[prop] = v;
      for (const cell of Object.values(l.cells)) cell[prop] = v;
    }, { undo, what: live ? 'silent' : 'doc' });
    return;
  }
  if (targets.length) {
    updateDoc(d => {
      const l = d.layers.find(x => x.id === layer.id);
      for (const k of targets) if (l.cells[k]) l.cells[k][prop] = v;
    }, { undo, what: live ? 'silent' : 'doc' });
  } else if (!live) emit('brush');
}

function sectionDot(layer) {
  const sel = state.selection.size;
  const b = sel ? sampleSelection(layer) : (layer?.type === 'text' ? (layer.style || state.brush) : state.brush);

  const hint = el('div', { class: 'text-[11px] text-muted mb-2' },
    layer?.type === 'text' ? 'Applies to all dots of this text layer'
      : sel ? `Editing ${sel} selected dot${sel === 1 ? '' : 's'}`
        : 'Brush for new dots — select dots to restyle them');

  const stroke = b.stroke || defaultStroke();
  const setStroke = (patch, opts) => applyDotProp(layer, 'stroke', { ...stroke, ...patch }, opts);

  const body = [
    hint,
    el('div', { class: 'mb-2.5' }, shapePicker(b.shape, b.imageId, v => { applyDotProp(layer, 'shape', v); renderInspector(); }, dataUrl => {
      const id = addAsset('image', dataUrl);
      applyDotProp(layer, 'shape', 'image');
      applyDotProp(layer, 'imageId', id);
      renderInspector();
    })),
    row('Size', slider(b.size, v => applyDotProp(layer, 'size', v), { min: 0.1, max: 1.5, oninput: v => applyDotProp(layer, 'size', v, { undo: false, live: true }) })),
    row('Color', colorInput(b.color, v => applyDotProp(layer, 'color', v), { oninput: v => applyDotProp(layer, 'color', v, { undo: false, live: true }) })),
    row('Opacity', slider(b.opacity, v => applyDotProp(layer, 'opacity', v), { oninput: v => applyDotProp(layer, 'opacity', v, { undo: false, live: true }) })),
    row('Rotation', slider(b.rotation, v => applyDotProp(layer, 'rotation', v), { min: 0, max: 360, step: 1, oninput: v => applyDotProp(layer, 'rotation', v, { undo: false, live: true }) })),
    row('Stroke', checkbox(stroke.enabled, v => { setStroke({ enabled: v }); renderInspector(); })),
  ];

  if (stroke.enabled) {
    body.push(
      row('Stroke width', slider(stroke.width, v => setStroke({ width: v }), { min: 0.5, max: 12, step: 0.5, oninput: v => setStroke({ width: v }, { undo: false, live: true }) })),
      row('Stroke color', colorInput(stroke.color, v => setStroke({ color: v }), { oninput: v => setStroke({ color: v }, { undo: false, live: true }) })),
    );
  }

  body.push(el('div', { class: 'flex gap-1.5 mt-2.5' },
    button([icon(I.copy, 13), 'Copy style'], () => {
      const k = state.selection.size ? [...state.selection][0] : null;
      if (k) copyStyleFromCell(k);
      else { state.styleClipboard = JSON.parse(JSON.stringify(state.brush)); toast('Brush style copied'); }
    }, { variant: 'outline', class: 'flex-1' }),
    button([icon(I.paste, 13), 'Paste style'], applyStyleToSelection, { variant: 'outline', class: 'flex-1' })));

  return section('Dot', ...body);
}

function sampleSelection(layer) {
  const k = [...state.selection][0];
  return (layer && layer.cells[k]) || state.brush;
}

function sectionText(layer) {
  const t = layer.text;
  const update = (fn, opts) => updateDoc(d => {
    const l = d.layers.find(x => x.id === layer.id);
    fn(l.text, l);
    rebuildTextLayer(l, state.brush);
  }, opts);

  return section('Text',
    el('textarea', {
      class: 'w-full bg-ink-3 border border-line rounded px-2 py-1.5 font-mono text-[12px] outline-none focus:border-line-2 resize-none mb-2',
      rows: 2, spellcheck: false,
      onchange: e => update(tt => { tt.content = e.target.value; }),
    }, t.content),
    row('Font', select(t.font, Object.entries(FONTS).map(([k, f]) => [k, f.label]), v => { update(tt => { tt.font = v; }); renderInspector(); })),
    row('Tracking', numInput(t.tracking, v => update(tt => { tt.tracking = v; }), { min: 0, max: 8 })),
    row('Row', numInput(t.row, v => update(tt => { tt.row = v; }), { min: -50, max: 200 })),
    row('Column', numInput(t.col, v => update(tt => { tt.col = v; }), { min: -50, max: 200 })),
  );
}

function easingControls(easing, onchange) {
  const wrap = el('div', {});
  const rebuild = () => {
    wrap.innerHTML = '';
    wrap.append(row('Easing', select(easing.type, EASING_TYPES, v => {
      easing.type = v;
      if (v === 'bezier' && !easing.bezier) easing.bezier = [0.4, 0, 0.2, 1];
      if (v === 'spring' && !easing.spring) easing.spring = { stiffness: 140, damping: 11, mass: 1 };
      onchange(easing);
      rebuild();
    })));
    if (easing.type === 'bezier') {
      wrap.append(bezierEditor(easing.bezier, bz => { easing.bezier = bz; onchange(easing); rebuild(); }));
    } else if (easing.type === 'spring') {
      const s = easing.spring;
      const commit = () => { onchange(easing); rebuild(); };
      wrap.append(
        row('Stiffness', slider(s.stiffness, v => { s.stiffness = v; commit(); }, { min: 10, max: 400, step: 1 })),
        row('Damping', slider(s.damping, v => { s.damping = v; commit(); }, { min: 1, max: 60, step: 0.5 })),
        row('Mass', slider(s.mass, v => { s.mass = v; commit(); }, { min: 0.2, max: 6, step: 0.1 })),
        curvePreview(easing),
      );
    } else {
      wrap.append(curvePreview(easing));
    }
  };
  rebuild();
  return wrap;
}

function sectionGroupAnim(layer) {
  if (!layer) return el('div');
  const a = layer.groupAnim;
  const update = (fn, opts = {}) => updateDoc(d => {
    const l = d.layers.find(x => x.id === layer.id);
    fn(l);
  }, { undo: false, ...opts });

  const body = [];
  body.push(row('Preset', select(a?.preset || 'none', GROUP_PRESETS, v => {
    update(l => {
      if (v === 'none') l.groupAnim = null;
      else if (!l.groupAnim) l.groupAnim = defaultGroupAnim(v);
      else l.groupAnim.preset = v;
      if (l.type === 'text' && l.groupAnim && ['typewriter', 'fade-in', 'vanish'].includes(v)) {
        l.groupAnim.stagger.mode = 'char';
        l.groupAnim.stagger.amount = v === 'typewriter' ? 120 : 60;
      }
    }, { undo: true });
    renderInspector();
  })));

  if (a && a.preset !== 'none') {
    const isLoop = LOOP_PRESETS.has(a.preset);
    if (isLoop) {
      body.push(
        row('Period', numInput(a.loopPeriod / 1000, v => update(l => { l.groupAnim.loopPeriod = v * 1000; }), { min: 0.1, max: 20, step: 0.1, suffix: 's' })),
        row('Intensity', slider(a.intensity ?? 0.5, v => update(l => { l.groupAnim.intensity = v; }), {
          oninput: v => update(l => { l.groupAnim.intensity = v; }, { what: 'silent' }),
        })),
      );
    } else {
      body.push(
        row('Delay', numInput(a.delay / 1000, v => update(l => { l.groupAnim.delay = v * 1000; }), { min: 0, max: 30, step: 0.1, suffix: 's' })),
        row('Duration', numInput(a.duration / 1000, v => update(l => { l.groupAnim.duration = v * 1000; }), { min: 0.05, max: 30, step: 0.1, suffix: 's' })),
      );
    }
    body.push(row('Stagger', select(a.stagger.mode, STAGGER_MODES, v => { update(l => { l.groupAnim.stagger.mode = v; }); renderInspector(); })));
    body.push(row('Amount', numInput(a.stagger.amount, v => update(l => { l.groupAnim.stagger.amount = v; }), { min: 0, max: 2000, suffix: 'ms' })));
    if (a.stagger.mode === 'distance') {
      body.push(
        row('Origin row', numInput(a.stagger.originR ?? 0, v => update(l => { l.groupAnim.stagger.originR = v; }), { min: 0, max: 200 })),
        row('Origin col', numInput(a.stagger.originC ?? 0, v => update(l => { l.groupAnim.stagger.originC = v; }), { min: 0, max: 200 })),
      );
    }
    if (!isLoop) body.push(easingControls(a.easing, () => update(() => {})));
  }

  return section('Layer animation', ...body);
}

function sectionDotAnim(layer) {
  if (!layer) return el('div');
  const sel = [...state.selection].filter(k => layer.cells[k]);
  const source = sel.length ? layer.cells[sel[0]].anim : state.brush.anim;
  const a = source;

  const setAnim = (fn, { live = false } = {}) => {
    if (sel.length) {
      updateDoc(d => {
        const l = d.layers.find(x => x.id === layer.id);
        for (const k of sel) if (l.cells[k]) fn(l.cells[k]);
      }, { undo: !live, what: live ? 'silent' : 'doc' });
    } else {
      fn(state.brush);
      if (!live) emit('brush');
    }
    if (!live) renderInspector();
  };

  const body = [
    el('div', { class: 'text-[11px] text-muted mb-2' },
      sel.length ? `Per-dot animation for ${sel.length} selected` : 'Per-dot animation for the brush (new dots)'),
    row('Preset', select(a?.preset || 'none', DOT_PRESETS, v => {
      setAnim(target => {
        if (v === 'none') target.anim = null;
        else if (!target.anim) target.anim = defaultDotAnim(v);
        else target.anim.preset = v;
      });
    })),
  ];

  if (a && a.preset !== 'none') {
    body.push(
      row('Period', numInput(a.period / 1000, v => setAnim(t => { t.anim.period = v * 1000; }), { min: 0.08, max: 20, step: 0.05, suffix: 's' })),
      row('Delay', numInput(a.delay / 1000, v => setAnim(t => { t.anim.delay = v * 1000; }), { min: 0, max: 20, step: 0.05, suffix: 's' })),
      row('Intensity', slider(a.intensity ?? 0.5, v => setAnim(t => { t.anim.intensity = v; }), {
        oninput: v => setAnim(t => { t.anim.intensity = v; }, { live: true }),
      })),
      easingControls(a.easing, () => setAnim(() => {})),
    );
  }

  return section('Dot animation', ...body);
}

function sectionLayerMisc(layer) {
  if (!layer) return el('div');
  return section('Layer',
    row('Opacity', slider(layer.opacity, v => updateDoc(d => { d.layers.find(x => x.id === layer.id).opacity = v; }),
      { oninput: v => updateDoc(d => { d.layers.find(x => x.id === layer.id).opacity = v; }, { undo: false, what: 'silent' }) })),
    el('div', { class: 'flex gap-1.5 mt-1' },
      button('Duplicate', () => {
        const copy = JSON.parse(JSON.stringify(layer));
        copy.id = uid('layer');
        copy.name = layer.name + ' copy';
        updateDoc(d => d.layers.push(copy));
        state.activeLayerId = copy.id;
        emit('doc');
      }, { variant: 'outline', class: 'flex-1' }),
      button([icon(I.trash, 13), 'Delete'], () => {
        if (state.doc.layers.length === 1) { toast('Cannot delete the only layer'); return; }
        updateDoc(d => { d.layers = d.layers.filter(l => l.id !== layer.id); });
        state.activeLayerId = state.doc.layers[state.doc.layers.length - 1].id;
        emit('doc');
      }, { variant: 'outline', class: 'flex-1' })),
  );
}

// ---------------------------------------------------------------- zoom HUD

function renderZoomHud() {
  const box = document.getElementById('zoom-hud');
  box.innerHTML = '';
  const center = () => {
    const wrapEl = document.getElementById('canvas-wrap');
    return [wrapEl.clientWidth / 2 + wrapEl.getBoundingClientRect().left, wrapEl.clientHeight / 2 + wrapEl.getBoundingClientRect().top];
  };
  box.append(
    el('button', { class: 'px-1.5 py-0.5 rounded text-muted hover:text-zinc-200 hover:bg-ink-3 font-mono text-[12px]', onclick: () => zoomAt(1 / 1.25, ...center()) }, '−'),
    el('button', {
      class: 'px-1.5 py-0.5 rounded text-muted hover:text-zinc-200 hover:bg-ink-3 font-mono text-[11px] w-[52px]',
      title: 'Fit to view',
      onclick: () => { fitToView(); renderZoomHud(); },
    }, Math.round(state.ui.zoom * 100) + '%'),
    el('button', { class: 'px-1.5 py-0.5 rounded text-muted hover:text-zinc-200 hover:bg-ink-3 font-mono text-[12px]', onclick: () => zoomAt(1.25, ...center()) }, '+'),
    iconButton(I.fit, () => fitToView(), { title: 'Fit (Shift+1)', size: 13 }),
  );
}

// ---------------------------------------------------------------- wire-up

export function initPanels() {
  renderTopbar();
  renderToolbar();
  renderLayers();
  renderInspector();
  renderZoomHud();

  subscribe(what => {
    if (what === 'tool') renderToolbar();
    if (what === 'doc') { renderLayers(); renderInspector(); }
    if (what === 'selection' || what === 'brush') renderInspector();
    if (what === 'ui') renderZoomHud();
    if (what === 'request-text-tool') openTextPlacement();
  });

  window.addEventListener('keydown', e => {
    if (e.shiftKey && e.key === '!') { fitToView(); renderZoomHud(); }
  });
}

function openTextPlacement() {
  const at = state.ui.pendingTextAt || [1, 1];
  let value = 'HELLO';
  const input = el('input', {
    type: 'text', value, spellcheck: false,
    class: 'w-full bg-ink-3 border border-line rounded px-2 py-2 font-mono text-[13px] outline-none focus:border-accent uppercase',
    oninput: e => { value = e.target.value; },
    onkeydown: e => { if (e.key === 'Enter') confirm(); },
  });
  const close = modal('Add text', el('div', {},
    el('div', { class: 'text-[11px] text-muted mb-2' }, `Placed at row ${at[0] + 1}, column ${at[1] + 1} as a new text layer`),
    input,
  ), {
    actions: [
      button('Cancel', () => close(), { variant: 'outline' }),
      button('Add', () => confirm(), { variant: 'primary' }),
    ],
  });
  function confirm() {
    if (!value.trim()) { close(); return; }
    const layer = makeTextLayer(value, at[0], at[1], state.brush);
    updateDoc(d => d.layers.push(layer));
    state.activeLayerId = layer.id;
    state.tool = 'select';
    close();
    emit('doc');
    emit('tool');
  }
  setTimeout(() => { input.focus(); input.select(); }, 30);
}
