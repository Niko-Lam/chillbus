/* ============================================================
   views.js — 四個主頁面
   ============================================================ */
import {
  state, el, clear, $, $$, svgIcon, commit, uid, toast, fmtClock, fmtDuration, fmtDistance,
  getPlace, getRoute, activeRoute, companyName, haversine, clamp, deepClone, on,
} from './core.js';
import { openRouteEditor, openPlaceEditor } from './editors.js';
import { confirmDialog, openModal } from './modal.js';
import { resolveRoute, fetchRouteStops, walkTime, rideEstimate, locate } from './services.js';
import { showWalk, showPlan, openDock, closeDock, setLegend, setMarkers, fit, setMe, clearMe, drawNavProgress } from './map.js';
import * as monitor from './monitor.js';
import { plan, clearPlanCache } from './planner.js';

let currentView = 'go';

/* ------------------------------------------------------------
   共用小元件
   ------------------------------------------------------------ */
const emptyState = ({ title, text, actions = [] }) => el('div', { class: 'card' }, [
  el('div', { class: 'empty' }, [
    el('div', { class: 'ico', html: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="4" y="3.5" width="16" height="14" rx="4" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="20.5" r="1.6" fill="currentColor"/><circle cx="15" cy="20.5" r="1.6" fill="currentColor"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>` }),
    el('h4', { text: title }),
    el('p', { text }),
    actions.length ? el('div', { class: 'hstack', style: { justifyContent: 'center', marginTop: '6px' } }, actions) : null,
  ]),
]);

const placeName = (id, fallback = '未設定') => (getPlace(id) && getPlace(id).name) || fallback;

/* ============================================================
   1) 出發
   ============================================================ */
let goRefs = null;
let lastEtaSig = '';

export function renderGo() {
  const view = $('#view-go');
  clear(view);
  goRefs = null;
  const route = activeRoute();
  if (!route) {
    view.appendChild(emptyState({
      title: '仲未有路線',
      text: '新增你每日會搭嘅巴士路線，ChillBus 就會幫你計好幾點出門、幾時要行、幾時要跑。',
      actions: [
        el('button', { class: 'btn primary', onclick: () => openRouteEditor(null, { onSaved: (r) => { state.activeRouteId = r.id; commit(); renderAll(); } }) }, [svgIcon('plus', 17), '新增路線']),
        el('button', { class: 'btn line', onclick: loadDemo }, [svgIcon('bus', 17), '載入示範路線']),
      ],
    }));
    return;
  }
  lastEtaSig = '';

  /* ---- hero ---- */
  const heroNum = el('b', { class: 'big tnum', text: '--' });
  const heroUnit = el('span', { class: 'unit', text: '分鐘' });
  const heroEtaLabel = el('div', { class: 'hero-eta-label', text: '巴士到站' });
  const heroClock = el('div', { class: 'hero-bus' });
  const heroBadge = el('span', { class: 'num tnum', text: route.route });
  const heroDir = el('div', { class: 'dir', text: `往 ${route.dest || ''}` });
  const heroLive = el('div', { class: 'hero-live', text: '實時' });
  const heroHeadline = el('div', { class: 'hero-headline' });
  const heroNote = el('div', { class: 'hero-note' });
  const heroBar = el('span', { style: { width: '0%' } });
  const heroLegendLeft = el('span', { text: '' });
  const heroLegendRight = el('span', { text: '' });
  const heroProgress = el('div', { class: 'hero-progress' }, [
    el('div', { class: 'bar' }, [heroBar]),
    el('div', { class: 'legend' }, [heroLegendLeft, heroLegendRight]),
  ]);
  const heroActions = el('div', { class: 'hero-actions' });
  const hero = el('div', { class: 'hero', dataset: { state: 'idle' } }, [
    el('div', { class: 'hero-top' }, [
      el('div', { class: 'hero-route' }, [heroBadge, heroDir]),
      heroLive,
    ]),
    el('div', { class: 'hero-main' }, [
      el('div', {}, [heroEtaLabel, el('div', { class: 'hero-count' }, [heroNum, heroUnit])]),
      heroClock,
    ]),
    heroHeadline, heroNote, heroProgress, heroActions,
  ]);

  /* ---- 步行卡 ---- */
  const walkBox = el('div', { class: 'card' });
  const busBox = el('div', { class: 'card' });
  const infoBox = el('div', { class: 'card' });
  const onboardBox = el('div');

  view.append(onboardBox, hero, busBox, walkBox, infoBox);

  goRefs = {
    route, hero, heroNum, heroUnit, heroEtaLabel, heroClock, heroBadge, heroDir, heroLive,
    heroHeadline, heroNote, heroBar, heroLegendLeft, heroLegendRight, heroProgress, heroActions,
    walkBox, busBox, infoBox, onboardBox,
  };
  buildActions();
  buildWalk();
  buildInfo();
  paintGo(true);
}

function buildActions() {
  const { route, heroActions } = goRefs;
  const monitoring = monitor.isMonitoring(route.id);
  clear(heroActions);
  if (monitoring) {
    heroActions.append(
      el('button', { class: 'btn solid', onclick: () => monitor.refresh(route.id) }, [svgIcon('refresh', 17), '更新']),
      el('button', { class: 'btn', onclick: () => monitor.useMyLocation(route.id).then(() => toast('已用你目前位置', { body: '重新計好行去車站嘅時間。', type: 'calm' })).catch((e) => toast('定位失敗', { body: e.message, type: 'alert' })) }, [svgIcon('target', 17), '我嘅位置']),
      route.alightStopId && !state.boarded[route.id] ? el('button', { class: 'btn', onclick: () => { monitor.markBoarded(route.id); paintGo(true); } }, [svgIcon('bus', 17), '我上車了']) : null,
      el('button', { class: 'btn', onclick: () => monitor.stopMonitor(route.id) }, [svgIcon('bellOff', 17), '停止監控']),
    );
  } else {
    heroActions.append(
      el('button', { class: 'btn solid', onclick: () => startActive() }, [svgIcon('play', 17), '開始監控']),
      el('button', { class: 'btn', onclick: () => startNav() }, [svgIcon('target', 17), '開始導航']),
    );
  }
}

function startActive() {
  const route = activeRoute();
  if (!route) return;
  monitor.startMonitor(route.id);
  buildActions();
  paintGo(true);
}

function buildWalk() {
  const { route, walkBox } = goRefs;
  const from = getPlace(route.fromPlaceId);
  const chip = el('span', { class: 'chip', id: 'walkChip', text: '計算中…' });
  const bodyEl = el('div', { class: 'card-body', id: 'walkBody' }, [
    el('div', { class: 'loading-inline' }, [el('span', { class: 'spinner' }), '計緊步行時間…']),
  ]);
  const footEl = el('div', { class: 'card-foot', id: 'walkFoot' });
  clear(walkBox);
  walkBox.append(
    el('div', { class: 'card-head' }, [
      el('div', {}, [el('h3', { text: '行去巴士站' }), el('div', { class: 'sub', text: `${from ? from.name : '出發點'} → ${route.boardName || '上車站'}` })]),
      chip,
    ]),
    bodyEl,
    footEl,
  );
  goRefs.walkChip = chip;
  goRefs.walkBody = bodyEl;
  goRefs.walkFoot = footEl;
  renderWalkFoot();
  const origin = from || { lat: route.boardLat, lng: route.boardLng, name: '上車站' };
  if (from) walkTime(from, { lat: route.boardLat, lng: route.boardLng }).then((w) => {
    if (!monitor.isNavigating(route.id)) fillWalk(w, from, route);
  }).catch(() => {});
}

/** 步行卡底部按鈕（跟住導航狀態切換） */
function renderWalkFoot() {
  const { route, walkFoot } = goRefs;
  if (!walkFoot) return;
  const navOn = monitor.isNavigating(route.id);
  clear(walkFoot);
  walkFoot.append(
    el('button', { class: 'btn line sm', onclick: () => showRouteMap() }, [svgIcon('pin', 16), '地圖路線']),
    navOn
      ? el('button', { class: 'btn sm solid-dark', onclick: () => stopNav() }, [svgIcon('pause', 16), '停止導航'])
      : el('button', { class: 'btn primary sm', onclick: () => startNav() }, [svgIcon('target', 16), '開始實時導航']),
    !navOn ? el('button', {
      class: 'btn line sm',
      onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const p = await locate();
          const w = await walkTime(p, { lat: route.boardLat, lng: route.boardLng });
          fillWalk(w, { lat: p.lat, lng: p.lng, name: '目前位置' }, route, '目前位置 → 上車站');
        } catch (err) { toast('定位失敗', { body: err.message, type: 'alert' }); }
        finally { b.disabled = false; }
      },
    }, [svgIcon('target', 16), '我而喺邊']) : null,
    route.fromPlaceId ? el('button', { class: 'btn quiet sm', text: '改出發點', onclick: () => openRouteEditor(route.id, { onSaved: () => renderAll() }) }) : null,
  );
}

/* ---- 實時導航 ---- */
function startNav() {
  const route = goRefs && goRefs.route;
  if (!route) return;
  const rec = monitor.startNavigation(route.id);
  if (!rec) return;
  openDock();
  paintGo(true);
}

function stopNav() {
  const route = goRefs && goRefs.route;
  if (!route) return;
  monitor.stopNavigation(route.id);
  clearMe();
  goRefs.navSig = '';
  paintGo(true);   // paintGo 會偵測到導航結束，自動重建步行卡
}

/** 導航面板：剩餘時間／距離／進度 */
function paintNavPanel(route, nav) {
  const { walkBody, walkChip } = goRefs;
  if (!walkBody) return;
  if (walkChip) {
    walkChip.textContent = nav.arrived ? '已到達 ✓' : nav.waiting ? '定位中…' : nav.offRoute ? '重新規劃中…' : '導航中';
    walkChip.className = `chip${nav.arrived ? '' : ' brand'}`;
  }
  clear(walkBody);
  const pct = Math.round((nav.ratio || 0) * 100);
  walkBody.append(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('b', { text: nav.remainSec == null ? '—' : nav.remainSec < 60 ? `${nav.remainSec} 秒` : `${Math.ceil(nav.remainSec / 60)} 分` }),
        el('span', { text: nav.arrived ? '已到站' : '剩餘時間' }),
      ]),
      el('div', { class: 'stat' }, [el('b', { text: nav.remainDist == null ? '—' : fmtDistance(nav.remainDist) }), el('span', { text: '剩餘距離' })]),
      el('div', { class: 'stat' }, [el('b', { text: `${pct}%` }), el('span', { text: '已行進度' })]),
    ]),
    el('div', { class: 'walk-progress' }, [el('span', { style: { width: `${pct}%` } })]),
    el('div', { class: 'li-sub', style: { marginTop: '9px' } }, [
      nav.waiting && !nav.position ? '等緊 GPS 定位…（室內訊號可能較弱）'
        : nav.arrived ? `你已經到咗 ${route.boardName}，可以等車喇。`
        : nav.offRoute ? '你似乎離開咗建議路線，重新幫你規劃中…'
        : nav.position ? `位置更新：${fmtClock(new Date(nav.position.at))}${nav.accuracy ? ` · 誤差約 ${Math.round(nav.accuracy)} 米` : ''}`
        : '定位中…',
    ]),
  );
  if (nav.error && !nav.position) walkBody.append(el('div', { class: 'note err', style: { marginTop: '10px' }, text: nav.error.message }));
  if (nav.arrived) walkBody.append(el('div', { class: 'note', style: { marginTop: '10px' }, text: '🚏 到站後可以撳「我上車了」，App 會改為追蹤落車站。' }));
}

/** 地圖：導航路線 + 藍點 + 進度 */
function paintNavMap(route, nav) {
  const sig = `${nav.walk ? nav.walk.distance + '@' + nav.walk.coords.length : 'none'}|${nav.position ? 'pos' : 'nopos'}`;
  if (goRefs.navSig !== sig) {
    // 路線有變（首次／重新規劃）→ 重畫成張圖
    goRefs.navSig = sig;
    const from = nav.position
      ? { lat: nav.position.lat, lng: nav.position.lng, name: '我現在位置' }
      : (getPlace(route.fromPlaceId) || { lat: route.boardLat, lng: route.boardLng, name: '出發點' });
    const to = { lat: route.boardLat, lng: route.boardLng, name: route.boardName, kind: 'board', text: '上' };
    if (nav.walk) showWalk({ from, to, walk: nav.walk });
    else { setMarkers([{ ...from, kind: 'place', text: '起', label: from.name }, { ...to, kind: 'board', text: '上', label: to.name }]); fit([from, to]); }
  }
  // 進度線 + 藍點（每次定位更新都重畫，成本好低）
  if (nav.walk) drawNavProgress(nav.walk.coords, nav.index);
  if (nav.position) setMe(nav.position, { accuracy: nav.accuracy, follow: !nav.arrived });
  setLegend([
    nav.ratio < 0.995 ? { color: '#2563eb', text: '未行' } : null,
    nav.ratio > 0.005 ? { color: '#94a3b8', text: '行過' } : null,
    nav.offRoute ? { color: '#e08600', text: '離開路線，重新規劃中' } : null,
  ].filter(Boolean));

  // 地圖內導航狀態列
  const bar = document.getElementById('mapNavBar');
  if (bar) {
    bar.hidden = false;
    const t = document.getElementById('mnTime');
    const d = document.getElementById('mnDist');
    if (t) t.textContent = nav.arrived ? '已到達 ✓' : nav.remainSec == null ? '定位中…' : `${fmtDuration(nav.remainSec)} 到站`;
    if (d) d.textContent = nav.arrived ? `${route.boardName} 已到`
      : nav.remainDist == null ? '等緊 GPS 訊號'
      : `仲有 ${fmtDistance(nav.remainDist)}${nav.offRoute ? ' · 重新規劃中' : ''}`;
  }
}

/** 收起導航列 */
export function hideNavBar() {
  const bar = document.getElementById('mapNavBar');
  if (bar) bar.hidden = true;
}

function fillWalk(walk, origin, route, label) {
  const chip = document.getElementById('walkChip');
  const body = document.getElementById('walkBody');
  if (!body) return;
  if (chip) chip.textContent = `${Math.round(walk.duration / 60)} 分鐘`;
  clear(body);
  body.append(
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [el('b', { text: `${Math.round(walk.duration / 60)} 分` }), el('span', { text: '步行時間' })]),
      el('div', { class: 'stat' }, [el('b', { text: fmtDistance(walk.distance) }), el('span', { text: '距離' })]),
      el('div', { class: 'stat' }, [el('b', { text: `${state.settings.bufferSec ? Math.round(state.settings.bufferSec / 60 * 10) / 10 : 0} 分` }), el('span', { text: '出發緩衝' })]),
    ]),
    el('div', { class: 'li-sub', style: { marginTop: '10px' } }, [
      `${label || `${origin.name} → ${route.boardName}`}`,
      walk.source === 'estimate' ? el('em', { text: '（直線估算）' }) : el('span', { text: '（實際步行路徑）' }),
    ]),
  );
  goRefs.walkTo = { ...walk, origin };
}

function buildInfo() {
  const { route, infoBox } = goRefs;
  clear(infoBox);
  const ride = rideEstimate(route.stops || [], route.boardSeq, route.alightSeq);
  infoBox.append(
    el('div', { class: 'card-head' }, [
      el('div', {}, [el('h3', { text: '路線資料' }), el('div', { class: 'sub', text: `${companyName(route.co)} ${route.route} · 往 ${route.dest || ''}` })]),
      el('span', { class: 'chip', text: `${(route.stops || []).length} 個站` }),
    ]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'legs', style: { padding: '0' } }, [
        legRow('place', '上車', route.boardName, `第 ${route.boardSeq} 站`, placeName(route.fromPlaceId)),
        legRow('bus', '車程', `${route.boardName} → ${route.alightName}`, ride.duration ? `約 ${Math.round(ride.duration / 60)} 分鐘 · ${fmtDistance(ride.distance)}` : '—', `${route.alightSeq - route.boardSeq} 個站`),
        legRow('place', '落車', route.alightName, `第 ${route.alightSeq} 站`, placeName(route.toPlaceId)),
      ]),
    ]),
    el('div', { class: 'card-foot' }, [
      el('button', { class: 'btn line sm', onclick: () => reverseRoute(route) }, [svgIcon('swap', 16), '反轉']),
      el('button', { class: 'btn line sm', onclick: () => duplicateRoute(route) }, [svgIcon('copy', 16), '複製']),
      el('button', { class: 'btn line sm', onclick: () => openRouteEditor(route.id, { onSaved: () => renderAll() }) }, [svgIcon('edit', 16), '編輯']),
      el('button', {
        class: 'btn quiet sm', onclick: async () => {
          const ok = await confirmDialog({ title: '刪除路線？', body: `「${route.name}」會從清單移除。`, okText: '刪除', danger: true });
          if (!ok) return;
          monitor.stopMonitor(route.id, { silent: true });
          state.routes = state.routes.filter((r) => r.id !== route.id);
          if (state.activeRouteId === route.id) state.activeRouteId = state.routes[0] ? state.routes[0].id : null;
          commit(); renderAll();
        },
      }, [svgIcon('trash', 16), '刪除']),
    ]),
  );
}

function legRow(kind, tag, title, sub, extra) {
  const icon = kind === 'bus' ? 'bus' : 'pin';
  return el('div', { class: `leg ${kind === 'bus' ? 'bus' : 'walk'}` }, [
    el('div', { class: 'ico', html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none">${icon === 'bus' ? '<rect x="4.4" y="3.6" width="15.2" height="13.4" rx="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.6 9.6h14.8M9 17v2.6M15 17v2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' : '<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/>'}</svg>` }),
    el('div', { class: 'leg-body' }, [
      el('div', { class: 'leg-top' }, [el('b', { text: title || '—' }), el('span', { class: 'chip plain', text: extra || '' })]),
      el('div', { class: 'leg-sub', text: `${tag}${sub ? ' · ' + sub : ''}` }),
    ]),
  ]);
}

/* ---- 每秒更新 ---- */
export function paintGo(force = false) {
  if (!goRefs || currentView !== 'go') return;
  const route = getRoute(goRefs.route.id);
  if (!route) return;
  goRefs.route = route;

  /* 上車後提示 */
  const boarded = state.boarded[route.id] || (monitor.getMonitor(route.id) || {}).boarded;
  clear(goRefs.onboardBox);
  if (boarded) {
    goRefs.onboardBox.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-body', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
        el('div', { class: 'ico', style: { width: '38px', height: '38px', borderRadius: '12px', background: 'var(--go-soft)', color: 'var(--go)', display: 'grid', placeItems: 'center' } , html: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none"><rect x="4.4" y="3.6" width="15.2" height="13.4" rx="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.6 9.6h14.8M9 17v2.6M15 17v2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>` }),
        el('div', { style: { flex: '1' } }, [
          el('b', { text: '行程進行中', style: { display: 'block', fontSize: '14.5px' } }),
          el('span', { class: 'li-sub', text: `落車站：${route.alightName}，夠鐘會提你。` }),
        ]),
        el('button', { class: 'btn sm solid-dark', text: '落車', onclick: () => { monitor.markAlighted(route.id); paintGo(true); } }),
      ]),
    ]));
  }

  const monitoringNow = monitor.isMonitoring(route.id);
  if (goRefs.actionsMonitoring !== monitoringNow) {
    goRefs.actionsMonitoring = monitoringNow;
    buildActions();
  }

  // 實時導航：更新面板 + 地圖藍點
  const navNow = monitor.isNavigating(route.id);
  if (goRefs.navOn !== navNow) {
    goRefs.navOn = navNow;
    renderWalkFoot();
    if (!navNow) { clearMe(); hideNavBar(); goRefs.navSig = ''; buildWalk(); }
  }
  const nav = navNow ? monitor.getNav(route.id) : null;
  if (nav) { paintNavPanel(route, nav); paintNavMap(route, nav); }

  const snap = monitoringNow ? monitor.snapshot(route.id) : null;

  /* hero */
  const { hero, heroNum, heroUnit, heroEtaLabel, heroClock, heroHeadline, heroNote, heroBar, heroLegendLeft, heroLegendRight, heroProgress, heroLive } = goRefs;
  if (!snap) {
    const from = getPlace(route.fromPlaceId);
    hero.dataset.state = 'idle';
    heroNum.textContent = '--';
    heroUnit.textContent = '分鐘';
    heroEtaLabel.textContent = '巴士到站';
    heroClock.innerHTML = `<b>${route.boardName || '上車站'}</b><br>${companyName(route.co)} ${route.route}`;
    heroLive.textContent = '未監控';
    heroLive.dataset.off = '1';
    heroHeadline.textContent = '開始監控，幫你計好幾點出門';
    heroNote.textContent = `${from ? from.name : '出發點'} → ${route.boardName || '上車站'}，我哋會實時睇住到站時間，夠鐘彈窗提你。`;
    heroProgress.style.display = 'none';
    return;
  }

  heroProgress.style.display = '';
  const s = snap;
  hero.dataset.state = s.status.tone;
  heroLive.dataset.off = monitor.getMonitor(route.id) && monitor.getMonitor(route.id).lastError ? '1' : '';
  heroLive.textContent = monitor.getMonitor(route.id) && monitor.getMonitor(route.id).lastError ? '連線唔穩' : '實時';

  const secs = s.boarded ? (s.nextAlight ? s.nextAlight.secs : null) : (s.target ? s.target.secs : null);
  if (secs == null) {
    heroNum.textContent = '--';
    heroUnit.textContent = '分鐘';
  } else if (secs < 120) {
    heroNum.textContent = `${Math.max(0, Math.floor(secs / 60))}:${String(Math.max(0, secs % 60)).padStart(2, '0')}`;
    heroUnit.textContent = '後到站';
  } else {
    heroNum.textContent = String(Math.max(0, Math.ceil(secs / 60)));
    heroUnit.textContent = '分鐘後到站';
  }
  heroEtaLabel.textContent = s.boarded ? '落車站' : '巴士到站';

  const target = s.boarded ? s.nextAlight : s.target;
  if (target) {
    const leaveAt = target.at - (s.walkSec || 0) * 1000 - state.settings.bufferSec * 1000;
    heroClock.innerHTML = `<b>${fmtClock(target.date)}</b> 到站<br>建議 <b>${fmtClock(new Date(s.boarded ? leaveAt : leaveAt))}</b> 出發`;
  } else {
    heroClock.innerHTML = '';
  }

  heroHeadline.textContent = s.status.headline;
  heroNote.textContent = s.status.note;

  /* 進度 */
  if (target && s.walkSec) {
    const arriveBy = target.at - state.settings.bufferSec * 1000;
    const leaveAt = arriveBy - s.walkSec * 1000;
    const span = Math.max(1, arriveBy - leaveAt);
    const p = clamp((Date.now() - leaveAt) / span, 0, 1);
    heroBar.style.width = `${Math.round(p * 100)}%`;
    heroLegendLeft.textContent = `出發 ${fmtClock(new Date(leaveAt))}`;
    heroLegendRight.textContent = `${p >= 1 ? '應該到咗' : `行路中 ${Math.round(p * 100)}%`} · 到站 ${fmtClock(new Date(arriveBy))}`;
  } else if (target) {
    heroBar.style.width = '0%';
    heroLegendLeft.textContent = '未知步行時間';
    heroLegendRight.textContent = `到站 ${fmtClock(target.date)}`;
  } else {
    heroBar.style.width = '0%';
    heroLegendLeft.textContent = '';
    heroLegendRight.textContent = '';
  }

  /* 下一班 */
  const sig = (s.boardEtas || []).map((e) => e.at).join(',');
  if (sig !== lastEtaSig) {
    lastEtaSig = sig;
    renderBusList(s);
  }
}

function renderBusList(s) {
  const { busBox, route } = goRefs;
  clear(busBox);
  const list = s.boardEtas || [];
  if (!list.length) return;
  busBox.append(
    el('div', { class: 'card-head' }, [
      el('div', {}, [el('h3', { text: s.boarded ? '落車站到站' : '即將到站' }), el('div', { class: 'sub', text: s.boarded ? route.alightName : route.boardName })]),
      el('span', { class: 'chip plain', text: `更新 ${fmtClock(new Date())}` }),
    ]),
    el('div', { class: 'card-body tight' }, [
      el('div', { class: 'buslist' }, list.slice(0, 5).map((e, i) => el('div', { class: `bus-bubble ${i === 0 ? 'is-next' : ''}` }, [
        el('span', { class: 'm', text: `${e.mins}` }),
        el('span', { class: 't', text: `${fmtClock(e.date)} 到站` }),
        e.rmk ? el('span', { class: 'rmk', text: e.rmk }) : null,
      ]))),
    ]),
  );
}

function showRouteMap() {
  const route = goRefs && goRefs.route;
  if (!route) return;
  const from = getPlace(route.fromPlaceId);
  const to = { lat: route.boardLat, lng: route.boardLng, name: route.boardName };
  if (goRefs.walkTo) {
    showWalk({ from: { ...from, name: from ? from.name : '出發點' }, to: { ...to, kind: 'board', text: '上' }, walk: goRefs.walkTo });
    return;
  }
  const origin = from || to;
  walkTime(origin, to).then((w) => { goRefs.walkTo = { ...w, origin }; showWalk({ from: { lat: origin.lat, lng: origin.lng, name: origin.name }, to: { ...to, kind: 'board', text: '上' }, walk: w }); });
}

/** 由外部（頂部地圖按鈕）呼叫：顯示目前路線嘅步行導航 */
export function showCurrentTripMap() {
  if (currentView === 'go') showRouteMap();
}

/* ---- 路線操作 ---- */
async function reverseRoute(route) {
  const label = `${companyName(route.co)} ${route.route}`;
  const t = toast('反轉緊路線…', { body: `${label} 重新載入反向站序。`, type: 'info', ms: 100000 });
  try {
    const newBound = route.bound === 'outbound' ? 'inbound' : 'outbound';
    const stops = await fetchRouteStops({ co: route.co, route: route.route, bound: newBound, serviceType: route.serviceType });
    const nearest = (target, filter) => stops.filter(filter || (() => true)).sort((a, b) => haversine(a, target) - haversine(b, target))[0];
    const newBoard = nearest({ lat: route.alightLat, lng: route.alightLng });
    const newAlight = newBoard ? nearest({ lat: route.boardLat, lng: route.boardLng }, (s) => s.seq > newBoard.seq) : null;
    if (!newBoard || !newAlight) throw new Error('載入反向站點失敗');
    route.bound = newBound; route.dir = newBound === 'outbound' ? 'O' : 'I';
    route.orig = stops[0] ? stops[0].name : newAlight.name;
    route.dest = stops.length ? stops[stops.length - 1].name : newBoard.name;
    route.stops = stops;
    route.boardStopId = newBoard.id; route.boardName = newBoard.name; route.boardLat = newBoard.lat; route.boardLng = newBoard.lng; route.boardSeq = newBoard.seq;
    route.alightStopId = newAlight.id; route.alightName = newAlight.name; route.alightLat = newAlight.lat; route.alightLng = newAlight.lng; route.alightSeq = newAlight.seq;
    const tFrom = route.fromPlaceId; route.fromPlaceId = route.toPlaceId; route.toPlaceId = tFrom;
    route.updatedAt = Date.now();
    commit(); clearPlanCache(); monitor.syncMonitors();
    if (monitor.isMonitoring(route.id)) monitor.refresh(route.id);
    renderAll();
    t(); toast('已反轉路線', { body: `${placeName(route.fromPlaceId)} → ${placeName(route.toPlaceId)} · 往 ${route.dest}`, type: 'calm' });
  } catch (err) {
    t(); toast('反轉失敗', { body: err.message || '請稍後再試。', type: 'alert' });
  }
}

function duplicateRoute(route) {
  const copy = deepClone(route);
  copy.id = uid('route');
  copy.name = `${route.name}（副本）`;
  copy.createdAt = Date.now(); copy.updatedAt = Date.now();
  const idx = state.routes.findIndex((r) => r.id === route.id);
  state.routes.splice(idx + 1, 0, copy);
  commit();
  toast('已複製路線', { body: copy.name, type: 'calm' });
  renderAll();
}

/* ---- 示範資料 ---- */
export async function loadDemo() {
  const t = toast('載入示範路線…', { body: '用九巴 968 由銅鑼灣返元朗做例子。', type: 'info', ms: 60000 });
  try {
    const variants = await resolveRoute('KMB', '968');
    const v = variants.find((x) => x.bound === 'inbound') || variants[0];
    const stops = await fetchRouteStops({ co: v.co, route: v.route, bound: v.bound, serviceType: v.serviceType });
    const office = { id: uid('place'), name: '公司（銅鑼灣）', kind: 'work', lat: 22.2800, lng: 114.1846, address: '銅鑼灣' };
    const home = { id: uid('place'), name: '屋企（元朗）', kind: 'home', lat: 22.4456, lng: 114.0246, address: '元朗' };
    const near = (t2) => stops.slice().sort((a, b) => haversine(a, t2) - haversine(b, t2))[0];
    const board = near(office);
    const alight = stops.filter((s) => s.seq > board.seq).sort((a, b) => haversine(a, home) - haversine(b, home))[0];
    const route = {
      id: uid('route'), name: '公司 → 屋企 · 968', co: v.co, route: v.route, bound: v.bound, dir: v.dir,
      serviceType: v.serviceType, orig: v.orig, dest: v.dest, stops,
      boardStopId: board.id, boardName: board.name, boardLat: board.lat, boardLng: board.lng, boardSeq: board.seq,
      alightStopId: alight.id, alightName: alight.name, alightLat: alight.lat, alightLng: alight.lng, alightSeq: alight.seq,
      fromPlaceId: office.id, toPlaceId: home.id, createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.places.push(office, home);
    state.routes.push(route);
    state.activeRouteId = route.id;
    commit(); clearPlanCache();
    t();
    toast('已載入示範路線', { body: '而家可以看到實時到站同出發建議。', type: 'calm' });
    setView('go');
    renderAll();
    monitor.startMonitor(route.id, { silent: true });
  } catch (err) {
    t();
    toast('載入失敗', { body: err.message || '請檢查網絡後再試。', type: 'alert' });
  }
}

/* ============================================================
   2) 路線
   ============================================================ */
export function renderRoutes() {
  const view = $('#view-routes');
  clear(view);
  view.append(
    el('div', { class: 'section-title' }, [
      el('h3', { text: `已儲存路線 · ${state.routes.length}` }),
      el('button', { class: 'btn primary sm', onclick: () => openRouteEditor(null, { onSaved: () => renderAll() }) }, [svgIcon('plus', 16), '新增路線']),
    ]),
  );
  if (!state.routes.length) {
    view.append(emptyState({
      title: '未有任何路線',
      text: '你可以新增每日搭開嘅巴士路線，或者先載入示範路線睇下點運作。',
      actions: [
        el('button', { class: 'btn primary', onclick: () => openRouteEditor(null, { onSaved: () => renderAll() }) }, [svgIcon('plus', 17), '新增路線']),
        el('button', { class: 'btn line', onclick: loadDemo }, '載入示範'),
      ],
    }));
    return;
  }
  const list = el('div', { class: 'card' });
  state.routes.forEach((r) => {
    const isActive = r.id === state.activeRouteId;
    const ride = rideEstimate(r.stops || [], r.boardSeq, r.alightSeq);
    list.append(el('div', { class: `route-card ${isActive ? 'is-active' : ''}` }, [
      el('span', { class: `badge-dir ${isActive ? 'brand' : ''}`, text: r.route }),
      el('div', { class: 'rc-body', onclick: () => { state.activeRouteId = r.id; commit(); setView('go'); renderAll(); } }, [
        el('div', { class: 'rc-path' }, [
          el('span', { text: placeName(r.fromPlaceId, '未設定') }),
          svgIcon('arrow', 14),
          el('span', { text: placeName(r.toPlaceId, '未設定') }),
        ]),
        el('div', { class: 'rc-meta' }, [
          el('span', { text: `${companyName(r.co)} · 往 ${r.dest || ''}` }),
          el('span', { class: 'dot-sep' }),
          el('span', { text: r.boardName || '' }),
          el('span', { class: 'dot-sep' }),
          el('span', { text: ride.duration ? `車程約 ${Math.round(ride.duration / 60)} 分` : '' }),
        ]),
      ]),
      el('div', { class: 'li-actions' }, [
        el('button', { class: 'icon-btn sm', title: '反轉方向', onclick: () => reverseRoute(r), html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${'<path d="M7.5 4.6 4.2 7.9l3.3 3.3M4.4 7.9h15.2M16.5 19.4l3.3-3.3-3.3-3.3M19.6 16.1H4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'}</svg>` }),
        el('button', { class: 'icon-btn sm', title: '複製路線', onclick: () => duplicateRoute(r), html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${'<rect x="8.6" y="8.6" width="11.4" height="11.4" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M15.4 5.6a3 3 0 0 0-2.8-1.6H7a3 3 0 0 0-3 3v5.6a3 3 0 0 0 1.6 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'}</svg>` }),
        el('button', { class: 'icon-btn sm', title: '編輯', onclick: () => openRouteEditor(r.id, { onSaved: () => renderAll() }), html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${'<path d="M15.2 4.6l4.2 4.2M4.5 19.5l1-4L16 5.1a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.4 18.5l-3.9 1Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'}</svg>` }),
      ]),
    ]));
  });
  view.append(list);
  view.append(el('div', { class: 'note', text: '撳路線卡就可以設為「出發」頁嘅監控對象。' }));
}

