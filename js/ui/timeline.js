// Bottom timeline: play/pause, scrub, loop, duration & fps, plus per-layer
// animation tracks and a sound track (video-editor style). Only layers that
// actually have an animation get a track — a plain static layer has nothing
// to show here. Each track's clip can be dragged/resized independently.

import { el, icon, numInput, toast } from './components.js';
import {
  state, setUI, updateDoc, subscribe, emit, pushUndo, saveNow, addAsset, removeAsset,
} from '../store.js';
import { setTickHandler } from '../viewport.js';
import { LOOP_PRESETS } from '../animation.js';
import { readFileAsDataURL } from '../imageUtils.js';
import { probeAudioDuration } from '../audio.js';

const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5L7 4.5z"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>',
  restart: '<path d="M4 4v6h6M4.5 10A8 8 0 1 0 7 5.5"/>',
  loop: '<path d="M17 3l4 4-4 4M21 7H8a4 4 0 00-4 4M7 21l-4-4 4-4M3 17h13a4 4 0 004-4"/>',
  chevron: '<path d="M6 15l6-6 6 6"/>',
  dots: '<circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // audio is stored as a data URL in the project — keep it modest

let track, playhead, timeLabel, playBtn, root;
let tracksWrap = null;
let tracksScrollTop = 0;
let trackRows = []; // { kind: 'enter'|'loop'|'audio', layerId?, clipEl, startMs, endMs }

export function initTimeline() {
  root = document.getElementById('timeline');
  build();
  subscribe(what => {
    if (what === 'doc' || what === 'tool') build();
  });
  setTickHandler(t => { positionPlayhead(t); highlightActiveTracks(t); });
}

function build() {
  // Rebuilding replaces the whole DOM subtree (simplest way to stay correct
  // whenever the doc changes) — but that used to reset the tracks list's
  // scroll position back to the top on every little edit, which felt like
  // the timeline was "resetting itself". Preserve it across rebuilds.
  if (tracksWrap) tracksScrollTop = tracksWrap.scrollTop;

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
    tracksWrap = null;
    return;
  }
  root.append(bar);
  root.append(buildTracks());
  tracksWrap.scrollTop = tracksScrollTop;
  positionPlayhead(state.ui.time);
  highlightActiveTracks(state.ui.time);
}

// ---------------------------------------------------------------- tracks

// A layer's clip on the timeline:
//  - 'loop':  an ambient looping preset (wave/ripple/...) — always "on".
//  - 'enter': a timed enter/exit animation with its own delay + duration —
//             draggable (move) and resizable (right edge = duration). Once
//             time passes its window it hides (see animation.js) so several
//             layers can hand off to one another without piling up.
function clipRange(layer, totalDurMs) {
  const a = layer.groupAnim;
  if (LOOP_PRESETS.has(a.preset)) return { kind: 'loop', startMs: 0, endMs: totalDurMs };
  const start = Math.min(Math.max(0, a.delay || 0), totalDurMs);
  const len = Math.max(50, a.duration || 500);
  const end = Math.min(totalDurMs, start + len);
  return { kind: 'enter', startMs: start, endMs: end };
}

function audioClipRange(audio, totalDurMs) {
  const start = Math.min(Math.max(0, audio.offset || 0), totalDurMs);
  const len = Math.max(50, audio.trimEnd - audio.trimStart);
  const end = Math.min(totalDurMs, start + len);
  return { kind: 'audio', startMs: start, endMs: end };
}

function clipStyle(range, totalDurMs) {
  const left = (range.startMs / totalDurMs) * 100;
  const width = Math.max(1.2, ((range.endMs - range.startMs) / totalDurMs) * 100);
  return { left, width };
}

function buildTracks() {
  const totalDur = state.doc.animation.duration;
  trackRows = [];

  const animatedLayers = state.doc.layers.filter(l => l.groupAnim && l.groupAnim.preset !== 'none');

  const rows = animatedLayers.map(layer => buildLayerRow(layer, totalDur));
  rows.push(buildAudioRow(totalDur));

  if (!animatedLayers.length && !state.doc.audio) {
    rows.unshift(el('div', { class: 'px-3 py-3 text-[11px] text-muted' },
      'No animated layers yet — add an animation to a layer (right panel) to see it here.'));
  }

  tracksWrap = el('div', { class: 'flex flex-col bg-ink-2 border-t border-line max-h-[168px] overflow-y-auto' }, ...rows);
  return tracksWrap;
}

