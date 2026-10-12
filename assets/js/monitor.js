/* ============================================================
   monitor.js — 實時監控、出發時間計算、彈窗提醒
   ============================================================ */
import { state, emit, on, alertUser, toast, getPlace, getRoute, activeRoute, clamp, haversine, projectOnPath } from './core.js';
import { fetchEta, walkRoute, locate, watchLocation, geoAvailability } from './services.js';

const monitors = new Map();     // routeId -> monitor record
let wakeLock = null;
const listeners = new Set();

/* ---------- 外部查詢 ---------- */
export const isMonitoring = (routeId) => monitors.has(routeId);
export const monitoringCount = () => monitors.size;
export const anyMonitoring = () => monitors.size > 0;
export function getMonitor(routeId) { return monitors.get(routeId) || null; }
export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => { listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); emit('monitor'); };

/* ---------- 螢幕常亮 ---------- */
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 忽略 */ }
}
function releaseWakeLock() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { /* 忽略 */ }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && anyMonitoring() && !wakeLock) acquireWakeLock();
});

/* ---------- 啟動 / 停止 ---------- */
export function startMonitor(routeId, { silent = false } = {}) {
  const route = getRoute(routeId);
  if (!route) return null;
  clearMonitoring(routeId);
  const rec = {
    routeId, route,
    boardEtas: [], alightEtas: [],
    walkTo: null, walkKey: null,
    myPos: null, originOverride: null,
    boarded: state.boarded[routeId] || null,
    status: null, alertKey: '',
    lastPoll: 0, lastError: null, polling: false, timer: null,
    alightAlertKey: '',
  };
  monitors.set(routeId, rec);
  acquireWakeLock();
  if (!silent) toast(`已開始監控 ${route.route}`, { body: '一路幫你睇住到站時間，夠鐘會提你出門。', type: 'calm' });
  poll(rec, { force: true });
  scheduleNext(rec);
  notify();
  return rec;
}

export function stopMonitor(routeId, { silent = false } = {}) {
  const rec = monitors.get(routeId);
  if (!rec) return;
  clearMonitoring(routeId);
  if (!anyMonitoring()) releaseWakeLock();
  if (!silent) toast('已停止監控', { body: rec.route ? `${rec.route.route} 唔再提你喇。` : '', type: 'info' });
  notify();
}

function clearMonitoring(routeId) {
  const rec = monitors.get(routeId);
  if (rec && rec.timer) clearTimeout(rec.timer);
  monitors.delete(routeId);
}

export function stopAll() { [...monitors.keys()].forEach((id) => stopMonitor(id, { silent: true })); }

function scheduleNext(rec) {
  if (rec.timer) clearTimeout(rec.timer);
  if (!monitors.has(rec.routeId)) return;
  const sec = clamp(+state.settings.pollSec || 30, 10, 300);
  rec.timer = setTimeout(() => { poll(rec).finally(() => scheduleNext(rec)); }, sec * 1000);
}

/* ---------- 一輪輪詢 ---------- */
async function poll(rec, { force = false } = {}) {
  if (rec.polling && !force) return;
  rec.polling = true;
  try {
    await resolveOrigin(rec);
    const route = rec.route;
    const base = { co: route.co, route: route.route, dir: route.dir, serviceType: route.serviceType };
    const [boardEtas, alightEtas] = await Promise.all([
      fetchEta({ ...base, stopId: route.boardStopId }),
      route.alightStopId ? fetchEta({ ...base, stopId: route.alightStopId }).catch(() => []) : Promise.resolve([]),
    ]);
    rec.boardEtas = boardEtas;
    rec.alightEtas = alightEtas;
    rec.lastError = null;
  } catch (err) {
    rec.lastError = err;
    if (force) toast('拎唔到實時到站', { body: err.message || '請稍後再試。', type: 'alert' });
  } finally {
    rec.polling = false;
    rec.lastPoll = Date.now();
    notify();
  }
}

