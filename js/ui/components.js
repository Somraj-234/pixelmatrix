// Tiny DOM helpers + form controls used across all panels.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function icon(path, size = 15) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = path;
  return s;
}

export function section(title, ...children) {
  return el('div', { class: 'border-b border-line px-3 py-3' },
    el('div', { class: 'text-[11px] font-medium uppercase tracking-wider text-muted mb-2.5' }, title),
    ...children);
}

export function row(label, control, opts = {}) {
  return el('div', { class: 'flex items-center justify-between gap-2 mb-2 ' + (opts.class || '') },
    el('span', { class: 'text-zinc-400 shrink-0 w-[72px] truncate' }, label),
    el('div', { class: 'flex items-center gap-1.5 flex-1 justify-end min-w-0' }, control));
}

export function numInput(value, onchange, { min = -9999, max = 9999, step = 1, width = 'w-14', suffix = '' } = {}) {
  const input = el('input', {
    type: 'number', value, min, max, step,
    class: `${width} bg-ink-3 border border-line rounded px-1.5 py-[3px] text-right font-mono text-[12px] outline-none focus:border-line-2`,
    onchange: e => {
      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      e.target.value = v;
      onchange(v);
    },
  });
  if (!suffix) return input;
  return el('div', { class: 'flex items-center gap-1' }, input, el('span', { class: 'text-muted text-[11px]' }, suffix));
}

// Slider + number field, kept in sync.
//
// Drag-safety rule: the live 'input' event (fired continuously while dragging)
// NEVER calls `onchange` directly — only the optional `oninput` callback does,
// and only if the caller explicitly passes one. `onchange` only fires once,
// on the native 'change' event (drag release / committed number entry).
// This matters because `onchange` call sites often trigger a full panel
// re-render (renderInspector rebuilds the DOM), which — if it fired on every
// drag tick — would destroy this very input mid-drag and kill the browser's
// native drag session. Callers that want a live canvas preview while dragging
// should pass `oninput` wired to a *non-rebuilding* update (see applyDotProp's
// `live` flag / `what:'silent'` in panels.js).
export function slider(value, onchange, { min = 0, max = 1, step = 0.01, oninput, width = 'w-14' } = {}) {
  function fmt(v) { return step >= 1 ? String(Math.round(v)) : (Math.round(v * 100) / 100).toString(); }
  const clamp = v => Math.min(max, Math.max(min, v));

  const range = el('input', { type: 'range', min, max, step, value, class: 'flex-1' });
  const numBox = el('input', {
    type: 'number', min, max, step, value: fmt(value),
    class: `${width} bg-ink-3 border border-line rounded px-1.5 py-[3px] text-right font-mono text-[12px] outline-none focus:border-line-2`,
  });

  range.addEventListener('input', () => {
    const v = clamp(parseFloat(range.value));
    numBox.value = fmt(v);
    if (oninput) oninput(v);
  });
  range.addEventListener('change', () => onchange(clamp(parseFloat(range.value))));

  numBox.addEventListener('change', e => {
    let v = parseFloat(e.target.value);
    if (isNaN(v)) v = value;
    v = clamp(v);
    e.target.value = fmt(v);
    range.value = v;
    onchange(v);
  });

  return el('div', { class: 'flex items-center gap-2 flex-1' }, range, numBox);
}

// Color swatch + hex field. Same drag-safety rule as slider(): the swatch's
// native 'input' (fires while dragging inside the OS color picker) only calls
// the optional `oninput` live-callback; `onchange` fires once on 'change'
// (when the picker is closed/committed), which is safe to rebuild the panel.
export function colorInput(value, onchange, { oninput } = {}) {
  const hex = el('input', {
    type: 'text', value, spellcheck: false,
    class: 'w-[68px] bg-ink-3 border border-line rounded px-1.5 py-[3px] font-mono text-[12px] outline-none focus:border-line-2 uppercase',
    onchange: e => { const v = normHex(e.target.value); if (v) { swatch.value = v; e.target.value = v; onchange(v); } else e.target.value = value; },
  });
  const swatch = el('input', { type: 'color', value });
  swatch.addEventListener('input', e => {
    hex.value = e.target.value.toUpperCase();
    if (oninput) oninput(e.target.value);
  });
  swatch.addEventListener('change', e => {
    hex.value = e.target.value.toUpperCase();
    onchange(e.target.value);
  });
  return el('div', { class: 'flex items-center gap-1.5' }, swatch, hex);
}

