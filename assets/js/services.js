/* ============================================================
   services.js — 巴士實時數據 / 步行路線 / 地理編碼
   資料來源：
     · 九巴、龍運  https://data.etabus.gov.hk
     · 城巴        https://rt.data.gov.hk/v2/transport/citybus
     · 步行路線    OSRM (OpenStreetMap)
     · 地理編碼    Nominatim (OpenStreetMap)
   ============================================================ */
import { cacheGet, cacheSet, memo, setNet, state, haversine } from './core.js';

const KMB = 'https://data.etabus.gov.hk/v1/transport/kmb';
const CTB = 'https://rt.data.gov.hk/v2/transport/citybus';
const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

export class ApiError extends Error {
  constructor(message, { status, url } = {}) { super(message); this.name = 'ApiError'; this.status = status; this.url = url; }
}

/* ---------- HTTP（直連 → /api/proxy 回退） ---------- */
let transport = 'direct'; // 'direct' | 'proxy'
let inflight = 0;

function netStart() { inflight++; if (inflight === 1) setNet('loading', '連線中'); }
function netEnd(ok) {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) ok ? setNet('ok', '實時連線') : setNet('err', '連線不穩');
}

async function rawFetch(url, { timeout = 13000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`上游回應 ${res.status}`, { status: res.status, url });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new ApiError('上游回應格式不正確', { status: res.status, url });
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function viaProxy(url) {
  const p = `/api/proxy?url=${encodeURIComponent(url)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(p, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`代理回應 ${res.status}`, { status: res.status, url: p });
    return await res.json();
  } finally { clearTimeout(timer); }
}

export async function httpJson(url, opts = {}) {
  netStart();
  try {
    let data;
    if (transport === 'proxy') data = await viaProxy(url);
    else {
      try { data = await rawFetch(url, opts); }
      catch (err) {
        if (err && err.name === 'ApiError' && err.status && err.status !== 429 && err.status < 500) throw err;
        data = await viaProxy(url);          // CORS / 網絡問題 → 走代理
        transport = 'proxy';
      }
    }
    netEnd(true);
    return data;
  } catch (err) {
    netEnd(false);
    throw new ApiError('網絡連線失敗，請檢查網絡後再試。', { url });
  }
}

/** 有快取的 GET */
async function cachedJson(url, cacheKey, ttlMs, opts) {
  const hit = await cacheGet(cacheKey);
  if (hit) { setNet('ok', '實時連線'); return hit; }
  const data = await httpJson(url, opts);
  cacheSet(cacheKey, data, ttlMs);
  return data;
}

/* ---------- 路線探索 ---------- */
export const BOUNDS = { outbound: 'O', inbound: 'I' };
export const dirOf = (bound) => BOUNDS[bound] || 'O';
export const boundOf = (dir) => (dir === 'I' ? 'inbound' : 'outbound');

const normRouteNo = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * 依公司 + 路線號，找出所有可行方向（含 service type）
 * @returns {Promise<Array<{co,route,bound,dir,serviceType,orig,dest,key}>>}
 */
export async function resolveRoute(co, routeNo) {
  const route = normRouteNo(routeNo);
  if (!route) throw new ApiError('請輸入路線號碼。');
  if (co === 'CTB') return resolveCtb(route);
  return resolveKmb(route, co);
}

/** 九巴／龍運全路線清單（約 1,600 條，快取 7 日）— 一次過查清方向同班次類型 */
async function kmbRouteList() {
  const key = 'kmb:routes:all';
  let data = await cacheGet(key);
  if (!data) {
    const res = await httpJson(`${KMB}/route/`);
    data = (res.data || []).map((d) => ({
      route: d.route, bound: d.bound, serviceType: String(d.service_type || '1'),
      orig: d.orig_tc || d.orig_en, dest: d.dest_tc || d.dest_en,
    }));
    cacheSet(key, data, 7 * 864e5);
  }
  return data;
}

async function resolveKmb(route, co) {
  const all = await kmbRouteList();
  const hits = all.filter((d) => normRouteNo(d.route) === route);
  if (!hits.length) throw new ApiError(`搵唔到九巴／龍運路線「${route}」。請確認號碼後再試。`);
  const out = hits.map((d) => {
    const bound = d.bound === 'I' ? 'inbound' : 'outbound';
    return {
      co: co === 'LWB' ? 'LWB' : 'KMB', route: d.route, bound, dir: BOUNDS[bound], serviceType: d.serviceType,
      orig: d.orig, dest: d.dest, key: `KMB:${d.route}:${bound}:${d.serviceType}`,
    };
  });
  dedupe(out);
  return out;
}

async function resolveCtb(route) {
  const res = await httpJson(`${CTB}/route/CTB/${route}`);
  const d = res && res.data;
  if (!d || !d.route) throw new ApiError(`搵唔到城巴路線「${route}」。`);
  const list = [
    { bound: 'outbound', orig: d.orig_tc, dest: d.dest_tc },
    { bound: 'inbound', orig: d.dest_tc, dest: d.orig_tc },
  ];
  return list.map((x) => ({
    co: 'CTB', route: d.route, bound: x.bound, dir: BOUNDS[x.bound], serviceType: '',
    orig: x.orig, dest: x.dest, key: `CTB:${d.route}:${x.bound}:`,
  }));
}

function dedupe(list) {
  const seen = new Set();
  for (let i = list.length - 1; i >= 0; i--) {
    const k = `${list[i].bound}:${list[i].serviceType}`;
    if (seen.has(k)) list.splice(i, 1); else seen.add(k);
  }
  list.sort((a, b) => (a.bound === b.bound ? String(a.serviceType).localeCompare(String(b.serviceType)) : a.bound === 'outbound' ? -1 : 1));
}

/* ---------- 車站 ---------- */
/** 九巴全站索引（1.2MB，快取 7 日） */
async function kmbStopIndex() {
  const key = 'kmb:stops:all';
  let data = await cacheGet(key);
  if (!data) {
    const res = await httpJson(`${KMB}/stop`);
    data = {};
    for (const s of (res.data || [])) {
      data[s.stop] = { id: s.stop, name: s.name_tc || s.name_en, lat: +s.lat, lng: +s.long };
    }
    cacheSet(key, data, 7 * 864e5);
  }
  return data;
}

/** 城巴單站（快取 30 日） */
async function ctbStop(id) {
  const key = `ctb:stop:${id}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const res = await httpJson(`${CTB}/stop/${id}`);
  const d = res && res.data;
  if (!d || !d.stop) throw new ApiError(`搵唔到城巴車站 ${id}`);
  const stop = { id: d.stop, name: d.name_tc || d.name_en, lat: +d.lat, lng: +d.long };
  cacheSet(key, stop, 30 * 864e5);
  return stop;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 取得某路線方向的完整站序（含名稱與座標）
 * @returns {Promise<Array<{id,seq,name,lat,lng}>>}
 */
export async function fetchRouteStops({ co, route, bound, serviceType }) {
  const key = `routestops:${co}:${route}:${bound}:${serviceType || ''}`;
  return memo(key, 10 * 60e3, async () => {
    if (co === 'CTB') {
      const res = await httpJson(`${CTB}/route-stop/CTB/${route}/${bound}`);
      const rows = (res.data || []).slice().sort((a, b) => a.seq - b.seq);
      if (!rows.length) throw new ApiError('此方向暫時沒有站點資料。');
      const ids = rows.map((r) => r.stop);
      const details = await mapLimit(ids, 6, (id) => ctbStop(id));
      return rows.map((r, i) => {
        const d = details[i];
        return d ? { id: d.id, seq: i + 1, name: d.name, lat: d.lat, lng: d.lng } : null;
      }).filter(Boolean);
    }
    const [res, index] = await Promise.all([
      httpJson(`${KMB}/route-stop/${route}/${bound}/${serviceType || '1'}`),
      kmbStopIndex(),
    ]);
    const rows = (res.data || []).slice().sort((a, b) => +a.seq - +b.seq);
    if (!rows.length) throw new ApiError('此方向暫時沒有站點資料。');
    return rows.map((r, i) => {
      const d = index[r.stop];
      return d ? { id: d.id, seq: i + 1, name: d.name, lat: d.lat, lng: d.lng } : null;
    }).filter(Boolean);
  });
}

/* ---------- 實時到站 ---------- */
/**
 * @returns {Promise<Array<{at:number, seq:number, mins:number, dest:string, rmk:string, date:Date}>>}
 */
export async function fetchEta({ co, route, dir, serviceType, stopId }) {
  const url = co === 'CTB'
    ? `${CTB}/eta/CTB/${stopId}/${route}`
    : `${KMB}/eta/${stopId}/${route}/${serviceType || '1'}`;
  const res = await httpJson(url);
  const now = Date.now();
  const rows = (res.data || [])
    .filter((e) => !dir || e.dir === dir)
    .filter((e) => e.eta)
    .map((e) => {
      const date = new Date(e.eta);
      return {
        at: date.getTime(),
        mins: Math.max(0, Math.round((date.getTime() - now) / 60000)),
        secs: Math.round((date.getTime() - now) / 1000),
        seq: e.eta_seq,
        dest: e.dest_tc || e.dest_en || '',
        rmk: e.rmk_tc || '',
        date,
      };
    })
    .filter((e) => e.at > now - 90e3)
    .sort((a, b) => a.at - b.at);
  return rows.slice(0, 6);
}

/** 一次取得上車站＋下車站的實時到站，用於規劃 */
export async function fetchEtaPair(route, boardStopId, alightStopId) {
  const base = { co: route.co, route: route.route, dir: route.dir, serviceType: route.serviceType };
  const [board, alight] = await Promise.all([
    fetchEta({ ...base, stopId: boardStopId }).catch(() => []),
    alightStopId ? fetchEta({ ...base, stopId: alightStopId }).catch(() => []) : Promise.resolve([]),
  ]);
  return { board, alight };
}

/* ---------- 步行路線 ---------- */
const key4 = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
export const walkKey = (a, b) => `walk:${key4(a)}->${key4(b)}`;

/**
 * 步行路線；OSRM 失敗時退回直線估算
 * @returns {Promise<{distance:number,duration:number,coords:Array<[number,number]>,source:string}>}
 */
export async function walkRoute(from, to) {
  if (!from || !to) throw new ApiError('缺少起點或終點座標。');
  const key = walkKey(from, to);
  const cached = await cacheGet(key);
  if (cached) return cached;
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
  let result;
  try {
    const data = await httpJson(url, { timeout: 16000 });
    const r = data && data.routes && data.routes[0];
    if (!r) throw new ApiError('找不到步行路線');
    result = {
      distance: r.distance,
      duration: Math.round(r.duration),
      coords: (r.geometry && r.geometry.coordinates || []).map(([lng, lat]) => [lat, lng]),
      source: 'osrm',
    };
  } catch {
    const straight = haversine(from, to) * 1.28;
    result = { distance: straight, duration: Math.round(straight / (state.settings.walkSpeed || 1.25)), coords: [[from.lat, from.lng], [to.lat, to.lng]], source: 'estimate' };
  }
  cacheSet(key, result, 6 * 3600e3);
  return result;
}

/** 只取時間（供大量計算用，失敗不回退連線） */
export async function walkTime(from, to) {
  try { const r = await walkRoute(from, to); return r; }
  catch { return { distance: haversine(from, to) * 1.28, duration: Math.round(haversine(from, to) * 1.28 / (state.settings.walkSpeed || 1.25)), coords: [[from.lat, from.lng], [to.lat, to.lng]], source: 'estimate' }; }
}

/* ---------- 地理編碼 ---------- */
export async function geocode(q) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  return memo(`geo:${query}`, 24 * 3600e3, async () => {
    const url = `${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=zh-HK,zh-Hant,zh,en&q=${encodeURIComponent(query)}`;
    const res = await httpJson(url);
    return (Array.isArray(res) ? res : []).map((r) => ({
      label: r.display_name,
      name: r.name || String(r.display_name || '').split(',')[0],
      lat: +r.lat, lng: +r.lon,
      type: r.type,
    }));
  });
}

export async function reverseGeocode(lat, lng) {
  return memo(`rev:${lat.toFixed(5)},${lng.toFixed(5)}`, 24 * 3600e3, async () => {
    try {
      const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-HK,zh-Hant,zh,en`;
      const r = await httpJson(url);
      const addr = r && r.address;
      const name = (r && r.name) || (addr && (addr.road || addr.neighbourhood || addr.suburb)) || '目前位置';
      return { name, label: (r && r.display_name) || name, lat, lng };
    } catch { return { name: '目前位置', label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng }; }
  });
}

/**
 * 檢查定位係咪可用（瀏覽器只喺 HTTPS 或 localhost 先准用定位）
 * @returns {{ok:boolean, reason?:string, message?:string}}
 */
export function geoAvailability() {
  if (!('geolocation' in navigator)) {
    return { ok: false, reason: 'unsupported', message: '此瀏覽器不支援定位。' };
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      ok: false, reason: 'insecure',
      message: '瀏覽器只會喺 HTTPS 網址下提供定位。請用 https:// 開啟（Vercel 預設就係），或者用 localhost 測試。',
    };
  }
  return { ok: true };
}

/**
 * 連續定位（導航用）：每次位置有更新就回呼
 * @returns {() => void} 停止追蹤
 */
export function watchLocation(onPos, onErr, opts = {}) {
  const avail = geoAvailability();
  if (!avail.ok) {
    onErr && onErr(new ApiError(avail.message, {}));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onPos({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
      speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
      at: pos.timestamp || Date.now(),
    }),
    (err) => {
      if (!onErr) return;
      onErr(new ApiError(err.code === 1 ? '你未允許定位權限，請喺瀏覽器設定開啟。' : err.code === 3 ? '定位逾時，可能係室內訊號唔好。' : '暫時拎唔到位置。'));
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000, ...opts },
  );
  return () => { try { navigator.geolocation.clearWatch(id); } catch { /* 忽略 */ } };
}

/** 瀏覽器定位 */
export function locate({ timeout = 12000, maximumAge = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const avail = geoAvailability();
    if (!avail.ok) return reject(new ApiError(avail.message, {}));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() }),
      (err) => reject(new ApiError(err.code === 1 ? '你未允許定位權限。' : '暫時拎唔到位置。', {})),
      { enableHighAccuracy: true, timeout, maximumAge },
    );
  });
}

/* ---------- 路線上車程估算 ---------- */
export function rideEstimate(stops, fromSeq, toSeq, speedKmh = 17) {
  if (!stops || stops.length < 2) return { distance: 0, duration: 0 };
  const a = Math.max(0, fromSeq - 1), b = Math.min(stops.length - 1, toSeq - 1);
  if (b <= a) return { distance: 0, duration: 0 };
  let dist = 0;
  for (let i = a + 1; i <= b; i++) dist += haversine(stops[i - 1], stops[i]);
  const dwell = Math.max(0, b - a - 1) * 22;                     // 每站約 22 秒
  const run = dist / ((speedKmh * 1000) / 3600);
  return { distance: dist, duration: Math.round(run + dwell) };
}
