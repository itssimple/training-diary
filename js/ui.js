// DOM helpers, dialogs, toasts and small reusable widgets.

import { icon } from './icons.js';
import { fmtNum } from './util.js';

/**
 * Hyperscript helper: h('button', { class: 'btn', onclick }, 'Label').
 * Props: class, dataset, style (object), on* handlers, boolean attrs, anything else as attribute.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'open' || k === 'multiple' || k === 'required') el[k] = !!v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Button with optional icon. variant: primary | secondary | ghost | danger | icon */
export function btn(label, onclick, opts = {}) {
  const cls = ['btn', `btn-${opts.variant || 'secondary'}`, opts.size ? `btn-${opts.size}` : '', opts.block ? 'btn-block' : '', opts.class || ''];
  const b = h('button', {
    type: opts.type || 'button',
    class: cls,
    onclick: onclick ? guardDouble(onclick) : null,
    'aria-label': opts.ariaLabel || (opts.iconOnly ? label : null),
    title: opts.iconOnly ? label : (opts.title || null),
    disabled: opts.disabled,
    'aria-pressed': opts.pressed === undefined ? null : String(!!opts.pressed),
    dataset: opts.dataset,
  }, opts.icon ? icon(opts.icon) : null, opts.iconOnly ? null : h('span', null, label));
  return b;
}

/** Prevents accidental double submission of async actions. */
export function guardDouble(fn) {
  let busy = false;
  return async function guarded(ev) {
    if (busy) return;
    busy = true;
    const target = ev?.currentTarget;
    if (target?.setAttribute) target.setAttribute('aria-busy', 'true');
    try {
      await fn.call(this, ev);
    } finally {
      busy = false;
      if (target && target.isConnected) target.removeAttribute('aria-busy');
    }
  };
}

export function iconBtn(name, label, onclick, opts = {}) {
  return btn(label, onclick, { ...opts, icon: name, iconOnly: true, variant: opts.variant || 'icon' });
}

export function pageHead(title, opts = {}) {
  return h('header', { class: 'page-head' },
    opts.back ? h('a', { class: 'btn btn-icon back', href: opts.back, 'aria-label': 'Back', title: 'Back' }, icon('back')) : null,
    h('div', { class: 'page-title' },
      opts.kicker ? h('p', { class: 'kicker' }, opts.kicker) : null,
      h('h1', { id: 'page-title', tabindex: '-1' }, title)),
    opts.actions ? h('div', { class: 'page-actions' }, opts.actions) : null);
}

export function emptyState(title, text, action = null, iconName = 'info') {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    h('p', { class: 'empty-title' }, title),
    text ? h('p', { class: 'muted' }, text) : null,
    action);
}

let fieldSeq = 0;
/** Labelled form field. control is an element; returns wrapper. */
export function field(labelText, control, opts = {}) {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  const hintId = opts.hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: ['field', opts.class] },
    h('label', { for: id }, labelText, opts.unit ? h('span', { class: 'unit' }, ` (${opts.unit})`) : null),
    control,
    opts.hint ? h('p', { class: 'hint', id: hintId }, opts.hint) : null);
}

export function input(props = {}) {
  return h('input', { type: 'text', autocomplete: 'off', ...props });
}

/** Numeric input that accepts comma decimals; uses text type to allow "," on all keyboards. */
export function numInput(value, props = {}) {
  return h('input', {
    type: 'text', inputmode: props.integer ? 'numeric' : 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    pattern: props.integer ? '[0-9]*' : null,
    value: value === null || value === undefined ? '' : fmtNum(value, 3),
    ...props, integer: null,
  });
}

export function select(options, value, props = {}) {
  return h('select', props, options.map((o) => {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value ?? '') }, label);
  }));
}

export function textarea(value, props = {}) {
  return h('textarea', { rows: 2, ...props, value: value || '' });
}

export function checkbox(labelText, checked, onchange, props = {}) {
  const id = `c${++fieldSeq}`;
  return h('div', { class: 'check' },
    h('input', { type: 'checkbox', id, checked, onchange: (e) => onchange(e.target.checked), ...props }),
    h('label', { for: id }, labelText));
}