function buildLayerRow(layer, totalDur) {
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
  const clipColor = range.kind === 'loop' ? 'bg-accent/25 border border-accent/50' : 'bg-accent/80 border border-accent';
  const row = { kind: range.kind, layerId: layer.id, startMs: range.startMs, endMs: range.endMs };

  const clip = el('div', {
    class: `absolute top-[3px] bottom-[3px] rounded-[3px] ${clipColor} ` + (range.kind === 'enter' ? 'cursor-grab' : 'cursor-pointer'),
    style: `left:${left}%; width:${width}%`,
    title: range.kind === 'enter'
      ? `${layer.name}: ${(range.startMs / 1000).toFixed(2)}s → ${(range.endMs / 1000).toFixed(2)}s`
      : `${layer.name} (looping)`,
    onpointerdown: e => {
      if (range.kind !== 'enter') { if (state.activeLayerId !== layer.id) { state.activeLayerId = layer.id; emit('doc'); } return; }
      startLayerClipDrag(e, layer, lane, 'move', row);
    },
  });
  if (range.kind === 'enter') {
    clip.append(el('div', {
      class: 'absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize',
      onpointerdown: e => { e.stopPropagation(); startLayerClipDrag(e, layer, lane, 'resize-right', row); },
    }));
  }
  lane.append(clip);
  row.clipEl = clip;
  trackRows.push(row);

  return el('div', { class: 'flex items-stretch h-6 border-b border-line/60' }, label, lane);
}

function buildAudioRow(totalDur) {
  const audio = state.doc.audio;
  const label = el('div', { class: 'w-[104px] shrink-0 flex items-center gap-1.5 px-2 text-[11px] truncate border-r border-line text-emerald-400' },
    icon(ICONS.music, 11), el('span', { class: 'truncate' }, 'Sound'));
  const lane = el('div', { class: 'relative flex-1 h-6 bg-ink-3/50' });

  if (!audio) {
    lane.append(el('button', {
      class: 'absolute inset-1 rounded-[3px] border border-dashed border-line-2 text-[10px] text-muted hover:text-zinc-300 hover:border-accent flex items-center justify-center',
      onclick: uploadAudio,
    }, '+ Add sound'));
    return el('div', { class: 'flex items-stretch h-6 border-b border-line/60' }, label, lane);
  }

  const row = { kind: 'audio' };
  const range = audioClipRange(audio, totalDur);
  const { left, width } = clipStyle(range, totalDur);
  row.startMs = range.startMs; row.endMs = range.endMs;

  const clip = el('div', {
    class: 'absolute top-[3px] bottom-[3px] rounded-[3px] bg-emerald-600/70 border border-emerald-400 cursor-grab',
    style: `left:${left}%; width:${width}%`,
    title: `Sound: ${(range.startMs / 1000).toFixed(2)}s → ${(range.endMs / 1000).toFixed(2)}s`,
    onpointerdown: e => startAudioClipDrag(e, audio, lane, 'move', row),
  },
    el('div', {
      class: 'absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize',
      onpointerdown: e => { e.stopPropagation(); startAudioClipDrag(e, audio, lane, 'resize-left', row); },
    }),
    el('div', {
      class: 'absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize',
      onpointerdown: e => { e.stopPropagation(); startAudioClipDrag(e, audio, lane, 'resize-right', row); },
    }));
  row.clipEl = clip;
  lane.append(clip);
  trackRows.push(row);

  const removeBtn = el('button', {
    class: 'shrink-0 w-6 text-muted hover:text-zinc-200 text-[13px] leading-none',
    title: 'Remove sound',
    onclick: () => { updateDoc(d => { d.audio = null; }); removeAsset(audio.assetId); },
  }, '×');

  return el('div', { class: 'flex items-stretch h-6 border-b border-line/60' }, label, lane, removeBtn);
}

function uploadAudio() {
  const input = el('input', { type: 'file', accept: 'audio/wav,audio/mpeg,audio/mp3,.wav,.mp3', class: 'hidden' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) {
      toast('That file is a bit large — please use a shorter clip (under ~8MB).');
      return;
    }
    try {
      const dataUrl = await readFileAsDataURL(file);
      const durationMs = await probeAudioDuration(dataUrl);
      const assetId = addAsset('audio', dataUrl, file.name);
      updateDoc(d => {
        d.audio = { assetId, srcDuration: durationMs, trimStart: 0, trimEnd: durationMs, offset: 0, volume: 1 };
      });
    } catch { toast('Could not read that audio file'); }
  };
  input.click();
}

