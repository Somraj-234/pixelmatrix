// Bottom timeline: play/pause, scrub, loop, duration & fps, plus a per-layer
// track list (video-editor style) showing each layer's own animation clip —
// when it starts and how long it runs — within the shared total duration.

import { el, icon, numInput } from './components.js';
import { state, setUI, updateDoc, subscribe, emit, pushUndo, saveNow } from '../store.js';
import { setTickHandler } from '../viewport.js';
import { LOOP_PRESETS } from '../animation.js';

const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5L7 4.5z"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>',
  restart: '<path d="M4 4v6h6M4.5 10A8 8 0 1 0 7 5.5"/>',
  loop: '<path d="M17 3l4 4-4 4M21 7H8a4 4 0 00-4 4M7 21l-4-4 4-4M3 17h13a4 4 0 004-4"/>',
  chevron: '<path d="M6 15l6-6 6 6"/>',
  dots: '<circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
};

let track, playhead, timeLabel, playBtn, root;
let trackRows = []; // { layerId, clipEl, rowEl, kind, startMs, endMs }

export function initTimeline() {
  root = document.getElementById('timeline');
  build();
  subscribe(what => {
    if (what === 'doc' || what === 'tool') syncStatic();
  });
  setTickHandler(t => { positionPlayhead(t); highlightActiveTracks(t); });
}

function build() {
  root.innerHTML = '';
  const a = state.doc.animation;

  playBtn = el('button', {
    class: 'p-1.5 rounded-md text-zinc-200 hover:bg-ink-3',
    title: 'Play/Pause (Space is pan — use K or click)',
    onclick: togglePlay,
  }, icon(state.ui.playing ? ICONS.pause : ICONS.play, 16));

  timeLabel = el('span', { class: 'font-mono text-[11px] text-muted w-[86px]' }, '0.00s');

  playhead = el('div', { class: 'absolute top-0 bottom-0 w-[2px] bg-accent rounded pointer-events-none', style: 'left:0' },
    el('div', { class: 'absolute -top-[3px] -left-[4px] w-[10px] h-[8px] bg-accent', style: 'clip-path: polygon(0 0, 100% 0, 50% 100%)' }));

  track = el('div', {
    class: 'relative flex-1 h-7 bg-ink-3 rounded-md border border-line cursor-ew-resize overflow-hidden',
    onpointerdown: startScrub,
  }, ticks(), playhead);

  const loopBtn = el('button', {
    class: 'p-1.5 rounded-md hover:bg-ink-3 ' + (a.loop ? 'text-accent' : 'text-muted'),
    title: 'Loop',
    onclick: () => { updateDoc(d => { d.animation.loop = !d.animation.loop; }, { undo: false }); },
  }, icon(ICONS.loop, 14));

  const restartBtn = el('button', {
    class: 'p-1.5 rounded-md text-zinc-400 hover:bg-ink-3 hover:text-zinc-200', title: 'Restart',
    onclick: () => { setUI({ time: 0, playing: true }, 'silent'); syncPlayBtn(); },
  }, icon(ICONS.restart, 14));

  const durationCtl = el('div', { class: 'flex items-center gap-1.5' },
    el('span', { class: 'text-[11px] text-muted' }, 'Duration'),
    numInput(a.duration / 1000, v => updateDoc(d => { d.animation.duration = Math.max(0.2, v) * 1000; }, { undo: false }),
      { min: 0.2, max: 60, step: 0.1, width: 'w-14', suffix: 's' }));

  const fpsCtl = el('div', { class: 'flex items-center gap-1.5' },
    el('span', { class: 'text-[11px] text-muted' }, 'FPS'),
    numInput(a.fps, v => updateDoc(d => { d.animation.fps = v; }, { undo: false }), { min: 5, max: 60, width: 'w-12' }));

  const collapse = el('button', {
    class: 'p-1 rounded text-muted hover:text-zinc-200',
    style: state.ui.timelineOpen ? 'transform:rotate(180deg)' : '',
    onclick: () => { setUI({ timelineOpen: !state.ui.timelineOpen }); build(); },
  }, icon(ICONS.chevron, 13));

  const bar = el('div', { class: 'flex items-center gap-2.5 px-3 h-11 bg-ink-2 border-t border-line' },
    playBtn, restartBtn, timeLabel, track, loopBtn,
    el('div', { class: 'w-px h-5 bg-line mx-0.5' }),
    durationCtl, fpsCtl, collapse);

  if (!state.ui.timelineOpen) {
    root.append(el('div', { class: 'flex justify-end px-3 py-1 bg-ink-2 border-t border-line' },
      el('button', { class: 'p-1 rounded text-muted hover:text-zinc-200 rotate-180', onclick: () => { setUI({ timelineOpen: true }); build(); } },
        icon(ICONS.chevron, 13))));
    return;
  }
  root.append(bar);
  root.append(buildTracks());
  positionPlayhead(state.ui.time);
  highlightActiveTracks(state.ui.time);
}