/* ============================================================
   3) 規劃
   ============================================================ */
let planState = { from: '', to: '', allowTransfer: true, running: false, result: null };

export function renderPlan() {
  const view = $('#view-plan');
  clear(view);
  if (!state.places.length && !state.routes.length) {
    view.append(emptyState({
      title: '未有任何路線',
      text: '先新增至少一條巴士路線，就可以幫你規劃 A 點去 B 點嘅最快方案。',
      actions: [el('button', { class: 'btn primary', onclick: () => loadDemo }, [svgIcon('bus', 17), '載入示範路線'])],
    }));
    return;
  }

  const placeOpts = (cur) => [
    el('option', { value: '', text: '請選擇位置' }),
    ...state.places.map((p) => el('option', { value: p.id, text: p.name, selected: cur === p.id })),
    el('option', { value: '__me', text: '📍 我目前位置', selected: cur === '__me' }),
  ];
  const fromSel = el('select', { class: 'select' }, placeOpts(planState.from));
  const toSel = el('select', { class: 'select' }, placeOpts(planState.to));
  fromSel.value = planState.from; toSel.value = planState.to;
  fromSel.addEventListener('change', () => { planState.from = fromSel.value; });
  toSel.addEventListener('change', () => { planState.to = toSel.value; });
  if (!planState.from) {
    const w = state.places.find((p) => p.kind === 'work');
    const h = state.places.find((p) => p.kind === 'home');
    if (w) { planState.from = w.id; fromSel.value = w.id; }
    if (h) { planState.to = h.id; toSel.value = h.id; }
  }

  const swapBtn = el('button', { class: 'icon-btn', title: '交換', onclick: () => { const t = planState.from; planState.from = planState.to; planState.to = t; renderPlan(); }, html: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none">${'<path d="M7.5 4.6 4.2 7.9l3.3 3.3M4.4 7.9h15.2M16.5 19.4l3.3-3.3-3.3-3.3M19.6 16.1H4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'}</svg>` });
  const transferInput = el('input', { type: 'checkbox', checked: planState.allowTransfer });
  transferInput.addEventListener('change', () => { planState.allowTransfer = transferInput.checked; });
  const results = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, planState.result ? [] : [el('div', { class: 'note', text: '揀好起點同終點，撳「搵最快路線」。系統會用你已儲存嘅路線組合，計算行路＋等車＋車程嘅總時間。' })]);

  const doPlan = async () => {
    if (!planState.from || !planState.to) return toast('請選擇起點同終點', { type: 'alert' });
    if (planState.from === planState.to) return toast('起點同終點唔可以一樣', { type: 'alert' });
    if (!state.routes.filter((r) => (r.stops || []).length > 1).length) return toast('未有可用路線', { body: '先新增路線，或者載入示範路線。', type: 'alert' });
    clear(results);
    results.appendChild(el('div', { class: 'loading-inline' }, [el('span', { class: 'spinner' }), '搵緊最快路線…']));
    planState.running = true;
    try {
      const from = await resolvePoint(planState.from);
      const to = await resolvePoint(planState.to);
      const res = await plan(from, to, { allowTransfer: planState.allowTransfer });
      planState.result = res;
      clear(results);
      if (!res.options.length) {
        results.appendChild(el('div', { class: 'note warn', text: '喺你已儲存嘅路線入面搵唔到可行組合。試下新增多幾條路線，或者放寬轉乘。' }));
        return;
      }
      res.options.slice(0, 4).forEach((opt, i) => results.appendChild(planCard(opt, i === 0)));
    } catch (err) {
      clear(results);
      results.appendChild(el('div', { class: 'note err', text: err.message || '規劃失敗，請再試一次。' }));
    } finally { planState.running = false; }
  };

  view.append(
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('div', {}, [el('h3', { text: 'A 點去 B 點' }), el('div', { class: 'sub', text: '用你已儲存嘅路線組合規劃' })])]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'field' }, [el('label', { text: '起點' }), el('div', { class: 'row' }, [fromSel])]),
        el('div', { class: 'hstack', style: { justifyContent: 'center', margin: '6px 0' } }, [swapBtn]),
        el('div', { class: 'field' }, [el('label', { text: '終點' }), el('div', { class: 'row' }, [toSel])]),
        el('label', { class: 'switch', style: { marginTop: '12px' } }, [transferInput, el('span', { class: 'track' }), el('span', { class: 'label', text: '容許轉乘一次' })]),
      ]),
      el('div', { class: 'card-foot' }, [
        el('button', { class: 'btn primary', onclick: doPlan }, [svgIcon('route', 17), '搵最快路線']),
        el('button', { class: 'btn quiet sm', text: '重新整理資料', onclick: () => { clearPlanCache(); toast('已清除規劃快取', { type: 'info' }); } }),
      ]),
    ]),
    results,
  );
}

