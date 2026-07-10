// Text layers: regenerate cells from text props, preserving per-cell style edits
// is intentionally NOT done — the layer's brush style applies uniformly, but the
// layer keeps a `style` so re-generation is stable.

import { textToCells } from './fonts.js';
import { defaultCell, makeLayer } from './model.js';

export function rebuildTextLayer(layer, brush) {
  if (layer.type !== 'text' || !layer.text) return;
  if (!layer.style) layer.style = defaultCell(brush);
  const { cells } = textToCells(layer.text.content, {
    font: layer.text.font,
    tracking: layer.text.tracking,
    row: layer.text.row,
    col: layer.text.col,
    cellFactory: () => ({ ...JSON.parse(JSON.stringify(layer.style)) }),
  });
  layer.cells = cells;
}

export function makeTextLayer(content, row, col, brush) {
  const layer = makeLayer(trimName(content), 'text');
  layer.text = { content, font: '5x7', tracking: 1, row, col };
  layer.style = defaultCell(brush);
  rebuildTextLayer(layer, brush);
  return layer;
}

function trimName(s) {
  s = String(s).trim() || 'Text';
  return s.length > 14 ? s.slice(0, 14) + '…' : s;
}
