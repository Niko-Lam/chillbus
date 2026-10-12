/* ============================================================
   map.js — Leaflet 地圖封裝
   ============================================================ */
import { $, el, clear } from './core.js';

let map = null;
let layers = { walk: [], bus: [], markers: [] };
let pickHandler = null;
let onPickCb = null;
let ready = false;

export const mapAvailable = () => typeof window !== 'undefined' && !!window.L;
const isSheet = () => window.matchMedia('(max-width: 1180px)').matches;

export function initMap(containerId = 'map') {
  if (map || !mapAvailable()) return map;
  const node = document.getElementById(containerId);
  if (!node) return null;
  map = window.L.map(node, { zoomControl: true, attributionControl: true, preferCanvas: true })
    .setView([22.3193, 114.1694], 13);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, detectRetina: true, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.on('click', (e) => { if (onPickCb) onPickCb(e.latlng); });
  ready = true;
  setTimeout(() => map.invalidateSize(), 120);
  window.addEventListener('resize', () => setTimeout(() => map && map.invalidateSize(), 160));
  return map;
}
export const isReady = () => ready;
export function invalidate() { setTimeout(() => map && map.invalidateSize(), 90); }

/* ---------- dock 開合 ---------- */
export function openDock() {
  if (!isSheet()) return;
  const dock = $('#mapDock');
  if (dock) dock.classList.add('is-open');
  invalidate();
}
export function closeDock() {
  const dock = $('#mapDock');
  if (dock) dock.classList.remove('is-open');
}
export const dockOpen = () => !!($('#mapDock') && $('#mapDock').classList.contains('is-open'));

/* ---------- 圖層 ---------- */
export function clearMap({ keepBase = true } = {}) {
  if (!map) return;
  for (const k of ['walk', 'bus', 'markers']) { layers[k].forEach((l) => map.removeLayer(l)); layers[k] = []; }
  if (!keepBase && map) { map.eachLayer((l) => { if (l instanceof window.L.TileLayer) map.removeLayer(l); }); }
}

function pinIcon(kind, text) {
  const cls = { place: 'pin-place', board: 'pin-board', alight: 'pin-alight', stop: 'pin-stop', me: 'pin-board' }[kind] || 'pin-stop';
  return window.L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26],
    html: `<div class="map-pin ${cls}"><i>${text || ''}</i></div>`,
  });
}

export function setMarkers(list = []) {
  if (!map) return;
  layers.markers.forEach((l) => map.removeLayer(l));
  layers.markers = [];
  for (const m of list) {
    if (m.lat == null || m.lng == null) continue;
    const mk = window.L.marker([m.lat, m.lng], { icon: pinIcon(m.kind, m.text), zIndexOffset: m.kind === 'me' ? 800 : 400 }).addTo(map);
    if (m.label) {
      mk.bindPopup(`<b>${escapeTxt(m.label)}</b>${m.sub ? `<br><span style="opacity:.7">${escapeTxt(m.sub)}</span>` : ''}`);
    }
    layers.markers.push(mk);
    if (m.open) mk.openPopup();
  }
}
const escapeTxt = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function drawWalk(coords = [], { color = '#2563eb', dashed = true, opacity = 0.9 } = {}) {
  if (!map || !coords.length) return;
  const line = window.L.polyline(coords, { color, weight: 5, opacity, dashArray: dashed ? '1 9' : null, lineCap: 'round' }).addTo(map);
  layers.walk.push(line);
}
export function drawBus(coords = [], { color = '#0f766e', opacity = 0.95 } = {}) {
  if (!map || !coords.length) return;
  const casing = window.L.polyline(coords, { color: '#ffffff', weight: 9, opacity: 0.55, lineCap: 'round' }).addTo(map);
  const line = window.L.polyline(coords, { color, weight: 5.5, opacity, lineCap: 'round' }).addTo(map);
  layers.bus.push(casing, line);
}

