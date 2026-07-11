// Document model: grid, layers, cells, grid migration, style copy/paste.

let idCounter = 0;
export function uid(prefix = 'id') { return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`; }

export const SHAPES = [
  'square', 'circle', 'rounded', 'diamond', 'triangle',
  'half-square', 'ring', 'plus',
];

export function defaultStroke() {
  return { enabled: false, color: '#000000', width: 2 };
}

export function defaultCell(brush) {
  return {
    shape: brush?.shape ?? 'square',
    size: brush?.size ?? 1,
    color: brush?.color ?? '#FFFFFF',
    opacity: brush?.opacity ?? 1,
    rotation: brush?.rotation ?? 0,
    stroke: brush?.stroke ? JSON.parse(JSON.stringify(brush.stroke)) : defaultStroke(),
    anim: brush?.anim ? JSON.parse(JSON.stringify(brush.anim)) : null,
  };
}

export function makeLayer(name, type = 'dots') {
  const layer = {
    id: uid('layer'), name, type,
    visible: true, locked: false, opacity: 1,
    cells: {},           // "r,c" -> cell
    groupAnim: null,     // { preset, delay, duration, easing, stagger, loopPeriod }
  };
  if (type === 'text') {
    layer.text = { content: 'HELLO', font: '5x7', tracking: 1, row: 1, col: 1 };
  }
  return layer;
}

export function defaultGroupAnim(preset = 'fade-in') {
  return {
    preset,
    delay: 0,
    duration: 1200,
    easing: { type: 'ease-out' },   // {type, bezier:[x1,y1,x2,y2], spring:{stiffness,damping,mass}}
    stagger: { mode: 'index', amount: 30, originR: 0, originC: 0 },
    loopPeriod: 1600,               // for looping presets
    intensity: 0.5,
  };
}

export function defaultDotAnim(preset = 'pulse') {
  return {
    preset,                          // pulse | blink | fade | bounce | hue
    delay: 0,
    period: 1000,
    easing: { type: 'ease-in-out' },
    intensity: 0.5,
  };
}

export function defaultDoc() {
  const doc = {
    grid: { cols: 24, rows: 24, cellSize: 20, gap: 8, bg: '#0D63F8' },
    layers: [makeLayer('Layer 1')],
    animation: { duration: 3000, fps: 30, loop: true },
  };
  // Seed a small starter mark so the canvas isn't empty.
  const seed = ['5,5', '5,6', '6,5', '7,7', '7,8', '8,7', '8,8'];
  for (const k of seed) doc.layers[0].cells[k] = defaultCell();
  return doc;
}

export function migrateDoc(doc) {
  // Forward-compat hook; currently v1 passthrough with defaults filled.
  doc.grid = { cols: 24, rows: 24, cellSize: 20, gap: 8, bg: '#0D63F8', ...doc.grid };
  doc.animation = { duration: 3000, fps: 30, loop: true, ...doc.animation };
  doc.layers = (doc.layers?.length ? doc.layers : [makeLayer('Layer 1')]).map(l => ({
    visible: true, locked: false, opacity: 1, cells: {}, groupAnim: null, type: 'dots', ...l,
  }));
  // Backfill stroke on cells/styles saved before that field existed.
  for (const l of doc.layers) {
    for (const cell of Object.values(l.cells)) if (!cell.stroke) cell.stroke = defaultStroke();
    if (l.style && !l.style.stroke) l.style.stroke = defaultStroke();
  }
  return doc;
}

export function key(r, c) { return r + ',' + c; }
export function parseKey(k) { const [r, c] = k.split(','); return [+r, +c]; }

export function inGrid(doc, r, c) {
  return r >= 0 && c >= 0 && r < doc.grid.rows && c < doc.grid.cols;
}

// Resize the grid, shifting existing cells according to anchor ('tl','tc','tr','ml','mm','mr','bl','bc','br').
export function resizeGrid(doc, cols, rows, anchor = 'tl') {
  const dc = cols - doc.grid.cols;
  const dr = rows - doc.grid.rows;
  const offC = anchor.includes('l') || anchor === 'tl' ? 0 : anchor.includes('r') ? dc : Math.round(dc / 2);
  const offR = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? dr : Math.round(dr / 2);
  for (const layer of doc.layers) {
    const next = {};
    for (const [k, cell] of Object.entries(layer.cells)) {
      const [r, c] = parseKey(k);
      const nr = r + offR, nc = c + offC;
      if (nr >= 0 && nc >= 0 && nr < rows && nc < cols) next[key(nr, nc)] = cell;
    }
    layer.cells = next;
    if (layer.type === 'text' && layer.text) {
      layer.text.row += offR; layer.text.col += offC;
    }
  }
  doc.grid.cols = cols;
  doc.grid.rows = rows;
}

// Copy the style (all visual props + anim) of one cell.
export function copyStyle(cell) {
  const { shape, size, color, opacity, rotation, stroke, anim } = cell;
  return JSON.parse(JSON.stringify({ shape, size, color, opacity, rotation, stroke, anim }));
}

// Paste a copied style onto a cell, keeping its position/char index.
export function pasteStyle(cell, style) {
  Object.assign(cell, JSON.parse(JSON.stringify(style)));
}

// Grid pixel dimensions.
export function gridSizePx(grid) {
  return {
    w: grid.cols * grid.cellSize + (grid.cols + 1) * grid.gap,
    h: grid.rows * grid.cellSize + (grid.rows + 1) * grid.gap,
  };
}

// Cell top-left position in artboard px.
export function cellPos(grid, r, c) {
  return {
    x: grid.gap + c * (grid.cellSize + grid.gap),
    y: grid.gap + r * (grid.cellSize + grid.gap),
  };
}

// Artboard px -> cell coords (or null if in a gap / outside).
export function pxToCell(grid, x, y, { snapToNearest = true } = {}) {
  const stride = grid.cellSize + grid.gap;
  const c = Math.floor((x - grid.gap) / stride);
  const r = Math.floor((y - grid.gap) / stride);
  if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return null;
  if (!snapToNearest) {
    const lx = x - grid.gap - c * stride, ly = y - grid.gap - r * stride;
    if (lx > grid.cellSize || ly > grid.cellSize) return null;
  }
  return [r, c];
}

// Bresenham line between cells.
export function lineCells(r0, c0, r1, c1) {
  const out = [];
  let dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dc - dr;
  let r = r0, c = c0;
  while (true) {
    out.push([r, c]);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
  }
  return out;
}

export function rectCells(r0, c0, r1, c1, { filled = false } = {}) {
  const rmin = Math.min(r0, r1), rmax = Math.max(r0, r1);
  const cmin = Math.min(c0, c1), cmax = Math.max(c0, c1);
  const out = [];
  for (let r = rmin; r <= rmax; r++)
    for (let c = cmin; c <= cmax; c++)
      if (filled || r === rmin || r === rmax || c === cmin || c === cmax) out.push([r, c]);
  return out;
}

export function ellipseCells(r0, c0, r1, c1, { filled = false } = {}) {
  const rmin = Math.min(r0, r1), rmax = Math.max(r0, r1);
  const cmin = Math.min(c0, c1), cmax = Math.max(c0, c1);
  const cy = (rmin + rmax) / 2, cx = (cmin + cmax) / 2;
  const ry = Math.max(0.5, (rmax - rmin) / 2), rx = Math.max(0.5, (cmax - cmin) / 2);
  const out = [];
  for (let r = rmin; r <= rmax; r++) {
    for (let c = cmin; c <= cmax; c++) {
      const d = ((r - cy) / ry) ** 2 + ((c - cx) / rx) ** 2;
      const inside = d <= 1.0;
      if (filled ? inside : (inside && d >= 1 - 1.6 / Math.max(rx, ry))) out.push([r, c]);
    }
  }
  return out;
}

// Flood fill contiguous same-state (on/off) region; returns cell coords list.
export function floodCells(doc, layer, r0, c0) {
  const startOn = !!layer.cells[key(r0, c0)];
  const seen = new Set();
  const stack = [[r0, c0]];
  const out = [];
  while (stack.length) {
    const [r, c] = stack.pop();
    const k = key(r, c);
    if (seen.has(k) || !inGrid(doc, r, c)) continue;
    if (!!layer.cells[k] !== startOn) continue;
    seen.add(k);
    out.push([r, c]);
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return out;
}