export function checkbox(value, onchange, label = '') {
  const box = el('input', {
    type: 'checkbox', checked: value,
    class: 'w-3.5 h-3.5 rounded cursor-pointer accent-accent',
    onchange: e => onchange(e.target.checked),
  });
  if (!label) return box;
  return el('label', { class: 'flex items-center gap-1.5 cursor-pointer text-[12px] text-zinc-300' }, box, label);
}

function normHex(s) {
  s = s.trim().replace(/^#?/, '#');
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return ('#' + [...s.slice(1)].map(c => c + c).join('')).toUpperCase();
  return null;
}

export function select(value, options, onchange, { width = 'flex-1' } = {}) {
  return el('select', {
    class: `${width} bg-ink-3 border border-line rounded px-1.5 py-[4px] text-[12px] outline-none focus:border-line-2 cursor-pointer`,
    onchange: e => onchange(e.target.value),
  }, ...options.map(o => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    return el('option', { value: val, selected: val === value }, label);
  }));
}

export function segmented(value, options, onchange) {
  const wrap = el('div', { class: 'flex bg-ink-3 border border-line rounded p-[2px] gap-[2px] flex-1' });
  for (const o of options) {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    wrap.append(el('button', {
      class: 'flex-1 px-1.5 py-[3px] rounded-[3px] text-[11px] transition-colors ' +
        (val === value ? 'bg-line-2 text-zinc-200' : 'text-muted hover:text-zinc-300'),
      onclick: () => onchange(val),
    }, label));
  }
  return wrap;
}

export function button(label, onclick, { variant = 'ghost', class: cls = '' } = {}) {
  const base = 'px-2.5 py-[5px] rounded-md text-[12px] font-medium transition-colors inline-flex items-center gap-1.5 justify-center ';
  const variants = {
    primary: 'bg-accent text-white hover:brightness-110',
    ghost: 'text-zinc-300 hover:bg-ink-3 border border-transparent',
    outline: 'border border-line text-zinc-300 hover:bg-ink-3',
  };
  return el('button', { class: base + variants[variant] + ' ' + cls, onclick }, label);
}

export function iconButton(svgPath, onclick, { title = '', size = 15, class: cls = '' } = {}) {
  return el('button', {
    title, class: 'p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-ink-3 transition-colors ' + cls,
    onclick,
  }, icon(svgPath, size));
}

export function toast(msg, ms = 2400) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = el('div', { id: 'toast-root', class: 'fixed bottom-14 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2' });
    document.body.append(root);
  }
  const t = el('div', { class: 'toast bg-ink-3 border border-line-2 rounded-lg px-3.5 py-2 text-[12px] shadow-xl' }, msg);
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, ms);
}

export function modal(title, body, { actions = [], wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const card = el('div', {
    class: `modal-card bg-ink-2 border border-line-2 rounded-xl shadow-2xl ${wide ? 'w-[560px]' : 'w-[420px]'} max-h-[85vh] flex flex-col`,
    onclick: e => e.stopPropagation(),
  },
    el('div', { class: 'flex items-center justify-between px-4 py-3 border-b border-line' },
      el('span', { class: 'font-semibold' }, title),
      el('button', { class: 'text-muted hover:text-zinc-200 text-lg leading-none px-1', onclick: close }, '×')),
    el('div', { class: 'p-4 overflow-y-auto flex-1' }, body),
    actions.length ? el('div', { class: 'flex justify-end gap-2 px-4 py-3 border-t border-line' }, ...actions) : null,
  );
  root.append(el('div', {
    class: 'fixed inset-0 bg-black/50 z-40 flex items-center justify-center',
    onclick: close,
  }, card));
  return close;
}
