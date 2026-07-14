// SVG export: static (exact) and animated (CSS keyframes; best-effort mapping
// of group + per-dot animations).

import { state, getAsset } from '../store.js';
import { gridSizePx, cellPos, parseKey } from '../model.js';
import { evalDot, staggerDelay, LOOP_PRESETS } from '../animation.js';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function shapeSvg(shape, x, y, s, fill, opacity, rotation, stroke) {
  const strokeAttrs = stroke && stroke.enabled && stroke.width > 0
    ? ` stroke="${stroke.color}" stroke-width="${(+stroke.width).toFixed(2)}"` : '';
  const attrs = `fill="${fill}"` + (opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : '') + strokeAttrs;
  const cx = x + s / 2, cy = y + s / 2;
  const rot = rotation ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';
  const n = v => +v.toFixed(2);
  switch (shape) {
    case 'circle': return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s / 2)}" ${attrs}${rot}/>`;
    case 'ring': {
      const lw = Math.max(1, s * 0.18);
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s / 2 - lw / 2)}" fill="none" stroke="${fill}" stroke-width="${n(lw)}"${opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : ''}${rot}/>`;
    }
    case 'rounded': return `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" rx="${n(s * 0.28)}" ${attrs}${rot}/>`;
    case 'diamond': return `<polygon points="${n(cx)},${n(y)} ${n(x + s)},${n(cy)} ${n(cx)},${n(y + s)} ${n(x)},${n(cy)}" ${attrs}${rot}/>`;
    case 'triangle': return `<polygon points="${n(cx)},${n(y)} ${n(x + s)},${n(y + s)} ${n(x)},${n(y + s)}" ${attrs}${rot}/>`;
    case 'half-square': return `<polygon points="${n(x)},${n(y)} ${n(x + s)},${n(y)} ${n(x)},${n(y + s)}" ${attrs}${rot}/>`;
    case 'plus': {
      const t = s / 3;
      return `<path d="M${n(x + t)} ${n(y)}h${n(t)}v${n(t)}h${n(t)}v${n(t)}h-${n(t)}v${n(t)}h-${n(t)}v-${n(t)}h-${n(t)}v-${n(t)}h${n(t)}z" ${attrs}${rot}/>`;
    }
    case 'square':
    // Custom-image dots fall back to a plain square in SVG export — embedding
    // a data URL per dot would bloat the file, often for the same image
    // repeated many times. Canvas-based exports (PNG/GIF/video) show it fully.
    case 'image':
    default: return `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" ${attrs}${rot}/>`;
  }
}

export function exportSvg({ animated = false, transparent = false, duration } = {}) {
  const doc = state.doc;
  const { w, h } = gridSizePx(doc.grid);
  const cs = doc.grid.cellSize;
  const dur = (duration ?? doc.animation.duration) / 1000;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  if (!transparent) parts.push(`<rect width="${w}" height="${h}" fill="${doc.grid.bg}"/>`);
  if (doc.grid.bgImage) {
    const asset = getAsset(doc.grid.bgImage.assetId);
    if (asset) {
      const cfg = doc.grid.bgImage;
      // Note: SVG export approximates the background as centered "cover"
      // (preserveAspectRatio slice) — rotation and opacity are exact, but a
      // manual pan offset isn't reproduced here. Canvas-based exports
      // (PNG/GIF/video) show the pan exactly as previewed.
      const rot = cfg.rotate ? ` transform="rotate(${cfg.rotate} ${w / 2} ${h / 2})"` : '';
      const op = cfg.opacity < 1 ? ` opacity="${cfg.opacity}"` : '';
      parts.push(`<image href="${asset.data}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${op}${rot}/>`);
    }
  }

  const styles = [];
  let animClass = 0;

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    parts.push(`<g${layer.opacity < 1 ? ` opacity="${layer.opacity}"` : ''} data-layer="${esc(layer.name)}">`);

    for (const [k, cell] of Object.entries(layer.cells)) {
      const [r, c] = parseKey(k);
      if (r < 0 || c < 0 || r >= doc.grid.rows || c >= doc.grid.cols) continue;
      const { x, y } = cellPos(doc.grid, r, c);

      if (!animated) {
        // Static: evaluate at the current playhead so WYSIWYG.
        const v = evalDot(k, cell, layer, doc, state.ui.time);
        if (v.opacity <= 0.002 || v.size <= 0.002) continue;
        const s = cs * v.size;
        const stroke = v.stroke && v.stroke.enabled ? { ...v.stroke, width: v.stroke.width * v.size } : null;
        parts.push(shapeSvg(v.shape, x + (cs - s) / 2, y + (cs - s) / 2, s, cell.color, v.opacity, cell.rotation, stroke));
        continue;
      }

      // Animated: base dot + CSS animation approximating its timeline.
      const s = cs * cell.size;
      const anim = buildCssAnim(k, cell, layer, doc, dur);
      let node = shapeSvg(cell.shape, x + (cs - s) / 2, y + (cs - s) / 2, s, cell.color, cell.opacity, cell.rotation, cell.stroke);
      if (anim) {
        const cls = `a${animClass++}`;
        styles.push(anim.keyframes(cls));
        node = node.replace('/>', ` class="${cls}" style="transform-origin:${(x + cs / 2).toFixed(1)}px ${(y + cs / 2).toFixed(1)}px;animation:${cls} ${anim.dur}s ${anim.ease} ${anim.delay}s ${anim.loop ? 'infinite' : 'both'}"/>`);
      }
      parts.push(node);
    }
    parts.push('</g>');
  }

  if (animated && styles.length) {
    parts.splice(1, 0, `<style>${styles.join('\n')}</style>`);
  }
  parts.push('</svg>');
  return new Blob([parts.join('\n')], { type: 'image/svg+xml' });
}