async function resolveOrigin(rec) {
  const route = rec.route;
  const from = rec.originOverride || getPlace(route.fromPlaceId);
  if (!from) return;
  if (!rec.walkTo || rec.walkKey !== `${from.lat},${from.lng}->${route.boardStopId}`) {
    try {
      const w = await walkRoute(from, { lat: route.boardLat, lng: route.boardLng });
      rec.walkTo = { ...w, origin: { lat: from.lat, lng: from.lng, name: from.name } };
      rec.walkKey = `${from.lat},${from.lng}->${route.boardStopId}`;
    } catch { /* 保留舊值 */ }
  }
}

/** 用瀏覽器定位覆寫出發點（例如你已經行到街口） */
export async function useMyLocation(routeId) {
  const rec = monitors.get(routeId);
  if (!rec) return null;
  const pos = await locate();
  rec.myPos = pos;
  rec.originOverride = { lat: pos.lat, lng: pos.lng, name: '目前位置', accuracy: pos.accuracy };
  rec.walkTo = null; rec.walkKey = null;
  await poll(rec, { force: true });
  notify();
  return pos;
}
export function clearLocationOverride(routeId) {
  const rec = monitors.get(routeId);
  if (!rec) return;
  rec.originOverride = null; rec.walkTo = null; rec.walkKey = null;
  poll(rec, { force: true });
}

export function refresh(routeId) {
  const rec = monitors.get(routeId);
  if (!rec) return;
  rec.walkTo = null; rec.walkKey = null;
  poll(rec, { force: true });
}

/* ---------- 實時導航（似導航 App：藍點會跟住你行） ---------- */
const navs = new Map();                 // routeId -> nav record
const NAV = { offRouteM: 90, replanMovedM: 50, replanEveryMs: 12000, arrivedM: 25 };

export const isNavigating = (routeId) => navs.has(routeId);
export const getNav = (routeId) => navs.get(routeId) || null;
export const navigatingCount = () => navs.size;

export function startNavigation(routeId) {
  const route = getRoute(routeId);
  if (!route) return null;
  stopNavigation(routeId, { silent: true });
  const avail = geoAvailability();
  if (!avail.ok) {
    toast(avail.reason === 'insecure' ? '定位需要 HTTPS 🔒' : '無法使用定位', { body: avail.message, type: 'alert', ms: 10000 });
    return null;
  }
  const rec = {
    routeId, route,
    position: null, accuracy: null, heading: null,
    walk: null, remainSec: null, remainDist: null, ratio: 0, index: 0,
    offRoute: false, arrived: false, error: null, waiting: true, permissionDenied: false,
    lastReplanAt: 0, lastReplanPos: null, startedAt: Date.now(), watchStop: null,
  };
  navs.set(routeId, rec);
  notify();
  rec.watchStop = watchLocation(
    (pos) => { handleFix(rec, pos); },
    (err) => {
      if (!navs.has(routeId)) return;
      const hadFix = !!rec.position;
      rec.error = err;
      if (/權限/.test(err.message || '')) rec.permissionDenied = true;
      notify();
      // 已經有定位就唔好彈警示：行車/室內訊號一時間唔好係正常嘅
      if (!hadFix || rec.permissionDenied) toast('定位出錯', { body: err.message, type: 'alert' });
    },
  );
  toast('開始導航 🧭', { body: `實時顯示你嘅位置，同仲有幾遠到 ${route.boardName}。`, type: 'go' });
  return rec;
}

export function stopNavigation(routeId, { silent = false } = {}) {
  const rec = navs.get(routeId);
  if (!rec) return;
  try { rec.watchStop && rec.watchStop(); } catch { /* 忽略 */ }
  navs.delete(routeId);
  if (!silent) toast('已停止導航', { type: 'info' });
  notify();
}

export function stopAllNavigation() { [...navs.keys()].forEach((id) => stopNavigation(id, { silent: true })); }