/** Segmented control. options: [[value, label]] */
export function segmented(options, value, onchange, label = 'Options') {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const [v, l] of options) {
    group.append(h('button', {
      type: 'button', class: 'seg', 'aria-pressed': String(v === value),
      onclick: () => onchange(v),
    }, l));
  }
  return group;
}

// ---------- toasts ----------

export function toast(message, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: ['toast', opts.type ? `toast-${opts.type}` : ''], role: opts.type === 'error' ? 'alert' : 'status' },
    opts.type === 'error' ? icon('warn') : null,
    h('span', null, message),
    opts.action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { opts.action.run(); dismiss(); } }, opts.action.label) : null,
    h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x')));
  host.append(el);
  const timer = setTimeout(dismiss, opts.duration ?? (opts.action ? 6000 : 3500));
  function dismiss() {
    clearTimeout(timer);
    el.remove();
  }
  return dismiss;
}

// ---------- dialogs ----------

/**
 * Generic modal dialog using <dialog>. build(close) returns body content.
 * Resolves with the value passed to close(), or undefined when dismissed.
 */
export function openDialog({ title, build, wide = false, sheet = true, className = '' }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: ['dialog', sheet ? 'sheet' : '', wide ? 'wide' : '', className], 'aria-labelledby': 'dlg-title' });
    let result;
    const close = (value) => { result = value; dlg.close(); };
    const head = h('div', { class: 'dialog-head' },
      h('h2', { id: 'dlg-title' }, title),
      iconBtn('x', 'Close', () => close(undefined)));
    const body = h('div', { class: 'dialog-body' });
    dlg.append(head, body);
    append(body, [build(close, body)]);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(undefined); });
    document.body.append(dlg);
    dlg.showModal();
    const auto = body.querySelector('[autofocus]');
    if (auto) auto.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, requireText = null }) {
  return openDialog({
    title,
    sheet: false,
    build: (close) => {
      const confirmBtn = btn(confirmLabel, () => close(true), { variant: danger ? 'danger' : 'primary', disabled: !!requireText });
      let typed = null;
      if (requireText) {
        typed = input({
          'aria-label': `Type ${requireText} to confirm`,
          placeholder: requireText,
          oninput: (e) => { confirmBtn.disabled = e.target.value.trim() !== requireText; },
        });
      }
      return h('div', null,
        typeof message === 'string' ? h('p', null, message) : message,
        typed ? field(`Type ${requireText} to confirm`, typed) : null,
        h('div', { class: 'dialog-actions' }, btn(cancelLabel, () => close(false), { variant: 'ghost', class: 'cancel' }), confirmBtn));
    },
  }).then((v) => v === true);
}

/** Simple menu of actions in a sheet. items: [{label, icon, run, danger, hidden}] */
export function actionSheet(title, items) {
  return openDialog({
    title,
    build: (close) => h('div', { class: 'action-list' }, items.filter((i) => !i.hidden).map((i) =>
      h('button', { type: 'button', class: ['action-item', i.danger ? 'danger' : ''], onclick: () => { close(); setTimeout(() => i.run(), 0); } },
        i.icon ? icon(i.icon) : null, h('span', null, i.label), i.hint ? h('small', { class: 'muted' }, i.hint) : null))),
  });
}

// ---------- misc ----------

/** Restore focus to an element with the same data-focus key after a re-render. */
export function captureFocus(root) {
  const a = document.activeElement;
  if (!a || !root.contains(a) || !a.dataset.focus) return () => {};
  const key = a.dataset.focus;
  const sel = typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  return () => {
    const el = root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(...sel); } catch { /* ignore */ } }
    }
  };
}

export function downloadFile(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('Could not read the file.'));
    r.readAsText(file);
  });
}

export function meter(value, max, label) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value), 'aria-label': label },
    h('div', { class: 'meter-fill', style: { width: `${pct}%` } }));
}
