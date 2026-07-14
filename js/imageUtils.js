// Small, shared image helpers used by both the per-dot custom-image shape
// feature and the background image feature. Kept in one place so the two
// don't duplicate the same file-reading / resizing logic (DRY).

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

// Downscale + re-encode an uploaded image file before it ever touches the
// document. This matters for performance: without it, a phone photo could be
// 4000x3000px — slow to draw every frame and heavy to keep in memory/undo,
// especially on low-RAM devices. maxSize caps the longest edge.
export async function downscaleImageFile(file, maxSize = 128, quality = 0.86) {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const keepAlpha = file.type ? /png|gif|webp/.test(file.type) : true;
  return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality);
}