async function handleFix(rec, pos) {
  if (!navs.has(rec.routeId)) return;
  rec.position = pos;
  rec.accuracy = pos.accuracy;
  rec.heading = pos.heading;
  rec.error = null;
  rec.waiting = false;

  const board = { lat: rec.route.boardLat, lng: rec.route.boardLng };
  let proj = rec.walk ? projectOnPath(rec.walk.coords, pos) : null;

  // 離開路線太遠，或者第一次 → 重新規劃
  const moved = rec.lastReplanPos ? haversine(rec.lastReplanPos, pos) : Infinity;
  const strayed = proj ? proj.offset > NAV.offRouteM : false;
  const needRoute = !rec.walk
    || (strayed && moved > NAV.replanMovedM && Date.now() - rec.lastReplanAt > NAV.replanEveryMs);

  if (needRoute) {
    try {
      const w = await walkRoute(pos, board);
      if (!navs.has(rec.routeId)) return;
      rec.walk = w;
      rec.lastReplanAt = Date.now();
      rec.lastReplanPos = { lat: pos.lat, lng: pos.lng };
      proj = projectOnPath(w.coords, pos);
      rec.offRoute = false;
    } catch { /* 保留舊路線 */ }
  } else {
    rec.offRoute = strayed;
  }

  // 剩餘距離／時間
  if (rec.walk) {
    const total = (proj && proj.total) || rec.walk.distance || 0;
    const leftM = proj ? Math.max(0, total - proj.along) : haversine(pos, board);
    rec.ratio = total > 0 ? clamp(1 - leftM / total, 0, 1) : 0;
    rec.remainDist = Math.round(leftM);
    rec.index = proj ? proj.index : 0;

    const baseSpeed = rec.walk.distance > 0 && rec.walk.duration > 0
      ? rec.walk.distance / rec.walk.duration
      : (state.settings.walkSpeed || 1.25);
    const gpsSpeed = (pos.speed != null && pos.speed > 0.4) ? pos.speed : null;
    const speed = gpsSpeed ? baseSpeed * 0.4 + gpsSpeed * 0.6 : baseSpeed;
    rec.remainSec = Math.max(0, Math.round(leftM / Math.max(0.5, speed)));

    if (!rec.arrived && rec.remainDist <= NAV.arrivedM) {
      rec.arrived = true;
      alertUser('到達巴士站 🚏', `你已經到 ${rec.route.boardName}，等車期間我哋會繼續睇住到站時間。`, { type: 'calm', sound: 'alight' });
    }
  }
  notify();
}

/* ---------- 上車 / 落車 ---------- */
export function markBoarded(routeId) {
  const route = getRoute(routeId);
  if (!route) return;
  state.boarded[routeId] = { at: Date.now(), alightStopId: route.alightStopId };
  // 保存
  import('./core.js').then((m) => m.saveState());
  const rec = monitors.get(routeId);
  if (rec) {
    rec.boarded = state.boarded[routeId];
    rec.alightAlertKey = '';
    poll(rec, { force: true });
  }
  toast('上車喇 🚌', { body: `我哋會睇住你幾時到 ${route.alightName || '落車站'}，夠鐘提你落車。`, type: 'calm' });
  notify();
}
export function markAlighted(routeId) {
  delete state.boarded[routeId];
  import('./core.js').then((m) => m.saveState());
  const rec = monitors.get(routeId);
  if (rec) rec.boarded = null;
  stopMonitor(routeId, { silent: true });
  toast('到站，落車 🎉', { body: '行程完成，慢慢行啦。', type: 'calm' });
  notify();
}

/* ---------- 計算快照 ---------- */
/**
 * @returns {{status:object, route:object, ...}}
 */
