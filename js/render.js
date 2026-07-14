// The single source of truth for drawing a frame. Used by the live viewport
// AND every exporter, so exports always match the preview.

import { gridSizePx, cellPos, parseKey } from './model.js';
import { evalDot } from './animation.js';
import { getAsset } from './store.js';

// Decoded-image cache, keyed by asset id. Uploaded images are stored as data
// URLs (see imageUtils.js); decoding one into an HTMLImageElement is async
// and not free, so we do it once per asset and reuse the same bitmap for
// every dot/background that references it, every frame — critical for
// staying smooth on low-memory devices when many dots share one image.
const imageCache = new Map();
const pendingDecodes = new Set();

function resolveImage(assetId) {
  if (!assetId) return null;
  let img = imageCache.get(assetId);
  if (img) return img;
  if (pendingDecodes.has(assetId)) return null;
  const asset = getAsset(assetId);
  if (!asset) return null;
  pendingDecodes.add(assetId);
  const im = new Image();
  im.onload = () => { imageCache.set(assetId, im); pendingDecodes.delete(assetId); };
  im.onerror = () => pendingDecodes.delete(assetId);
  im.src = asset.data;
  return null; // not ready this frame — caller falls back gracefully
}

// Draw `img` into the (x,y,w,h) box like CSS `background-size:cover` —
// fills the box, cropping whichever axis overflows, preserving aspect ratio.
function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Background image: cover-fit plus a user-adjustable pan (offsetX/offsetY,
// 0..1 like CSS object-position), zoom, rotation (deg) and opacity.
export function drawBackgroundImage(ctx, img, w, h, cfg = {}) {
  const { offsetX = 0.5, offsetY = 0.5, zoom = 1, rotate = 0, opacity = 1 } = cfg;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  if (rotate) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotate * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
  }
  const scale = Math.max(w / iw, h / ih) * Math.max(0.001, zoom);
  const dw = iw * scale, dh = ih * scale;
  const dx = (w - dw) * offsetX;
  const dy = (h - dh) * offsetY;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

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

// (x,y) top-left of the dot square of side s.
// `stroke`, if given as { enabled, color, width }, outlines the shape in
// addition to filling it. 'ring' is itself an outline-only shape, so an
// extra user stroke isn't applied there (would just double the same line).
// `image`, if given (a decoded HTMLImageElement), is used for shape 'image';
// if not yet ready (still decoding) it falls back to a plain square so
// nothing is drawn broken/missing for a frame or two.
export function drawDotShape(ctx, shape, x, y, s, stroke, image) {
  const applyStroke = () => {
    if (!stroke || !stroke.enabled || stroke.width <= 0) return;
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = stroke.color;
    ctx.stroke();
  };
  switch (shape) {
    case 'image': {
      if (image) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, s, s);
        ctx.clip();
        drawImageCover(ctx, image, x, y, s, s);
        ctx.restore();
        if (stroke && stroke.enabled && stroke.width > 0) {
          ctx.beginPath();
          ctx.rect(x, y, s, s);
          applyStroke();
        }
        break;
      }
      // not decoded yet — fall through to a plain square placeholder
    }
    // eslint-disable-next-line no-fallthrough
    case 'square':
    default:
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.fill();
      applyStroke();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
      applyStroke();
      break;
    case 'rounded': {
      const r = s * 0.28;
      ctx.beginPath();
      ctx.roundRect(x, y, s, s, r);
      ctx.fill();
      applyStroke();
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
      applyStroke();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x, y + s);
      ctx.closePath();
      ctx.fill();
      applyStroke();
      break;
    case 'half-square':
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.closePath();
      ctx.fill();
      applyStroke();
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
      ctx.beginPath();
      ctx.rect(x + t, y, t, s);
      ctx.rect(x, y + t, s, t);
      ctx.fill();
      applyStroke();
      break;
    }
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
  if (doc.grid.bgImage) {
    const bgImg = resolveImage(doc.grid.bgImage.assetId);
    if (bgImg) drawBackgroundImage(ctx, bgImg, w, h, doc.grid.bgImage);
  }

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
      const stroke = v.stroke && v.stroke.enabled
        ? { enabled: true, width: Math.max(0.25, v.stroke.width * v.size), color: hexWithHue(v.stroke.color, v.hue) }
        : null;
      const img = v.shape === 'image' ? resolveImage(v.imageId) : null;
      if (v.rotation) {
        ctx.save();
        ctx.translate(x + cs / 2, y + cs / 2);
        ctx.rotate(v.rotation * Math.PI / 180);
        drawDotShape(ctx, v.shape, -s / 2, -s / 2, s, stroke, img);
        ctx.restore();
      } else {
        drawDotShape(ctx, v.shape, x + off, y + off, s, stroke, img);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
