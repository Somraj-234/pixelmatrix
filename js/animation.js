// Animation engine: easings (incl. cubic-bezier + analytic spring), stagger,
// group presets (enter + looping), per-dot looping animations, evalDot.

import { parseKey } from './model.js';

// ---------- easings ----------

const clamp01 = v => Math.min(1, Math.max(0, v));

function cubicBezier(x1, y1, x2, y2) {
  // Solve x(t)=u for t via Newton + bisection fallback, return y(t).
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  const sampleY = t => ((ay * t + by) * t + cy) * t;
  const sampleDX = t => (3 * ax * t + 2 * bx) * t + cx;
  return u => {
    u = clamp01(u);
    let t = u;
    for (let i = 0; i < 6; i++) {
      const x = sampleX(t) - u;
      if (Math.abs(x) < 1e-5) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    let lo = 0, hi = 1;
    t = u;
    while (hi - lo > 1e-5) {
      if (sampleX(t) < u) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

// Analytic damped spring, normalized: returns position 0→~1 over u∈[0,1],
// where u=1 corresponds to the settle time. Deterministic for scrubbing.
export function springEase({ stiffness = 120, damping = 12, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  // settle time: envelope e^(-zeta*w0*t) < 0.001
  const settle = zeta > 0 ? Math.min(20, -Math.log(0.001) / (Math.max(zeta, 0.05) * w0)) : 10;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return u => {
      const t = clamp01(u) * settle;
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
    };
  }
  // critically/over-damped
  return u => {
    const t = clamp01(u) * settle;
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
}

const NAMED = {
  'linear': u => u,
  'ease': cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': u => u * u * u,
  'ease-out': u => 1 - Math.pow(1 - u, 3),
  'ease-in-out': u => u < 0.5 ? 4 * u ** 3 : 1 - Math.pow(-2 * u + 2, 3) / 2,
  'step': u => u >= 1 ? 1 : u <= 0 ? 0 : (u >= 0.5 ? 1 : 0),
};

const easeCache = new Map();
export function getEase(easing) {
  if (!easing) return NAMED['ease-out'];
  if (easing.type === 'bezier' && easing.bezier) {
    const k = 'b' + easing.bezier.join(',');
    if (!easeCache.has(k)) easeCache.set(k, cubicBezier(...easing.bezier));
    return easeCache.get(k);
  }
  if (easing.type === 'spring') {
    const s = easing.spring || {};
    const k = `s${s.stiffness},${s.damping},${s.mass}`;
    if (!easeCache.has(k)) easeCache.set(k, springEase(s));
    return easeCache.get(k);
  }
  return NAMED[easing.type] || NAMED['ease-out'];
}

export const EASING_TYPES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step', 'bezier', 'spring'];

// ---------- stagger ----------

// Deterministic pseudo-random from a cell key.
function hash01(k) {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export const STAGGER_MODES = ['index', 'row', 'col', 'distance', 'random', 'char'];

export function staggerDelay(k, cell, stagger, grid) {
  if (!stagger || !stagger.amount) return 0;
  const [r, c] = parseKey(k);
  const a = stagger.amount;
  switch (stagger.mode) {
    case 'row': return r * a;
    case 'col': return c * a;
    case 'distance': {
      const dr = r - (stagger.originR ?? 0), dc = c - (stagger.originC ?? 0);
      return Math.hypot(dr, dc) * a;
    }
    case 'random': return hash01(k) * a * 10;
    case 'char': return (cell.ci ?? (r * grid.cols + c)) * a;
    case 'index':
    default: return (r * grid.cols + c) * (a / 4);
  }
}

// ---------- presets ----------

export const GROUP_PRESETS = [
  ['none', 'None'],
  ['fade-in', 'Fade in'],
  ['scale-in', 'Scale in'],
  ['spring-in', 'Spring in'],
  ['typewriter', 'Typewriter'],
  ['vanish', 'Vanish'],
  ['dissolve', 'Dissolve'],
  ['wipe', 'Wipe (scanline)'],
  ['wave', 'Wave ∿'],
  ['ripple', 'Ripple ∿'],
  ['sparkle', 'Sparkle ∿'],
  ['breathe', 'Breathe ∿'],
];
export const LOOP_PRESETS = new Set(['wave', 'ripple', 'sparkle', 'breathe']);

export const DOT_PRESETS = [
  ['none', 'None'],
  ['pulse', 'Pulse'],
  ['blink', 'Blink'],
  ['fade', 'Fade'],
  ['bounce', 'Bounce'],
  ['hue', 'Hue shift'],
];

// Group animation → multipliers for one cell at time t (ms).
function evalGroup(anim, k, cell, grid, t) {
  const out = { opacity: 1, size: 1, hue: 0 };
  if (!anim || anim.preset === 'none') return out;

  if (LOOP_PRESETS.has(anim.preset)) {
    const period = Math.max(100, anim.loopPeriod || 1600);
    const sd = staggerDelay(k, cell, anim.stagger, grid);
    const phase = ((t - sd) / period) * Math.PI * 2;
    const amt = anim.intensity ?? 0.5;
    switch (anim.preset) {
      case 'wave': out.size = 1 - amt * 0.5 * (1 + Math.sin(phase)) * 0.9; break;
      case 'ripple': out.opacity = 1 - amt * 0.5 * (1 + Math.sin(phase)); break;
      case 'sparkle': {
        const rph = hash01(k) * Math.PI * 2;
        const v = Math.sin(t / period * Math.PI * 2 + rph);
        out.opacity = 1 - amt * (v > 0.6 ? 0 : 0.85);
        break;
      }
      case 'breathe': {
        const v = 0.5 * (1 + Math.sin(phase));
        out.size = 1 - amt * 0.35 * v;
        out.opacity = 1 - amt * 0.4 * v;
        break;
      }
    }
    out.opacity = clamp01(out.opacity);
    out.size = Math.max(0, out.size);
    return out;
  }

  // Enter/exit presets.
  const sd = anim.preset === 'dissolve'
    ? hash01(k) * (anim.stagger?.amount ?? 30) * 20
    : staggerDelay(k, cell, anim.stagger, grid);
  const local = (t - (anim.delay || 0) - sd) / Math.max(1, anim.duration);
  const e = getEase(anim.easing)(clamp01(local));

  switch (anim.preset) {
    case 'fade-in': out.opacity = e; break;
    case 'dissolve': out.opacity = e; break;
    case 'scale-in': out.size = e; out.opacity = local > 0 ? 1 : 0; break;
    case 'spring-in': out.size = e; out.opacity = clamp01(local * 6); break;
    case 'typewriter': out.opacity = local >= 0 ? 1 : 0; break;
    case 'vanish': out.opacity = 1 - e; break;
    case 'wipe': out.opacity = local >= 0 ? 1 : 0; out.size = local >= 0 ? Math.max(0.001, e) : 0; break;
  }
  out.opacity = clamp01(out.opacity);
  out.size = Math.max(0, out.size);
  return out;
}

// Per-dot looping animation → multipliers.
function evalDotAnim(anim, k, t) {
  const out = { opacity: 1, size: 1, hue: 0 };
  if (!anim || anim.preset === 'none') return out;
  const period = Math.max(80, anim.period || 1000);
  const local = ((t - (anim.delay || 0)) % period + period) % period / period; // 0..1 looping
  const tri = local < 0.5 ? local * 2 : 2 - local * 2;                          // 0→1→0
  const e = getEase(anim.easing)(tri);
  const amt = anim.intensity ?? 0.5;
  switch (anim.preset) {
    case 'pulse': out.size = 1 - amt * 0.6 * e; break;
    case 'blink': out.opacity = local < 0.5 ? 1 : 1 - amt; break;
    case 'fade': out.opacity = 1 - amt * e; break;
    case 'bounce': out.size = 1 + amt * 0.5 * e; break;
    case 'hue': out.hue = 360 * local * amt; break;
  }
  out.opacity = clamp01(out.opacity);
  out.size = Math.max(0, out.size);
  return out;
}

// Compose everything → final visual props for one dot at time t.
export function evalDot(k, cell, layer, doc, t) {
  const g = evalGroup(layer.groupAnim, k, cell, doc.grid, t);
  const d = evalDotAnim(cell.anim, k, t);
  return {
    opacity: cell.opacity * layer.opacity * g.opacity * d.opacity,
    size: cell.size * g.size * d.size,
    hue: g.hue + d.hue,
    color: cell.color,
    rotation: cell.rotation,
    shape: cell.shape,
    stroke: cell.stroke,
  };
}