export function snapshot(routeId, now = Date.now()) {
  const route = getRoute(routeId);
  if (!route) return null;
  const rec = monitors.get(routeId);
  const settings = state.settings;
  const buffer = +settings.bufferSec || 0;

  // 導航中優先採用實時剩餘步行時間（會隨住你行而變）
  const navRec = navs.get(routeId);
  const walkSec = navRec && navRec.remainSec != null ? navRec.remainSec
    : (rec && rec.walkTo ? rec.walkTo.duration : null);
  const walkDist = navRec && navRec.remainDist != null ? navRec.remainDist
    : (rec && rec.walkTo ? rec.walkTo.distance : null);
  const boardEtas = rec ? rec.boardEtas : [];
  const alightEtas = rec ? rec.alightEtas : [];
  const boarded = rec ? rec.boarded : state.boarded[routeId];

  const decorate = (e) => ({ ...e, secs: Math.round((e.at - now) / 1000), mins: Math.max(0, Math.round((e.at - now) / 60000)) });

  /* --- 上車後：改為追蹤落車站 --- */
  if (boarded) {
    const nextAlight = alightEtas.map(decorate).find((e) => e.secs > -60);
    const alightName = route.alightName || '落車站';
    let status;
    if (!nextAlight) status = { key: 'onboard', tone: 'go', label: '行程中', headline: `去緊 ${alightName}`, note: '暫時沒有落車站到站資訊。' };
    else if (nextAlight.secs <= 45) status = { key: 'alight', tone: 'now', label: '準備落車', headline: `下一站就係 ${alightName}`, note: `預計 ${Math.max(0, nextAlight.secs)} 秒後到站，記得按鐘。` };
    else if (nextAlight.secs <= 150) status = { key: 'alight-soon', tone: 'soon', label: '快將到站', headline: `${Math.round(nextAlight.secs / 60)} 分鐘後到 ${alightName}`, note: '可以開始收拾隨身物品。' };
    else status = { key: 'onboard', tone: 'go', label: '行程中', headline: `仲有 ${Math.round(nextAlight.secs / 60)} 分鐘到 ${alightName}`, note: '我哋會喺到站前提你落車。' };
    return { route, outEtas: [], boardEtas: alightEtas, boarded: true, walkSec, walkDist, nextAlight, status, rec, now, buffer };
  }

  const list = boardEtas.map(decorate);
  if (!list.length) {
    return {
      route, boardEtas: list, outEtas: [], walkSec, walkDist, boarded: false, buffer, now, rec,
      status: {
        key: 'nodata', tone: 'idle', label: '暫無班次', headline: '暫時未收到實時到站',
        note: walkSec ? `你由出發點行去車站約 ${Math.round(walkSec / 60)} 分鐘。` : '請稍後再試，或確認路線方向。',
      },
    };
  }

  // 找最早一班仍然趕得到的車
  const w = walkSec == null ? 0 : walkSec;
  let target = null, targetIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].secs - w - buffer > -25) { target = list[i]; targetIdx = i; break; }
  }
  const outEtas = targetIdx > 0 ? list.slice(0, targetIdx) : [];

  if (!target) {
    return {
      route, boardEtas: list, outEtas, walkSec, walkDist, boarded: false, buffer, now, rec,
      status: {
        key: 'missed', tone: 'late', label: '趕唔到', headline: '呢班車趕唔到喇 😮‍💨',
        note: `下一班喺 ${list[0].mins} 分鐘後。可以唞唞先，我哋會再提你。`,
      },
    };
  }

  const margin = Math.round(target.secs - w - buffer);     // 距離「必須出門」仲有幾多秒
  const leaveIn = Math.max(0, margin);
  const waitIfNow = target.secs - w;                        // 立即出發剩下的等候時間
  const progress = w > 0 ? clamp((w - Math.max(0, target.secs - buffer)) / w, 0, 1) : 0;

  let status;
  if (margin > 300) {
    status = {
      key: 'calm', tone: 'idle', label: '可以慢慢行',
      headline: `仲有 ${Math.ceil(margin / 60)} 分鐘先需要出門`,
      note: `${target.mins} 分鐘後有車 · 你行過去約 ${Math.ceil(w / 60)} 分鐘，之後仲有 ${Math.round(buffer / 60)} 分鐘走盞。`,
    };
  } else if (margin > 150) {
    status = {
      key: 'soon', tone: 'soon', label: '準備出門',
      headline: `${Math.ceil(margin / 60)} 分鐘後出發就剛剛好`,
      note: `巴士 ${target.mins} 分鐘後到 ${route.boardName || '上車站'}，行過去約 ${Math.ceil(w / 60)} 分鐘。`,
    };
  } else if (margin > -15) {
    status = {
      key: 'go', tone: 'go', label: '而家出發',
      headline: '而家出發，剛剛好 🚶',
      note: `巴士 ${target.mins} 分鐘後到站，你行過去約 ${Math.ceil(w / 60)} 分鐘${waitIfNow > 60 ? `，仲有約 ${Math.round(waitIfNow / 60)} 分鐘等車` : '，到站就可以上車'}。`,
    };
  } else if (target.secs > 60) {
    status = {
      key: 'now', tone: 'now', label: '最後召集',
      headline: '最後召集！即刻出發 🏃',
      note: `巴士 ${target.secs} 秒後到站，行快少少仲趕得切。`,
    };
  } else {
    status = {
      key: 'missed', tone: 'late', label: '趕唔到', headline: '呢班應該走咗喇',
      note: '睇睇下一班，通常幾分鐘後就有。',
    };
  }
  return { route, boardEtas: list, outEtas, walkSec, walkDist, boarded: false, buffer, now, rec, target, targetIdx, margin, leaveIn, progress, status };
}

