// Viewport: canvas sizing, zoom/pan, pointer→cell mapping, RAF render loop,
// editing overlays (empty cell markers, hover, selection, tool previews).

import { state, setUI } from './store.js';
import { gridSizePx, cellPos, pxToCell, parseKey } from './model.js';
import { renderFrame } from './render.js';
import { syncAudio } from './audio.js';

let canvas, ctx, wrap;
let raf = 0;
let lastTs = 0;

export function screenToArtboard(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const { zoom, panX, panY } = state.ui;
  return [(sx - rect.left - panX) / zoom, (sy - rect.top - panY) / zoom];
}

export function eventToCell(e) {
  const [x, y] = screenToArtboard(e.clientX, e.clientY);
  return pxToCell(state.doc.grid, x, y);
}

export function zoomAt(factor, sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const cx = sx - rect.left, cy = sy - rect.top;
  const { zoom, panX, panY } = state.ui;
  const nz = Math.min(8, Math.max(0.1, zoom * factor));
  setUI({
    zoom: nz,
    panX: cx - (cx - panX) * (nz / zoom),
    panY: cy - (cy - panY) * (nz / zoom),
  });
}

export function fitToView() {
  const { w, h } = gridSizePx(state.doc.grid);
  const vw = wrap.clientWidth, vh = wrap.clientHeight;
  const zoom = Math.min(2, Math.min((vw - 96) / w, (vh - 120) / h));
  setUI({ zoom, panX: (vw - w * zoom) / 2, panY: (vh - h * zoom) / 2 - 14 });
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrap.clientWidth * dpr;
  canvas.height = wrap.clientHeight * dpr;
  canvas.style.width = wrap.clientWidth + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
}

function drawOverlays() {
  const { doc } = state;
  const { zoom } = state.ui;
  const cs = doc.grid.cellSize;
  const dark = state.ui.theme === 'dark';

  // Faint markers on empty cells (editing aid, viewport only).
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  const occupied = new Set();
  for (const l of doc.layers) if (l.visible) for (const k of Object.keys(l.cells)) occupied.add(k);
  const markR = Math.max(0.75, cs * 0.05);
  for (let r = 0; r < doc.grid.rows; r++) {
    for (let c = 0; c < doc.grid.cols; c++) {
      if (occupied.has(r + ',' + c)) continue;
      const { x, y } = cellPos(doc.grid, r, c);
      ctx.beginPath();
      ctx.arc(x + cs / 2, y + cs / 2, markR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tool drag preview (line/rect/ellipse) — ghost dots.
  if (state.ui.dragPreview) {
    ctx.fillStyle = state.ui.dragPreview.erase ? 'rgba(255,60,60,0.45)' : 'rgba(255,255,255,0.5)';
    for (const [r, c] of state.ui.dragPreview.cells) {
      const { x, y } = cellPos(doc.grid, r, c);
      ctx.fillRect(x + cs * 0.2, y + cs * 0.2, cs * 0.6, cs * 0.6);
    }
  }

  // Selection.
  if (state.selection.size) {
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 1.5 / zoom;
    for (const k of state.selection) {
      const [r, c] = parseKey(k);
      const { x, y } = cellPos(doc.grid, r, c);
      ctx.strokeRect(x - 1.5, y - 1.5, cs + 3, cs + 3);
    }
  }

  // Marquee rectangle while dragging.
  if (state.ui.marquee) {
    const m = state.ui.marquee;
    ctx.strokeStyle = '#e94560';
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    ctx.setLineDash([]);
  }

  // Hover cell.
  if (state.ui.hoverCell && !state.ui.marquee) {
    const [r, c] = state.ui.hoverCell;
    const { x, y } = cellPos(doc.grid, r, c);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(x, y, cs, cs);
  }
}

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (!state.doc) return;

  const dt = lastTs ? ts - lastTs : 0;
  lastTs = ts;
  if (state.ui.playing) {
    let t = state.ui.time + dt;
    const dur = state.doc.animation.duration;
    if (t > dur) t = state.doc.animation.loop ? t % dur : dur;
    state.ui.time = t;
    // Timeline playhead is DOM — update it cheaply without full emit.
    if (onTick) onTick(t);
  }
  syncAudio(state.doc, state.ui.time, state.ui.playing);

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Pasteboard dotted background.
  drawPasteboard();

  const { zoom, panX, panY } = state.ui;
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Artboard shadow.
  const { w, h } = gridSizePx(state.doc.grid);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 28 / zoom;
  ctx.shadowOffsetY = 6 / zoom;
  ctx.fillStyle = state.doc.grid.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  renderFrame(ctx, state.doc, state.ui.time);
  drawOverlays();
}

function drawPasteboard() {
  const dark = state.ui.theme === 'dark';
  ctx.fillStyle = dark ? '#0e0f13' : '#f4f5f8';
  ctx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight);
  const { zoom, panX, panY } = state.ui;
  const step = 24 * Math.max(0.5, Math.min(2, zoom));
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const ox = ((panX % step) + step) % step;
  const oy = ((panY % step) + step) % step;
  for (let y = oy; y < wrap.clientHeight; y += step)
    for (let x = ox; x < wrap.clientWidth; x += step)
      ctx.fillRect(x, y, 1.2, 1.2);
}

let onTick = null;
export function setTickHandler(fn) { onTick = fn; }

export function initViewport() {
  wrap = document.getElementById('canvas-wrap');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resize();
  new ResizeObserver(() => { resize(); }).observe(wrap);
  fitToView();
  raf = requestAnimationFrame(frame);

  // Zoom (ctrl+wheel or pinch) and pan (wheel / space-drag / middle-drag).
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    } else {
      setUI({ panX: state.ui.panX - e.deltaX, panY: state.ui.panY - e.deltaY });
    }
  }, { passive: false });

  return canvas;
}
