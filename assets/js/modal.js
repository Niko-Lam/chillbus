/* ============================================================
   modal.js — 彈窗 / 對話框
   ============================================================ */
import { $, el, clear, svgIcon } from './core.js';

let stack = [];

export function openModal({ title = '', subtitle = '', body = [], footer = [], wide = false, onClose = null, dismissable = true } = {}) {
  const root = $('#modalRoot');
  const scrim = el('div', { class: 'scrim' });
  const titleWrap = el('div', { style: { flex: '1', minWidth: '0' } }, [
    el('h2', { text: title }),
    subtitle ? el('div', { class: 'sub', text: subtitle }) : null,
  ]);
  const head = el('div', { class: 'modal-head' }, [titleWrap]);
  const bodyEl = el('div', { class: 'modal-body' });
  const footEl = el('div', { class: 'modal-foot' });
  const modal = el('div', { class: `modal${wide ? ' wide' : ''}` }, [head, bodyEl, footEl]);
  scrim.appendChild(modal);
  root.appendChild(scrim);

  const api = {
    scrim, modal, body: bodyEl, head: titleWrap,
    setTitle(t) { titleWrap.querySelector('h2').textContent = t; },
    setSubtitle(t) {
      let s = titleWrap.querySelector('.sub');
      if (!s) { s = el('div', { class: 'sub' }); titleWrap.appendChild(s); }
      s.textContent = t;
    },
    setBody(children) { clear(bodyEl); const arr = Array.isArray(children) ? children : [children]; arr.filter(Boolean).forEach((c) => bodyEl.appendChild(c)); },
    setFooter(children) { clear(footEl); const arr = Array.isArray(children) ? children : [children]; arr.filter(Boolean).forEach((c) => footEl.appendChild(c)); },
    close,
  };

  if (dismissable) {
    const closeBtn = el('button', { class: 'icon-btn sm', 'aria-label': '關閉', html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${'<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'}</svg>`, onclick: () => close() });
    head.appendChild(closeBtn);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  }

  function onKey(e) { if (e.key === 'Escape' && dismissable) close(); }
  document.addEventListener('keydown', onKey);

  function close(result) {
    if (!scrim.isConnected) return;
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    stack = stack.filter((s) => s !== api);
    try { onClose && onClose(result); } catch { /* 忽略 */ }
  }

  api.setBody(body);
  api.setFooter(footer);
  stack.push(api);
  setTimeout(() => { const f = modal.querySelector('input,select,textarea,button.btn'); if (f) f.focus({ preventScroll: true }); }, 90);
  return api;
}

export function closeTop() { if (stack.length) stack[stack.length - 1].close(); }
export const modalStackSize = () => stack.length;

export function confirmDialog({ title, body, okText = '確定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: [el('p', { class: 'note', text: body })],
      footer: [
        el('button', { class: 'btn line', text: cancelText, onclick: () => finish(false) }),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: okText, onclick: () => finish(true) }),
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
    function finish(v) { done = true; resolve(v); m.close(); }
  });
}

/** 一分鐘內可復原的刪除確認；用於低風險項目 */
export function toastUndo() {
  return el('span');
}
