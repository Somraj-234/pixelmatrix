// Basic background-image editor: upload, then pan (drag), zoom, rotate and
// opacity, previewed live on a small canvas. Editing happens on a local
// working copy and is only written to the document when "Apply" is pressed,
// so Cancel is always a true no-op on the document/undo stack.

import { el, row, slider, button, modal, toast } from './components.js';
import { state, updateDoc, addAsset, getAsset, removeAsset } from '../store.js';
import { defaultBgImage, gridSizePx } from '../model.js';
import { downscaleImageFile, loadImage } from '../imageUtils.js';
import { drawBackgroundImage } from '../render.js';

const closeModal = () => { document.getElementById('modal-root').innerHTML = ''; };

export function openBackgroundImageEditor() {
  const existing = state.doc.grid.bgImage;
  if (existing) openEditor(existing.assetId, { ...existing });
  else openUploadPrompt();
}

function openUploadPrompt() {
  const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      // 768px cap keeps the stored image (and every frame's draw cost) small
      // — plenty sharp for a dot-grid background, cheap on low-RAM devices.
      const dataUrl = await downscaleImageFile(file, 768, 0.88);
      const assetId = addAsset('image', dataUrl, file.name);
      openEditor(assetId, defaultBgImage(assetId));
    } catch { toast('Could not read that image'); }
  };
  modal('Background image', el('div', { class: 'flex flex-col gap-3' },
    el('p', { class: 'text-[12px] text-muted' }, 'Choose an image to use as the canvas background.'),
    button('Choose image…', () => input.click(), { variant: 'outline' }),
    input,
  ));
}

async function openEditor(assetId, cfg) {
  const asset = getAsset(assetId);
  if (!asset) { toast('Image not found'); return; }
  let img;
  try { img = await loadImage(asset.data); } catch { toast('Could not load that image'); return; }

  const local = { ...cfg }; // working copy — only committed on Apply
  const { w: gw, h: gh } = gridSizePx(state.doc.grid);
  const PW = 380, PH = Math.round(PW * (gh / gw));

  const canvas = el('canvas', {
    width: PW, height: PH,
    class: 'rounded-md border border-line cursor-grab w-full block',
  });
  const cx = canvas.getContext('2d');

  function redraw() {
    cx.clearRect(0, 0, PW, PH);
    cx.fillStyle = state.doc.grid.bg;
    cx.fillRect(0, 0, PW, PH);
    drawBackgroundImage(cx, img, PW, PH, local);
  }
  redraw();

  // Pan by dragging directly on the preview.
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('cursor-grabbing');
    const startX = e.clientX, startY = e.clientY;
    const startOffX = local.offsetX, startOffY = local.offsetY;
    const scale = Math.max(PW / img.naturalWidth, PH / img.naturalHeight) * local.zoom;
    const rangeX = Math.max(1, img.naturalWidth * scale - PW);
    const rangeY = Math.max(1, img.naturalHeight * scale - PH);
    const onMove = ev => {
      local.offsetX = Math.min(1, Math.max(0, startOffX - (ev.clientX - startX) / rangeX));
      local.offsetY = Math.min(1, Math.max(0, startOffY - (ev.clientY - startY) / rangeY));
      redraw();
    };
    const onUp = () => {
      canvas.classList.remove('cursor-grabbing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  const onLive = fn => v => { fn(v); redraw(); };
  const body = el('div', { class: 'flex flex-col gap-3' },
    canvas,
    el('p', { class: 'text-[11px] text-muted' }, 'Drag the preview to reposition.'),
    row('Zoom', slider(local.zoom, onLive(v => { local.zoom = v; }), { min: 1, max: 3, step: 0.05, oninput: onLive(v => { local.zoom = v; }) })),
    row('Rotate', slider(local.rotate, onLive(v => { local.rotate = v; }), { min: 0, max: 360, step: 1, oninput: onLive(v => { local.rotate = v; }) })),
    row('Opacity', slider(local.opacity, onLive(v => { local.opacity = v; }), { oninput: onLive(v => { local.opacity = v; }) })),
  );

  modal('Background image', body, {
    actions: [
      button('Remove', () => {
        updateDoc(d => { d.grid.bgImage = null; });
        removeAsset(assetId);
        closeModal();
        toast('Background image removed');
      }, { variant: 'outline' }),
      button('Cancel', closeModal, { variant: 'outline' }),
      button('Apply', () => {
        updateDoc(d => { d.grid.bgImage = { ...local }; });
        closeModal();
        toast('Background image updated');
      }, { variant: 'primary' }),
    ],
    wide: true,
  });
}
