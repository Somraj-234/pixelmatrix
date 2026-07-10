// Boot.

import { initStore, state } from './store.js';
import { initViewport, fitToView } from './viewport.js';
import { initTools } from './tools.js';
import { initPanels } from './ui/panels.js';
import { initTimeline } from './ui/timeline.js';

import { setUI, updateDoc, activeLayer } from './store.js';
import { resizeGrid, defaultGroupAnim, defaultDotAnim } from './model.js';
import { makeTextLayer } from './textlayer.js';
import { copyStyleFromCell, applyStyleToSelection } from './tools.js';

initStore();

// Debug / scripting handle (also handy in the console).
window.__dm = {
  state, setUI, updateDoc, activeLayer, resizeGrid,
  makeTextLayer, defaultGroupAnim, defaultDotAnim,
  copyStyleFromCell, applyStyleToSelection,
};
const canvas = initViewport();
initTools(canvas);
initPanels();
initTimeline();
fitToView();