// ---------------------------------------------------------------- tracks

// What a layer's clip looks like on the timeline:
//  - 'static': no enter animation — layer is simply present the whole time.
//  - 'loop':   an ambient looping preset (wave/ripple/...) — always "on".
//  - 'enter':  a timed enter/exit animation with its own delay + duration —
//              draggable (move) and resizable (right edge = duration).
function clipRange(layer, totalDurMs) {
  const a = layer.groupAnim;
  if (!a || a.preset === 'none') return { kind: 'static', startMs: 0, endMs: totalDurMs };
  if (LOOP_PRESETS.has(a.preset)) return { kind: 'loop', startMs: 0, endMs: totalDurMs };
  const start = Math.min(Math.max(0, a.delay || 0), totalDurMs);
  const len = Math.max(50, a.duration || 500);
  const end = Math.min(totalDurMs, start + len);
  return { kind: 'enter', startMs: start, endMs: end };
}

function clipStyle(range, totalDurMs) {
  const left = (range.startMs / totalDurMs) * 100;
  const width = Math.max(1.2, ((range.endMs - range.startMs) / totalDurMs) * 100);
  return { left, width };
}

function buildTracks() {
  const totalDur = state.doc.animation.duration;
  trackRows = [];

  const rows = state.doc.layers.map((layer, idx) => {
    const isActive = layer.id === state.activeLayerId;
    const range = clipRange(layer, totalDur);
    const { left, width } = clipStyle(range, totalDur);

    const label = el('button', {
      class: 'w-[104px] shrink-0 flex items-center gap-1.5 px-2 text-[11px] truncate border-r border-line text-left '
        + (isActive ? 'text-accent bg-accent-dim' : 'text-zinc-400 hover:text-zinc-200'),
      title: layer.name,
      onclick: () => { state.activeLayerId = layer.id; emit('doc'); },
    }, icon(layer.type === 'text' ? ICONS.text : ICONS.dots, 11), el('span', { class: 'truncate' }, layer.name));

    const lane = el('div', { class: 'relative flex-1 h-6 bg-ink-3/50' });

    const clipColor = range.kind === 'static' ? 'bg-line-2/70 border border-line-2'
      : range.kind === 'loop' ? 'bg-accent/25 border border-accent/50'
      : 'bg-accent/80 border border-accent';

    const clip = el('div', {
      class: `absolute top-[3px] bottom-[3px] rounded-[3px] ${clipColor} ` + (range.kind === 'enter' ? 'cursor-grab' : 'cursor-pointer'),
      style: `left:${left}%; width:${width}%`,
      title: range.kind === 'enter' ? `${layer.name}: ${(range.startMs / 1000).toFixed(2)}s → ${(range.endMs / 1000).toFixed(2)}s` : layer.name,
      onpointerdown: e => startClipDrag(e, layer, lane, false),
    });
    if (range.kind === 'enter') {
      clip.append(el('div', {
        class: 'absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize',
        onpointerdown: e => { e.stopPropagation(); startClipDrag(e, layer, lane, true); },
      }));
    }
    lane.append(clip);

    const row = el('div', { class: 'flex items-stretch h-6 border-b border-line/60' }, label, lane);
    trackRows.push({ layerId: layer.id, clipEl: clip, rowEl: row, kind: range.kind, startMs: range.startMs, endMs: range.endMs });
    return row;
  });

  return el('div', { class: 'flex flex-col bg-ink-2 border-t border-line max-h-[168px] overflow-y-auto' }, ...rows);
}

