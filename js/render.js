// The single source of truth for drawing a frame. Used by the live viewport
// AND every exporter, so exports always match the preview.

import { gridSizePx, cellPos, parseKey } from './model.js';
import { evalDot } from './animation.js';

export function hexWithHue(hex, hueDeg) {
  if (!hueDeg) return hex;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + hueDeg / 360) % 1;
  return `hsl(${Math.round(h * 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
}

export function drawDotShape(ctx, shape, x, y, s) {
  // (x,y) top-left of the dot square of side s.
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rounded': {
      const r = s * 0.28;
      ctx.beginPath();
      ctx.roundRect(x, y, s, s, r);
      ctx.fill();
      break;
    }
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y);
      ctx.lineTo(x + s, y + s / 2);
      ctx.lineTo(x + s / 2, y + s);
      ctx.lineTo(x, y + s / 2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x, y + s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'half-square':
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ring': {
      const lw = Math.max(1, s * 0.18);
      ctx.beginPath();
      ctx.lineWidth = lw;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.arc(x + s / 2, y + s / 2, s / 2 - lw / 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'plus': {
      const t = s / 3;
      ctx.fillRect(x + t, y, t, s);
      ctx.fillRect(x, y + t, s, t);
      break;
    }
    case 'square':
    default:
      ctx.fillRect(x, y, s, s);
  }
}

// Render one frame of the document at time t (ms) into ctx.
// opts: { scale, transparent }
export function renderFrame(ctx, doc, t, opts = {}) {
  const { scale = 1, transparent = false } = opts;
  const { w, h } = gridSizePx(doc.grid);

  ctx.save();
  ctx.scale(scale, scale);
  if (transparent) ctx.clearRect(0, 0, w, h);
  else { ctx.fillStyle = doc.grid.bg; ctx.fillRect(0, 0, w, h); }

  const cs = doc.grid.cellSize;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const [k, cell] of Object.entries(layer.cells)) {
      const v = evalDot(k, cell, layer, doc, t);
      if (v.opacity <= 0.002 || v.size <= 0.002) continue;
      const [r, c] = parseKey(k);
      if (r < 0 || c < 0 || r >= doc.grid.rows || c >= doc.grid.cols) continue;
      const { x, y } = cellPos(doc.grid, r, c);
      const s = cs * v.size;
      const off = (cs - s) / 2;
      ctx.globalAlpha = v.opacity;
      ctx.fillStyle = hexWithHue(v.color, v.hue);
      if (v.rotation) {
        ctx.save();
        ctx.translate(x + cs / 2, y + cs / 2);
        ctx.rotate(v.rotation * Math.PI / 180);
        drawDotShape(ctx, v.shape, -s / 2, -s / 2, s);
        ctx.restore();
      } else {
        drawDotShape(ctx, v.shape, x + off, y + off, s);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