export function fit(points = [], { pad = 60, maxZoom = 17, single = 15 } = {}) {
  if (!map) return;
  const pts = points.filter((p) => p && p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
  if (!pts.length) return;
  if (pts.length === 1) { map.setView(pts[0], single); return; }
  map.fitBounds(window.L.latLngBounds(pts), { padding: [pad, pad], maxZoom });
}

/* ---------- 點選模式 ---------- */
export function beginPick(cb, hint = '點一下地圖選位置') {
  if (!map) return false;
  onPickCb = cb;
  const hintEl = $('#mapHint');
  if (hintEl) { hintEl.hidden = false; hintEl.textContent = hint; }
  const node = document.getElementById('map');
  if (node) node.style.cursor = 'crosshair';
  openDock();
  return true;
}
export function endPick() {
  onPickCb = null;
  const hintEl = $('#mapHint');
  if (hintEl) hintEl.hidden = true;
  const node = document.getElementById('map');
  if (node) node.style.cursor = '';
}

/* ---------- 圖例 ---------- */
export function setLegend(items = []) {
  const box = $('#mapLegend');
  if (!box) return;
  clear(box);
  for (const it of items) {
    box.appendChild(el('span', { class: 'legend-chip' }, [
      el('i', { class: 'legend-dot', style: { background: it.color || 'var(--brand)' } }),
      it.href ? el('a', { href: it.href, text: it.text, style: { color: 'inherit' } }) : el('span', { text: it.text }),
      it.value ? el('b', { text: it.value }) : null,
    ]));
  }
}

/* ---------- 高階：顯示一條完整行程 ---------- */
export function showTrip({ from, to, board, alight, walkTo, walkFrom, busPath, legend, autoOpen = true } = {}) {
  if (!map) return;
  clearMap();
  if (walkTo && walkTo.coords) drawWalk(walkTo.coords, { color: '#2563eb' });
  if (busPath && busPath.length) drawBus(busPath);
  if (walkFrom && walkFrom.coords) drawWalk(walkFrom.coords, { color: '#2563eb' });
  const markers = [];
  if (from) markers.push({ ...from, kind: from.kind || 'place', text: '起', label: from.label, sub: from.sub });
  if (board) markers.push({ ...board, kind: 'board', text: '上', label: board.label, sub: board.sub });
  if (alight) markers.push({ ...alight, kind: 'alight', text: '落', label: alight.label, sub: alight.sub });
  if (to) markers.push({ ...to, kind: 'place', text: '終', label: to.label, sub: to.sub });
  setMarkers(markers);
  const pts = [...markers];
  if (walkTo && walkTo.coords) pts.push(...walkTo.coords.map(([lat, lng]) => ({ lat, lng })));
  if (walkFrom && walkFrom.coords) pts.push(...walkFrom.coords.map(([lat, lng]) => ({ lat, lng })));
  if (busPath) pts.push(...busPath.map(([lat, lng]) => ({ lat, lng })));
  fit(pts, { pad: 54 });
  if (legend) setLegend(legend);
  if (autoOpen) openDock();
}

/* ---------- 高階：只顯示步行 ---------- */
export function showWalk({ from, to, walk, title, subtitle } = {}) {
  if (!map) return;
  clearMap();
  if (walk && walk.coords) drawWalk(walk.coords, { color: '#2563eb' });
  setMarkers([
    from ? { ...from, kind: 'place', text: '起', label: from.label } : null,
    to ? { ...to, kind: to.kind || 'board', text: to.text || '上', label: to.label } : null,
  ].filter(Boolean));
  fit([from, to, ...(walk && walk.coords || []).map(([lat, lng]) => ({ lat, lng }))].filter(Boolean), { pad: 64 });
  if (walk) {
    setLegend([
      { color: '#2563eb', text: title || '步行', value: `${Math.round(walk.duration / 60)} 分鐘 · ${(walk.distance / 1000).toFixed(2)} 公里` },
      walk.source === 'estimate' ? { color: '#e08600', text: subtitle || '直線估算' } : null,
    ].filter(Boolean));
  }
  openDock();
}

/** 只標示一批車站（選站用） */
export function showStops(stops = [], { focus, label } = {}) {
  if (!map) return;
  clearMap();
  setMarkers(stops.map((s) => ({ lat: s.lat, lng: s.lng, kind: 'stop', text: '', label: s.name, sub: `#${s.seq}` })));
  if (focus) fit(stops, { pad: 50 });
  setLegend(label ? [{ color: 'var(--brand)', text: label }] : []);
}

/** 規劃結果視圖 */
export function showPlan(option, { open = true } = {}) {
  if (!map || !option) return;
  clearMap();
  const legs = option.legs || [];
  for (const leg of legs) {
    if (leg.type === 'walk' && leg.coords) drawWalk(leg.coords, { color: '#2563eb' });
    if (leg.type === 'bus' && leg.coords) drawBus(leg.coords, { color: '#0f766e' });
  }
  const markers = [];
  if (option.from) markers.push({ lat: option.from.lat, lng: option.from.lng, kind: 'place', text: '起', label: option.from.name });
  if (option.to) markers.push({ lat: option.to.lat, lng: option.to.lng, kind: 'place', text: '終', label: option.to.name });
  option.transfers?.forEach((t) => markers.push({ lat: t.lat, lng: t.lng, kind: 'stop', text: '轉', label: t.name }));
  const busLegs = legs.filter((l) => l.type === 'bus');
  if (busLegs[0]) markers.push({ lat: busLegs[0].fromStop.lat, lng: busLegs[0].fromStop.lng, kind: 'board', text: '上', label: busLegs[0].fromStop.name });
  const last = busLegs[busLegs.length - 1];
  if (last) markers.push({ lat: last.toStop.lat, lng: last.toStop.lng, kind: 'alight', text: '落', label: last.toStop.name });
  setMarkers(markers);
  const pts = [...markers, ...legs.flatMap((l) => (l.coords || []).map(([lat, lng]) => ({ lat, lng })))];
  fit(pts, { pad: 56 });
  setLegend([
    { color: '#2563eb', text: '步行', value: `${Math.round(option.walkSec / 60)} 分` },
    { color: '#0f766e', text: '巴士', value: `${Math.round(option.rideSec / 60)} 分` },
    { color: 'var(--muted)', text: `共 ${option.busCount} 程` },
  ]);
  if (open) openDock();
}