async function resolvePoint(value) {
  if (value === '__me') {
    const p = await locate();
    return { lat: p.lat, lng: p.lng, name: '我目前位置' };
  }
  const p = getPlace(value);
  if (!p) throw new Error('搵唔到選擇嘅位置。');
  return { lat: p.lat, lng: p.lng, name: p.name };
}

function planCard(opt, isBest) {
  const legs = el('div', { class: 'legs' });
  opt.legs.forEach((leg) => {
    if (leg.type === 'walk') {
      legs.appendChild(el('div', { class: 'leg walk' }, [
        el('div', { class: 'ico', html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><circle cx="13" cy="4.6" r="1.9" stroke="currentColor" stroke-width="1.7"/><path d="M12.6 8.2 9.9 11l1.5 3.2-1.6 5.6M12.6 8.2 16 10l2.3 3.4M11.4 14.2l-3.6.4-1.4 5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
        el('div', { class: 'leg-body' }, [
          el('div', { class: 'leg-top' }, [el('b', { text: leg.label }), el('span', { class: 't', text: fmtDuration(leg.durationSec) })]),
          el('div', { class: 'leg-sub', text: `${fmtDistance(leg.distance)}${leg.source === 'estimate' ? ' · 估算' : ''}` }),
        ]),
      ]));
    } else {
      legs.appendChild(el('div', { class: 'leg bus' }, [
        el('div', { class: 'ico', html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><rect x="4.4" y="3.6" width="15.2" height="13.4" rx="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.6 9.6h14.8M9 17v2.6M15 17v2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>` }),
        el('div', { class: 'leg-body' }, [
          el('div', { class: 'leg-top' }, [
            el('b', { text: `${companyName(leg.route.co)} ${leg.route.route} · 往 ${leg.route.dest}` }),
            el('span', { class: 't', text: `${fmtDuration(leg.durationSec)}${leg.etaAt ? ` · ${Math.max(0, Math.round((leg.etaAt - Date.now()) / 60000))} 分後有車` : ''}` }),
          ]),
          el('div', { class: 'leg-sub', text: `${leg.fromStop.name} 上車 → ${leg.toStop.name} 落車 · ${leg.seqTo - leg.seqFrom} 個站` }),
        ]),
      ]));
    }
  });

  return el('div', { class: `plan-option ${isBest ? 'is-best' : ''}` }, [
    el('div', { class: 'plan-head' }, [
      el('span', { class: `badge-dir ${isBest ? 'brand' : ''}`, text: opt.routes.map((r) => r.route).join('+') }),
      el('div', {}, [
        el('div', { style: { fontWeight: '640', fontSize: '13.5px' } }, [isBest ? '最快方案' : opt.kind === 'transfer' ? '需要轉乘' : '直達方案']),
        el('div', { class: 'li-sub', text: `${opt.busCount} 程巴士 · ${fmtDistance(opt.walkSec * state.settings.walkSpeed)} 步行` }),
      ]),
      el('div', { class: 'total' }, [el('b', { text: `${Math.round(opt.totalSec / 60)}′` }), el('span', { text: '預計總時間' })]),
    ]),
    legs,
    el('div', { class: 'card-foot', style: { paddingTop: '0' } }, [
      el('button', { class: 'btn primary sm', onclick: () => usePlan(opt) }, [svgIcon('play', 16), '用呢個方案出發']),
      el('button', { class: 'btn line sm', onclick: () => showPlan(opt) }, [svgIcon('pin', 16), '睇地圖']),
      el('button', { class: 'btn quiet sm', text: '逐步睇', onclick: () => showPlanDetail(opt) }),
    ]),
  ]);
}

function showPlanDetail(opt) {
  const body = [el('div', { class: 'note', text: `預計總時間 ${fmtDuration(opt.totalSec)}：車程 ${fmtDuration(opt.rideSec)}、步行 ${fmtDuration(opt.walkSec)}、等車 ${fmtDuration(opt.waitSec)}。` })];
  opt.legs.forEach((leg, i) => {
    body.push(el('div', { class: 'card-body', style: { padding: '11px 13px', border: '1px solid var(--line)', borderRadius: '13px' } }, [
      el('div', { class: 'leg-top' }, [el('b', { text: `${i + 1}. ${leg.type === 'walk' ? leg.label : `${companyName(leg.route.co)} ${leg.route.route}`}` }), el('span', { class: 't', text: fmtDuration(leg.durationSec) })]),
      el('div', { class: 'leg-sub', text: leg.type === 'walk' ? `${fmtDistance(leg.distance)} · ${leg.source === 'estimate' ? '估算' : '實際路徑'}` : `${leg.fromStop.name} → ${leg.toStop.name}，${leg.seqTo - leg.seqFrom} 個站，${leg.etaAt ? fmtClock(new Date(leg.etaAt)) + ' 有車' : '班次待定'}` }),
    ]));
  });
  openModal({ title: '行程詳情', subtitle: opt.routes.map((r) => `${companyName(r.co)} ${r.route}`).join(' + '), body });
}

async function usePlan(opt) {
  const first = opt.legs.find((l) => l.type === 'bus');
  const last = [...opt.legs].reverse().find((l) => l.type === 'bus');
  if (!first || !last) return;
  const r0 = first.route;
  let route = state.routes.find((r) => r.co === r0.co && r.route === r0.route && r.bound === r0.bound && r.serviceType === r0.serviceType && r.boardStopId === first.fromStop.id && r.alightStopId === last.toStop.id);
  if (!route) {
    route = {
      id: uid('route'), name: `規劃：${opt.from.name} → ${opt.to.name}`, co: r0.co, route: r0.route, bound: r0.bound, dir: r0.dir,
      serviceType: r0.serviceType, orig: r0.orig, dest: r0.dest, stops: r0.stops,
      boardStopId: first.fromStop.id, boardName: first.fromStop.name, boardLat: first.fromStop.lat, boardLng: first.fromStop.lng, boardSeq: first.fromStop.seq,
      alightStopId: last.toStop.id, alightName: last.toStop.name, alightLat: last.toStop.lat, alightLng: last.toStop.lng, alightSeq: last.toStop.seq,
      fromPlaceId: state.places.find((p) => Math.abs(p.lat - opt.from.lat) < 1e-4 && Math.abs(p.lng - opt.from.lng) < 1e-4)?.id || null,
      toPlaceId: state.places.find((p) => Math.abs(p.lat - opt.to.lat) < 1e-4 && Math.abs(p.lng - opt.to.lng) < 1e-4)?.id || null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.routes.push(route);
    toast('已新增路線', { body: route.name, type: 'calm' });
  }
  state.activeRouteId = route.id;
  commit(); clearPlanCache();
  setView('go'); renderAll();
  monitor.startMonitor(route.id, { silent: true });
  showPlan(opt);
}

/* ============================================================
   4) 地點
   ============================================================ */
export function renderPlaces() {
  const view = $('#view-places');
  clear(view);
  view.append(el('div', { class: 'section-title' }, [
    el('h3', { text: `已儲存地點 · ${state.places.length}` }),
    el('button', { class: 'btn primary sm', onclick: () => openPlaceEditor(null, { onSaved: () => renderAll() }) }, [svgIcon('plus', 16), '新增地點']),
  ]));
  if (!state.places.length) {
    view.append(emptyState({
      title: '未儲存任何地點',
      text: '儲存「屋企」同「公司」之後，新增路線就可以一按帶入，唔使每次都搵地圖。',
      actions: [el('button', { class: 'btn primary', onclick: () => openPlaceEditor(null, { onSaved: () => renderAll() }) }, [svgIcon('plus', 17), '新增地點'])],
    }));
    return;
  }
  const groups = [['home', '屋企'], ['work', '公司'], ['other', '其他']];
  groups.forEach(([kind, label]) => {
    const items = state.places.filter((p) => (p.kind || 'other') === kind);
    if (!items.length) return;
    view.append(el('div', { class: 'section-title' }, [el('h3', { text: label })]));
    const card = el('div', { class: 'card' });
    items.forEach((p) => {
      const used = state.routes.filter((r) => r.fromPlaceId === p.id || r.toPlaceId === p.id).length;
      card.append(el('div', { class: 'list-item', onclick: () => openPlaceEditor(p.id, { onSaved: () => renderAll() }) }, [
        el('div', { class: 'ico', style: { width: '36px', height: '36px', borderRadius: '12px', background: 'var(--surface-3)', display: 'grid', placeItems: 'center', color: 'var(--brand)', flex: 'none' }, html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none">${kind === 'home' ? '<path d="M4.4 10.6 12 4.3l7.6 6.3v8.1a1.6 1.6 0 0 1-1.6 1.6H5.9a1.6 1.6 0 0 1-1.5-1.6v-8.1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' : kind === 'work' ? '<rect x="3.7" y="7.4" width="16.6" height="12.2" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M9 7.2V5.9a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 5.9v1.3" stroke="currentColor" stroke-width="1.7"/>' : '<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10.2" r="2.5" stroke="currentColor" stroke-width="1.7"/>'}</svg>` }),
        el('div', { class: 'li-main' }, [
          el('div', { class: 'li-title' }, [el('span', { class: 'nm', text: p.name })]),
          el('div', { class: 'li-sub' }, [el('span', { text: p.address ? p.address.slice(0, 46) : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` }), used ? el('span', { class: 'chip plain', text: `用於 ${used} 條路線` }) : null]),
        ]),
        el('button', { class: 'icon-btn sm', title: '喺地圖睇', onclick: (e) => { e.stopPropagation(); openDock(); setMarkers([{ lat: p.lat, lng: p.lng, kind: 'place', text: '起', label: p.name, sub: p.address }]); fit([p], { single: 16 }); setLegend([{ color: 'var(--brand)', text: p.name }]); }, html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">${'<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10.2" r="2.5" stroke="currentColor" stroke-width="1.7"/>'}</svg>` }),
        svgIcon('arrow', 18),
      ]));
    });
    view.append(card);
  });
  view.append(el('div', { class: 'note', text: '位置係用 OpenStreetMap 搜尋／定位取得，你可以隨時編輯或改用喺地圖上揀位。' }));
}

/* ============================================================
   檢視切換
   ============================================================ */
const META = {
  go: ['出發', '實時到站監控 · 出門提醒'],
  routes: ['路線', '管理你搭開嘅巴士路線'],
  plan: ['規劃', 'A 點去 B 點，最快方案'],
  places: ['地點', '儲存常用出發點'],
};

export function setView(name) {
  currentView = name;
  ['go', 'routes', 'plan', 'places'].forEach((v) => {
    const node = document.getElementById('view-' + v);
    if (node) node.hidden = v !== name;
  });
  $$('.nav-btn').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const [t, s] = META[name] || META.go;
  const titleEl = document.getElementById('viewTitle');
  const subEl = document.getElementById('viewSubtitle');
  if (titleEl) titleEl.textContent = t;
  if (subEl) subEl.textContent = s;
  if (name !== 'go') closeDock();
  renderAll();
}

export function renderAll() {
  if (currentView === 'go') renderGo();
  if (currentView === 'routes') renderRoutes();
  if (currentView === 'plan') renderPlan();
  if (currentView === 'places') renderPlaces();
}

export const getCurrentView = () => currentView;

export function initViews() {
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setInterval(() => paintGo(), 1000);
  monitor.onUpdate(() => paintGo());
  on('state', () => { if (currentView === 'go') { /* 由 renderAll 處理 */ } });
}
