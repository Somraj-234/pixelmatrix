// Bottom timeline: play/pause, scrub, loop, duration & fps.

import { el, icon, numInput } from './components.js';
import { state, setUI, updateDoc, subscribe } from '../store.js';
import { setTickHandler } from '../viewport.js';

const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5L7 4.5z"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>',
  restart: '<path d="M4 4v6h6M4.5 10A8 8 0 1 0 7 5.5"/>',
  loop: '<path d="M17 3l4 4-4 4M21 7H8a4 4 0 00-4 4M7 21l-4-4 4-4M3 17h13a4 4 0 004-4"/>',
  chevron: '<path d="M6 15l6-6 6 6"/>',
};

let track, playhead, timeLabel, playBtn, root;

export function initTimeline() {
  root = document.getElementById('timeline');
  build();
  subscribe(what => {
    if (what === 'doc' || what === 'tool') syncStatic();
  });
  setTickHandler(t => positionPlayhead(t));
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
  positionPlayhead(state.ui.time);
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