// Drag a clip to move its start (delay), or its right edge to resize its
// duration. Mutates layer.groupAnim directly for a smooth live preview (the
// canvas repaints every frame from state regardless, and we update just this
// clip's own style — no full rebuild mid-drag, so nothing gets torn down).
// One undo snapshot is taken right before the first real change, so undo
// restores the pre-drag arrangement; the full timeline/inspector only
// re-renders once, on release.
function startClipDrag(e, layer, lane, isResize) {
  const totalDur = state.doc.animation.duration;
  const range = clipRange(layer, totalDur);
  if (range.kind !== 'enter') {
    if (state.activeLayerId !== layer.id) { state.activeLayerId = layer.id; emit('doc'); }
    return;
  }
  e.preventDefault();
  const laneRect = lane.getBoundingClientRect();
  const startX = e.clientX;
  const initDelay = layer.groupAnim.delay || 0;
  const initDuration = layer.groupAnim.duration || 500;
  let moved = false;

  const row = trackRows.find(r => r.layerId === layer.id);

  const onMove = ev => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) > 2) moved = true;
    if (!moved) return;
    if (!row._snapshotted) { pushUndo(); row._snapshotted = true; }
    const dt = (dx / laneRect.width) * totalDur;
    if (isResize) {
      layer.groupAnim.duration = Math.min(totalDur - initDelay, Math.max(50, initDuration + dt));
    } else {
      layer.groupAnim.delay = Math.min(totalDur - initDuration, Math.max(0, initDelay + dt));
    }
    const r2 = clipRange(layer, totalDur);
    const { left, width } = clipStyle(r2, totalDur);
    row.clipEl.style.left = left + '%';
    row.clipEl.style.width = width + '%';
    row.startMs = r2.startMs; row.endMs = r2.endMs;
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) { row._snapshotted = false; saveNow(); emit('doc'); }
    else if (state.activeLayerId !== layer.id) { state.activeLayerId = layer.id; emit('doc'); }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Ring-highlight whichever track(s) are currently animating at time t.
function highlightActiveTracks(t) {
  for (const r of trackRows) {
    const active = r.kind !== 'static' ? (t >= r.startMs && t <= r.endMs) : false;
    r.clipEl.classList.toggle('ring-2', active);
    r.clipEl.classList.toggle('ring-white/80', active);
  }
}

function ticks() {
  const wrap = el('div', { class: 'absolute inset-0 flex pointer-events-none' });
  for (let i = 0; i < 10; i++) {
    wrap.append(el('div', { class: 'flex-1 border-r border-line/60 last:border-0' }));
  }
  return wrap;
}

function togglePlay() {
  setUI({ playing: !state.ui.playing }, 'silent');
  syncPlayBtn();
}

function syncPlayBtn() {
  if (!playBtn) return;
  playBtn.innerHTML = '';
  playBtn.append(icon(state.ui.playing ? ICONS.pause : ICONS.play, 16));
}

function startScrub(e) {
  const wasPlaying = state.ui.playing;
  setUI({ playing: false }, 'silent');
  syncPlayBtn();
  const move = ev => {
    const r = track.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    setUI({ time: u * state.doc.animation.duration }, 'silent');
    positionPlayhead(state.ui.time);
    highlightActiveTracks(state.ui.time);
  };
  move(e);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (wasPlaying) { setUI({ playing: true }, 'silent'); syncPlayBtn(); }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function positionPlayhead(t) {
  if (!track || !state.ui.timelineOpen) return;
  const u = Math.min(1, t / state.doc.animation.duration);
  playhead.style.left = `calc(${(u * 100).toFixed(3)}% - 1px)`;
  timeLabel.textContent = `${(t / 1000).toFixed(2)}s / ${(state.doc.animation.duration / 1000).toFixed(1)}s`;
}

function syncStatic() { build(); }

// K toggles playback (Space is reserved for panning).
window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) togglePlay();
});