/* ---------- 提醒（狀態轉換時觸發） ---------- */
const ALERT_ON = {
  go: { title: (s) => '而家出發，剛剛好！', body: (s) => `${s.route.route} 號 ${s.target.mins} 分鐘後到 ${s.route.boardName || '上車站'}，行過去約 ${Math.ceil((s.walkSec || 0) / 60)} 分鐘。`, type: 'go' },
  now: { title: () => '最後召集！即刻出發 🏃', body: (s) => `${s.route.route} 號仲有 ${s.target.secs} 秒到站。`, type: 'alert' },
  missed: { title: () => '哎呀，走咗一班 😮‍💨', body: (s) => `下一班 ${s.boardEtas[0] ? s.boardEtas[0].mins + ' 分鐘後' : '稍後'}到站，我哋繼續睇住。`, type: 'alert' },
  alight: { title: () => '準備落車 🚏', body: (s) => `下一站就係 ${s.route.alightName || '落車站'}，記得按鐘。`, type: 'go' },
  'alight-soon': { title: () => '就快到站', body: (s) => `仲有約 ${Math.ceil(s.nextAlight.secs / 60)} 分鐘到 ${s.route.alightName || '落車站'}。`, type: 'go' },
};

export function evaluateAlerts() {
  const now = Date.now();
  for (const [routeId, rec] of monitors) {
    const snap = snapshot(routeId, now);
    if (!snap || !snap.status) continue;
    const s = snap.status;
    const key = s.key === 'onboard' ? '' : `${s.key}:${snap.target ? snap.target.at : '-'}`;
    if (!key) { continue; }
    if (rec.alertKey === key) continue;
    const rule = ALERT_ON[s.key];
    // 只在「需要行動」的狀態提醒；calm/soon 只在變成 go/now/missed 時響
    const previous = rec.alertKey ? rec.alertKey.split(':')[0] : '';
    rec.alertKey = key;
    if (!rule) continue;
    if (s.key === 'missed' && previous !== 'now' && previous !== 'go' && previous !== '') continue;
    alertUser(rule.title(snap), rule.body(snap), { type: rule.type, sound: rule.type === 'alert' ? 'urgent' : 'go' });
  }
}

/* 每秒重新計算（用於倒數與提醒判斷） */
let tickTimer = null;
export function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    if (!anyMonitoring()) return;
    evaluateAlerts();
    notify();
  }, 1000);
}

/* 當路線被刪除 / 方向改變時同步 */
export function syncMonitors() {
  for (const [id, rec] of [...monitors]) {
    const r = getRoute(id);
    if (!r && navs.has(id)) stopNavigation(id, { silent: true });
    if (!r) { stopMonitor(id, { silent: true }); continue; }
    rec.route = r;
    if (state.boarded[id]) rec.boarded = state.boarded[id]; else rec.boarded = null;
  }
}
on('state', syncMonitors);

/* 頁面載入時，如上次仍在行程中，自動恢復監控 */
export function restoreMonitors() {
  const active = activeRoute();
  if (active && state.boarded[active.id]) {
    startMonitor(active.id, { silent: true });
    return;
  }
  // 若設定過自動監控，則自動開始
  if (active && state.settings.autoMonitor) startMonitor(active.id, { silent: true });
}