// Shared low-level drag mechanics for any timeline clip (layer or audio).
// `onDelta(dt_ms)` is called on every real pointer move — the caller applies
// its own clamping/semantics and writes the new value(s) back. Values are
// mutated directly (not via updateDoc) and only this clip's own DOM style is
// touched, so nothing gets rebuilt mid-drag — the canvas repaints every rAF
// frame straight from state regardless. One undo snapshot is taken right
// before the first real change; the full timeline/inspector re-renders once,
// on release.
function dragTimelineClip(e, laneEl, onDelta, onClick) {
  e.preventDefault();
  const totalDur = state.doc.animation.duration;
  const laneRect = laneEl.getBoundingClientRect();
  const startX = e.clientX;
  let moved = false;
  let snapshotted = false;

  const onMove = ev => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) > 2) moved = true;
    if (!moved) return;
    if (!snapshotted) { pushUndo(); snapshotted = true; }
    onDelta((dx / laneRect.width) * totalDur);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) { saveNow(); emit('doc'); }
    else if (onClick) onClick();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startLayerClipDrag(e, layer, lane, mode, row) {
  const totalDur = state.doc.animation.duration;
  const initDelay = layer.groupAnim.delay || 0;
  const initDuration = layer.groupAnim.duration || 500;
  dragTimelineClip(e, lane, dt => {
    if (mode === 'resize-right') {
      layer.groupAnim.duration = Math.min(totalDur - initDelay, Math.max(50, initDuration + dt));
    } else {
      layer.groupAnim.delay = Math.min(totalDur - initDuration, Math.max(0, initDelay + dt));
    }
    const r = clipRange(layer, totalDur);
    const { left, width } = clipStyle(r, totalDur);
    row.clipEl.style.left = left + '%';
    row.clipEl.style.width = width + '%';
    row.startMs = r.startMs; row.endMs = r.endMs;
  }, () => { if (state.activeLayerId !== layer.id) { state.activeLayerId = layer.id; emit('doc'); } });
}

// Audio trim: the right handle only changes trimEnd (how much of the source
// plays); the left handle changes trimStart AND shifts offset by the same
// amount so the clip's END stays anchored on the timeline while its start
// moves — the standard "trim handle" behavior in video editors.
function startAudioClipDrag(e, audio, lane, mode, row) {
  const totalDur = state.doc.animation.duration;
  const minLen = 100;
  const initOffset = audio.offset || 0;
  const initTrimStart = audio.trimStart;
  const initTrimEnd = audio.trimEnd;
  dragTimelineClip(e, lane, dt => {
    if (mode === 'move') {
      const len = initTrimEnd - initTrimStart;
      audio.offset = Math.min(totalDur - len, Math.max(0, initOffset + dt));
    } else if (mode === 'resize-right') {
      const onTimelineMax = totalDur - initOffset;
      const srcMax = audio.srcDuration - initTrimStart;
      audio.trimEnd = initTrimStart + Math.max(minLen, Math.min(onTimelineMax, srcMax, (initTrimEnd - initTrimStart) + dt));
    } else if (mode === 'resize-left') {
      const newTrimStart = Math.max(0, Math.min(initTrimEnd - minLen, initTrimStart + dt));
      audio.offset = Math.max(0, initOffset + (newTrimStart - initTrimStart));
      audio.trimStart = newTrimStart;
    }
    const r = audioClipRange(audio, totalDur);
    const { left, width } = clipStyle(r, totalDur);
    row.clipEl.style.left = left + '%';
    row.clipEl.style.width = width + '%';
    row.startMs = r.startMs; row.endMs = r.endMs;
  }, null);
}

// Ring-highlight whichever track(s) are currently active at time t. Looping
// layers are always "on" so highlighting them all the time isn't useful —
// only enter clips and the sound clip get the dynamic highlight.
function highlightActiveTracks(t) {
  for (const r of trackRows) {
    const active = r.kind !== 'loop' && t >= r.startMs && t <= r.endMs;
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

// K toggles playback (Space is reserved for panning).
window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) togglePlay();
});
