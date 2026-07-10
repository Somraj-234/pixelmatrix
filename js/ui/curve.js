// Easing curve editor: draggable cubic-bezier handles + spring parameter preview.

import { el } from './components.js';
import { getEase } from '../animation.js';

// Draw an easing function preview into a small canvas.
export function curvePreview(easing, { width = 232, height = 96 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = el('canvas', {
    class: 'rounded border border-line bg-ink-3 w-full',
    style: `height:${height}px`,
  });
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = 10;
  const fn = getEase(easing);

  // Springs overshoot: give the y-axis headroom.
  let minV = 0, maxV = 1;
  const samples = [];
  for (let i = 0; i <= 120; i++) {
    const v = fn(i / 120);
    samples.push(v);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const range = Math.max(1.05, maxV - minV + 0.05);
  const toY = v => height - pad - ((v - minV) / range) * (height - 2 * pad);
  const toX = u => pad + u * (width - 2 * pad);

  // Baselines at 0 and 1.
  ctx.strokeStyle = 'rgba(139,144,160,0.25)';
  ctx.lineWidth = 1;
  for (const v of [0, 1]) {
    ctx.beginPath(); ctx.moveTo(pad, toY(v)); ctx.lineTo(width - pad, toY(v)); ctx.stroke();
  }

  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  samples.forEach((v, i) => {
    const x = toX(i / 120), y = toY(v);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();

  return canvas;
}

// Interactive bezier editor. onchange([x1,y1,x2,y2]) fires on drag end.
export function bezierEditor(bezier, onchange, { width = 232, height = 140 } = {}) {
  let [x1, y1, x2, y2] = bezier || [0.4, 0, 0.2, 1];
  const dpr = window.devicePixelRatio || 1;
  const canvas = el('canvas', {
    class: 'rounded border border-line bg-ink-3 w-full cursor-crosshair',
    style: `height:${height}px; touch-action:none;`,
  });
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = 14;
  const gw = width - 2 * pad, gh = height - 2 * pad;
  const toPx = (x, y) => [pad + x * gw, height - pad - y * gh];
  const fromPx = (px, py) => [
    Math.min(1, Math.max(0, (px - pad) / gw)),
    Math.min(1.6, Math.max(-0.6, (height - pad - py) / gh)),
  ];

  function draw() {
    ctx.clearRect(0, 0, width, height);
    // frame
    ctx.strokeStyle = 'rgba(139,144,160,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(...toPx(0, 1), gw, gh);
    // handle lines
    const [p0x, p0y] = toPx(0, 0), [p3x, p3y] = toPx(1, 1);
    const [h1x, h1y] = toPx(x1, y1), [h2x, h2y] = toPx(x2, y2);
    ctx.strokeStyle = 'rgba(139,144,160,0.6)';
    ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(h1x, h1y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p3x, p3y); ctx.lineTo(h2x, h2y); ctx.stroke();
    // curve
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.bezierCurveTo(h1x, h1y, h2x, h2y, p3x, p3y);
    ctx.stroke();
    // handles
    for (const [hx, hy] of [[h1x, h1y], [h2x, h2y]]) {
      ctx.fillStyle = '#e6e8ee';
      ctx.strokeStyle = '#e94560';
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  draw();

  let dragging = 0; // 1 or 2
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const [h1x, h1y] = toPx(x1, y1), [h2x, h2y] = toPx(x2, y2);
    const d1 = Math.hypot(px - h1x, py - h1y), d2 = Math.hypot(px - h2x, py - h2y);
    dragging = d1 < d2 ? 1 : 2;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = canvas.getBoundingClientRect();
    const [x, y] = fromPx(e.clientX - r.left, e.clientY - r.top);
    if (dragging === 1) { x1 = x; y1 = y; } else { x2 = x; y2 = y; }
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = 0;
    onchange([round2(x1), round2(y1), round2(x2), round2(y2)]);
  });

  const readout = el('div', { class: 'font-mono text-[11px] text-muted mt-1 text-center' },
    `cubic-bezier(${[x1, y1, x2, y2].map(round2).join(', ')})`);

  return el('div', {}, canvas, readout);
}

function round2(v) { return Math.round(v * 100) / 100; }