// Map group/dot animations to a single CSS animation per dot (best effort —
// canvas exports are the exact ones).
function buildCssAnim(k, cell, layer, doc, totalDur) {
  const g = layer.groupAnim;
  const d = cell.anim;

  if (g && g.preset !== 'none') {
    const sd = staggerDelay(k, cell, g.stagger, doc.grid) / 1000;
    if (LOOP_PRESETS.has(g.preset)) {
      const dur = (g.loopPeriod || 1600) / 1000;
      const amt = g.intensity ?? 0.5;
      const kf = {
        'wave': cls => `@keyframes ${cls}{0%,100%{transform:scale(1)}50%{transform:scale(${(1 - amt * 0.9).toFixed(2)})}}`,
        'ripple': cls => `@keyframes ${cls}{0%,100%{opacity:1}50%{opacity:${(1 - amt).toFixed(2)}}}`,
        'sparkle': cls => `@keyframes ${cls}{0%,60%,100%{opacity:1}70%,90%{opacity:${(1 - amt * 0.85).toFixed(2)}}}`,
        'breathe': cls => `@keyframes ${cls}{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(${(1 - amt * 0.35).toFixed(2)});opacity:${(1 - amt * 0.4).toFixed(2)}}}`,
      }[g.preset];
      return { keyframes: kf, dur, delay: -sd, ease: 'ease-in-out', loop: true };
    }
    const dur = Math.max(0.01, g.duration / 1000);
    const delay = (g.delay || 0) / 1000 + sd;
    const ease = cssEase(g.easing);
    const kf = {
      'fade-in': cls => `@keyframes ${cls}{from{opacity:0}to{opacity:1}}`,
      'dissolve': cls => `@keyframes ${cls}{from{opacity:0}to{opacity:1}}`,
      'scale-in': cls => `@keyframes ${cls}{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}`,
      'spring-in': cls => `@keyframes ${cls}{0%{transform:scale(0)}60%{transform:scale(1.18)}80%{transform:scale(.94)}100%{transform:scale(1)}}`,
      'typewriter': cls => `@keyframes ${cls}{from{opacity:0}to{opacity:1}}`,
      'vanish': cls => `@keyframes ${cls}{from{opacity:1}to{opacity:0}}`,
      'wipe': cls => `@keyframes ${cls}{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}`,
    }[g.preset];
    if (kf) {
      return {
        keyframes: kf, dur: g.preset === 'typewriter' ? 0.01 : dur, delay,
        ease: g.preset === 'typewriter' ? 'step-end' : ease, loop: false,
      };
    }
  }

  if (d && d.preset !== 'none') {
    const dur = (d.period || 1000) / 1000;
    const amt = d.intensity ?? 0.5;
    const kf = {
      'pulse': cls => `@keyframes ${cls}{0%,100%{transform:scale(1)}50%{transform:scale(${(1 - amt * 0.6).toFixed(2)})}}`,
      'blink': cls => `@keyframes ${cls}{0%,49%{opacity:1}50%,100%{opacity:${(1 - amt).toFixed(2)}}}`,
      'fade': cls => `@keyframes ${cls}{0%,100%{opacity:1}50%{opacity:${(1 - amt).toFixed(2)}}}`,
      'bounce': cls => `@keyframes ${cls}{0%,100%{transform:scale(1)}50%{transform:scale(${(1 + amt * 0.5).toFixed(2)})}}`,
      'hue': cls => `@keyframes ${cls}{to{filter:hue-rotate(${Math.round(360 * amt)}deg)}}`,
    }[d.preset];
    if (kf) return { keyframes: kf, dur, delay: -(d.delay || 0) / 1000, ease: 'ease-in-out', loop: true };
  }
  return null;
}

function cssEase(easing) {
  if (!easing) return 'ease-out';
  if (easing.type === 'bezier' && easing.bezier) return `cubic-bezier(${easing.bezier.join(',')})`;
  if (easing.type === 'spring') return 'cubic-bezier(.3,1.4,.4,1)';
  if (easing.type === 'step') return 'step-end';
  return ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(easing.type) ? easing.type : 'ease-out';
}
