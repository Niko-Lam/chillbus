/* ============================================================
   core.js — 工具、狀態、快取、通知
   ============================================================ */

/* ---------- DOM helpers ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * el('div', {class:'x', onclick:fn}, [children|string])
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'for') node.htmlFor = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}
export function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}
export const frag = (children) => append(document.createDocumentFragment(), children);
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export function svgIcon(name, size = 18) {
  const paths = ICONS[name] || ICONS.dot;
  return el('span', { class: 'ico-svg', style: { display: 'grid', placeItems: 'center', width: size + 'px', height: size + 'px' }, html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">${paths}</svg>` });
}
export const ICONS = {
  dot: '<circle cx="12" cy="12" r="3.4" fill="currentColor"/>',
  walk: '<circle cx="13" cy="4.6" r="1.9" stroke="currentColor" stroke-width="1.7"/><path d="M12.6 8.2 9.9 11l1.5 3.2-1.6 5.6M12.6 8.2 16 10l2.3 3.4M11.4 14.2l-3.6.4-1.4 5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  bus: '<rect x="4.4" y="3.6" width="15.2" height="13.4" rx="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.6 9.6h14.8M9 17v2.6M15 17v2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8.6" cy="13.6" r="1.15" fill="currentColor"/><circle cx="15.4" cy="13.6" r="1.15" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.3V12l3.1 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10.2" r="2.5" stroke="currentColor" stroke-width="1.7"/>',
  flag: '<path d="M6 21V4.5M6 5.2h11.6l-2.2 3.9 2.2 3.9H6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  swap: '<path d="M7.5 4.6 4.2 7.9l3.3 3.3M4.4 7.9h15.2M16.5 19.4l3.3-3.3-3.3-3.3M19.6 16.1H4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="8.6" y="8.6" width="11.4" height="11.4" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M15.4 5.6a3 3 0 0 0-2.8-1.6H7a3 3 0 0 0-3 3v5.6a3 3 0 0 0 1.6 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  trash: '<path d="M4.8 6.8h14.4M9.4 6.6V4.9A1.4 1.4 0 0 1 10.8 3.5h2.4a1.4 1.4 0 0 1 1.4 1.4v1.7M6.6 6.9l.8 12.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.8-12.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5.4v13.2M5.4 12h13.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  bell: '<path d="M6.2 9.2a5.8 5.8 0 1 1 11.6 0c0 3.9 1.5 5.3 1.5 5.3H4.7s1.5-1.4 1.5-5.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 18.2a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  bellOff: '<path d="M6.2 9.2a5.8 5.8 0 0 1 8.6-5M18 10.6c0 3.9 1.3 3.9 1.3 3.9H7.4M4.6 4.4l14.8 15.2M10 18.2a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  tick: '<path d="m5.4 12.6 4.3 4.3 8.9-9.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  edit: '<path d="M15.2 4.6l4.2 4.2M4.5 19.5l1-4L16 5.1a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.4 18.5l-3.9 1Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  route: '<path d="M6 3.8v16.4M18 3.8v16.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 8.6h7.4l3.1 3.1H6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  play: '<path d="M7.6 5.4 18 12 7.6 18.6V5.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  pause: '<path d="M9 5.6v12.8M15 5.6v12.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  target: '<circle cx="12" cy="12" r="7.6" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.4" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  arrow: '<path d="m9.6 5.4 6.6 6.6-6.6 6.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="m14.4 5.4-6.6 6.6 6.6 6.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  warn: '<path d="M12 4.2 2.8 20h18.4L12 4.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4.3M12 17.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5.4M12 7.9v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  home: '<path d="M4.4 10.6 12 4.3l7.6 6.3v8.1a1.6 1.6 0 0 1-1.6 1.6H5.9a1.6 1.6 0 0 1-1.5-1.6v-8.1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  work: '<rect x="3.7" y="7.4" width="16.6" height="12.2" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M9 7.2V5.9a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 5.9v1.3" stroke="currentColor" stroke-width="1.7"/>',
  layers: '<path d="m12 3.6 8.4 4.6L12 12.8 3.6 8.2 12 3.6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m3.6 13.2 8.4 4.6 8.4-4.6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  refresh: '<path d="M20 11.4a8 8 0 1 0-.8 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20.4 5.6v5.8h-5.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  train: '<rect x="5" y="3.6" width="14" height="13" rx="3.4" stroke="currentColor" stroke-width="1.7"/><path d="M5.4 9.4h13.2M12 16.6v3.2M8.6 19.8l1.4-3.2M15.4 19.8 14 16.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9.2" cy="13.3" r="1" fill="currentColor"/><circle cx="14.8" cy="13.3" r="1" fill="currentColor"/>',
};

/* ---------- 格式化 ---------- */
const pad = (n) => String(n).padStart(2, '0');
export const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtClockSec = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} 秒`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}
export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m / 10) * 10} 米` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`;
}
export function fmtRel(sec) {
  sec = Math.round(sec);
  if (sec <= -30) return `已過 ${fmtDuration(-sec)}`;
  if (sec < 30) return '即將到站';
  return `${Math.ceil(sec / 60)} 分鐘`;
}

/* ---------- 數學 / 地理 ---------- */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const polylineLength = (pts) => pts.reduce((sum, p, i) => i ? sum + haversine(pts[i - 1], p) : 0, 0);
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
export function debounce(fn, ms = 260) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------- 事件匯流排 ---------- */
const bus = new EventTarget();
export const on = (evt, fn) => { bus.addEventListener(evt, fn); return () => bus.removeEventListener(evt, fn); };
export const emit = (evt, detail) => bus.dispatchEvent(new CustomEvent(evt, { detail }));

/* ---------- 設定 / 狀態 ---------- */
const LS_KEY = 'chillbus.state.v1';

export const DEFAULT_SETTINGS = {
  walkSpeed: 1.25,      // m/s
  bufferSec: 90,        // 保險時間
  pollSec: 30,          // 輪詢秒數
  notify: true,
  sound: true,
  vibrate: true,
  useLocation: true,
  bigNumbers: true,
};

function blankState() {
  return {
    version: 1,
    places: [],
    routes: [],
    activeRouteId: null,
    boarded: {},          // routeId -> { at, alightEta }
    settings: { ...DEFAULT_SETTINGS },
    meta: { createdAt: Date.now(), demo: false },
  };
}

export const state = blankState();

function normalize(s) {
  const base = blankState();
  const out = {
    ...base, ...(s || {}),
    settings: { ...base.settings, ...((s && s.settings) || {}) },
    meta: { ...base.meta, ...((s && s.meta) || {}) },
  };
  out.places = Array.isArray(out.places) ? out.places : [];
  out.routes = Array.isArray(out.routes) ? out.routes : [];
  return out;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(state, normalize(JSON.parse(raw)));
  } catch (e) { console.warn('[chillbus] load failed', e); }
  return state;
}

let saveTimer = null;
export function saveState({ immediate = false } = {}) {
  const doIt = () => {
    saveTimer = null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[chillbus] save failed', e); toast('儲存失敗', { body: '瀏覽器儲存空間可能已滿。', type: 'alert' }); }
  };
  if (immediate) { clearTimeout(saveTimer); doIt(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doIt, 220);
}
export function commit(evt = 'state') { saveState(); emit(evt); }
export function replaceState(next) {
  Object.assign(state, normalize(next));
  saveState({ immediate: true });
  emit('state');
}

/* ---------- 查詢 ---------- */
export const getPlace = (id) => state.places.find((p) => p.id === id) || null;
export const getRoute = (id) => state.routes.find((r) => r.id === id) || null;
export const activeRoute = () => getRoute(state.activeRouteId) || state.routes[0] || null;
export const companyName = (co) => ({ KMB: '九巴', LWB: '龍運', CTB: '城巴', NLB: '嶼巴', GMB: '綠色小巴' }[co] || co);
export const companyFull = (co) => ({ KMB: '九龍巴士', LWB: '龍運巴士', CTB: '城巴', NLB: '新大嶼山巴士', GMB: '專線小巴' }[co] || co);
export function routeLabel(r) { return `${companyName(r.co)} ${r.route}`; }
export function dirLabel(r) { return `往 ${r.dest || r.dest_tc || ''}`; }

/* ---------- IndexedDB 快取 ---------- */
const DB_NAME = 'chillbus-cache', STORE = 'kv';
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}
export async function cacheGet(key, { allowStale = false } = {}) {
  try {
    const db = await openDB();
    const rec = await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!rec) return null;
    if (!allowStale && rec.exp && rec.exp < Date.now()) return null;
    return rec.v;
  } catch { return null; }
}
export async function cacheSet(key, v, ttlMs) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ v, exp: ttlMs ? Date.now() + ttlMs : 0 }, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* 快取失敗不影響主流程 */ }
}
export async function cacheClear(prefix = '') {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const r = store.getAllKeys();
      r.onsuccess = () => { r.result.filter((k) => String(k).startsWith(prefix)).forEach((k) => store.delete(k)); };
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* noop */ }
}

/* ---------- 記憶體快取（同一次瀏覽階段） ---------- */
const mem = new Map();
export async function memo(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await fn();
  mem.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}
export const memoClear = (prefix = '') => { for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k); };

/* ---------- 提示 / 通知 ---------- */
const TOAST_ICON = { info: 'info', alert: 'warn', calm: 'tick', go: 'bus' };
export function toast(title, { body = '', type = 'info', ms = 4200, onClick } = {}) {
  const root = $('#toasts');
  if (!root) return () => {};
  const node = el('div', { class: `toast ${type}` }, [
    el('div', { class: 'ti', html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${ICONS[TOAST_ICON[type] || 'info']}</svg>` }),
    el('div', { class: 'tb' }, [el('b', { text: title }), body ? el('span', { text: body }) : null]),
  ]);
  if (onClick) { node.style.cursor = 'pointer'; node.addEventListener('click', () => { onClick(); dismiss(); }); }
  root.appendChild(node);
  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(dismiss, ms);
  node.addEventListener('click', () => clearTimeout(timer), { once: true });
  return dismiss;
}

