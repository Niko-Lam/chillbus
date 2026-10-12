/* ============================================================
   main.js — 啟動
   ============================================================ */
import {
  state, loadState, $, toast, setNet, notifPermission, requestNotif, on, commit,
} from './core.js';
import { initMap, openDock, closeDock, mapAvailable, invalidate } from './map.js';
import { initViews, setView, renderAll, loadDemo, getCurrentView, showCurrentTripMap } from './views.js';
import { openSettings } from './editors.js';
import * as monitor from './monitor.js';
import { openModal } from './modal.js';

function boot() {
  loadState();
  initMap('map');
  initViews();
  wireChrome();
  monitor.startTicker();
  monitor.restoreMonitors();
  setView('go');
  paintNotifButton();
  registerSW();
  firstRunCheck();
  if (!mapAvailable()) setNet('local', '地圖載入中');
}

function wireChrome() {
  $('#btnSettings')?.addEventListener('click', () => openSettings());
  $('#btnNotif')?.addEventListener('click', async () => {
    const p = notifPermission();
    if (p === 'granted') {
      state.settings.notify = !state.settings.notify;
      commit();
      toast(state.settings.notify ? '通知已開啟' : '通知已關閉', {
        body: state.settings.notify ? '夠鐘出發會彈窗提醒你。' : '你仍然會喺 App 內收到提示。',
        type: state.settings.notify ? 'calm' : 'info',
      });
    } else {
      const r = await requestNotif();
      if (r === 'granted') { state.settings.notify = true; commit(); toast('已開啟通知 ✓', { body: '記得保持分頁開住。', type: 'calm' }); }
      else toast('未能開啟通知', { body: '你仍會喺 App 內見到提醒；可以喺瀏覽器設定開啟通知。', type: 'info' });
    }
    paintNotifButton();
  });
  $('#btnCloseMap')?.addEventListener('click', () => closeDock());
  $('#btnOpenMap')?.addEventListener('click', () => { showCurrentTripMap(); openDock(); invalidate(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDock();
    if (e.key === '1') setView('go');
    if (e.key === '2') setView('routes');
    if (e.key === '3') setView('plan');
    if (e.key === '4') setView('places');
  });
  window.addEventListener('online', () => setNet('ok', '實時連線'));
  window.addEventListener('offline', () => setNet('err', '離線中'));
}

function paintNotifButton() {
  const btn = $('#btnNotif');
  const label = $('#notifLabel');
  if (!btn) return;
  const on_ = notifPermission() === 'granted' && state.settings.notify;
  btn.classList.toggle('is-on', on_);
  if (label) label.textContent = on_ ? '通知開' : '通知';
}

function firstRunCheck() {
  if (state.routes.length || localStorage.getItem('chillbus.seen')) return;
  localStorage.setItem('chillbus.seen', '1');
  const modal = openModal({
    title: '歡迎使用 ChillBus 🚌',
    subtitle: '唔使再為咗巴士拼命跑',
    body: [
      el2('p', { class: 'note', text: 'ChillBus 會幫你計好由出發點行去巴士站要幾久，實時睇住巴士幾時到，夠鐘就彈窗提你出門 — 唔使再喺巴士站望住尾燈。' }),
      el2('div', { class: 'card-body', style: { padding: '0', display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        featureRow('clock', '自動計出發時間', '巴士到站時間 − 你行路時間 − 緩衝 = 出門時間'),
        featureRow('bell', '實時監控同提醒', '到站時間一有變就即刻更新，夠鐘彈窗叫你。'),
        featureRow('route', 'A 點去 B 點規劃', '用你儲存嘅巴士路線，計出最快嘅行法。'),
      ]),
      el2('div', { class: 'note', text: '支援九巴、龍運同城巴實時到站資料（資料來源：香港政府資料一線通）。所有資料只儲存在你部裝置。' }),
    ],
    footer: [
      el2('button', { class: 'btn line', text: '自己新增路線', onclick: () => modal.close() }),
      el2('button', { class: 'btn primary', text: '載入示範路線', onclick: () => { modal.close(); loadDemo(); } }),
    ],
  });
}
const el2 = (tag, props, children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => n.appendChild(c));
  return n;
};
function featureRow(icon, title, text) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.3V12l3.1 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    bell: '<path d="M6.2 9.2a5.8 5.8 0 1 1 11.6 0c0 3.9 1.5 5.3 1.5 5.3H4.7s1.5-1.4 1.5-5.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 18.2a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    route: '<path d="M6 3.8v16.4M18 3.8v16.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 8.6h7.4l3.1 3.1H6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  };
  return el2('div', { class: 'hstack', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
    el2('div', { class: 'icon-btn sm', style: { background: 'var(--brand-soft)', borderColor: 'transparent', color: 'var(--brand)' }, html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${paths[icon]}</svg>` }),
    el2('div', {}, [el2('b', { text: title, style: { fontSize: '13.8px' } }), el2('div', { class: 'li-sub', text })]),
  ]);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