export const notifSupported = () => 'Notification' in window;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');
export async function requestNotif() {
  if (!notifSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

let audioCtx = null;
export function beep(pattern = 'go') {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const seq = pattern === 'urgent' ? [[880, 0], [1180, .18], [880, .36]] : pattern === 'alight' ? [[660, 0], [990, .16]] : [[784, 0], [1046, .16]];
    for (const [freq, at] of seq) {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t0 = audioCtx.currentTime + at;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(.16, t0 + .02);
      gain.gain.exponentialRampToValueAtTime(.0008, t0 + .26);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + .3);
    }
  } catch { /* 忽略 */ }
}
export function vibrate(pattern = [90, 60, 90]) {
  if (!state.settings.vibrate) return;
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* 忽略 */ }
}

/**
 * 系統通知 + App 內提示 + 聲音
 */
export function alertUser(title, body, { type = 'go', sound = 'go', vibrate: vib = true, force = false } = {}) {
  toast(title, { body, type, ms: type === 'alert' ? 12000 : 7000 });
  if (sound) beep(type === 'alert' ? 'urgent' : sound);
  if (vib) vibrate(type === 'alert' ? [140, 70, 140, 70, 220] : [90, 60, 90]);
  if (!state.settings.notify && !force) return;
  try {
    if (notifSupported() && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      const n = new Notification(title, { body, tag: `chillbus-${title}`, icon: './assets/icon.svg', badge: './assets/icon.svg' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* 忽略 */ }
}

/* ---------- 連線狀態 ---------- */
export function setNet(stateName, label) {
  const pill = $('#netPill');
  if (!pill) return;
  pill.dataset.state = stateName;
  const span = pill.querySelector('span');
  if (span && label) span.textContent = label;
}
