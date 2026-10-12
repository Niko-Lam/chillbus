/* ============================================================
   planner.js — A 點到 B 點：以已儲存路線尋找最快方案
   ============================================================ */
import { state, haversine, uid } from './core.js';
import { walkTime, fetchEta, rideEstimate } from './services.js';

const DEFAULTS = {
  maxWalkToStop: 1500,     // 起點最多行幾多米去上車
  maxWalkFromStop: 1500,   // 落車後最多行幾多米
  maxTransferWalk: 400,    // 轉乘站之間可接受步行距離
  boardCandidates: 4,
  alightCandidates: 4,
  transferShortlist: 8,
  shortlist: 6,            // 進入實時計算的候選數
  walkDetour: 1.28,        // 直線 → 街道 的估算係數
};

const estWalkSec = (m, opts) => (m * opts.walkDetour) / (state.settings.walkSpeed || 1.25);
const pt = (p) => ({ lat: p.lat, lng: p.lng, name: p.name || p.label || '位置' });

function nearestStops(stops, target, maxMeters, limit, filter) {
  return stops
    .filter((s) => s && s.lat != null && (!filter || filter(s)))
    .map((s) => ({ stop: s, dist: haversine(s, target) }))
    .filter((x) => x.dist <= maxMeters)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

function busPolyline(stops, fromSeq, toSeq) {
  const seg = stops.filter((s) => s.seq >= fromSeq && s.seq <= toSeq);
  return seg.map((s) => [s.lat, s.lng]);
}

/* ---------- 轉乘索引（同一對路線只算一次） ---------- */
const transferCache = new Map();
function transferPairs(r1, r2, opts) {
  const key = `${r1.id}|${r2.id}`;
  if (transferCache.has(key)) return transferCache.get(key);
  const list = [];
  for (const a of r1.stops) {
    for (const b of r2.stops) {
      const d = haversine(a, b);
      if (d <= opts.maxTransferWalk) list.push({ a, b, dist: d });
    }
  }
  list.sort((x, y) => x.dist - y.dist);
  const out = list.slice(0, opts.transferShortlist);
  transferCache.set(key, out);
  return out;
}
export const clearPlanCache = () => transferCache.clear();

/* ---------- 產生候選方案 ---------- */
function candidatesForRoute(route, from, to, opts) {
  const out = [];
  const boards = nearestStops(route.stops, from, opts.maxWalkToStop, opts.boardCandidates);
  if (!boards.length) return out;
  const alights = nearestStops(route.stops, to, opts.maxWalkFromStop, opts.alightCandidates, (s) => s.seq > 0);
  if (!alights.length) return out;
  for (const b of boards) {
    for (const a of alights) {
      if (a.stop.seq <= b.stop.seq) continue;
      const ride = rideEstimate(route.stops, b.stop.seq, a.stop.seq);
      const walkTo = estWalkSec(b.dist, opts);
      const walkFrom = estWalkSec(a.dist, opts);
      out.push({
        kind: 'direct', routes: [route],
        board: b.stop, alight: a.stop,
        walkToDist: b.dist, walkFromDist: a.dist,
        walkToSec: walkTo, walkFromSec: walkFrom,
        rideSec: ride.duration, rideDist: ride.distance,
        waitSec: 4 * 60,
        transfer: null,
        estTotal: walkTo + 4 * 60 + ride.duration + walkFrom,
      });
    }
  }
  return out;
}

function candidatesForTransfer(r1, r2, from, to, opts) {
  const out = [];
  const boards = nearestStops(r1.stops, from, opts.maxWalkToStop, opts.boardCandidates);
  if (!boards.length) return out;
  const alights = nearestStops(r2.stops, to, opts.maxWalkFromStop, opts.alightCandidates);
  if (!alights.length) return out;
  const tps = transferPairs(r1, r2, opts);
  if (!tps.length) return out;
  for (const b of boards) {
    for (const a of alights) {
      for (const t of tps) {
        if (t.a.seq <= b.stop.seq) continue;
        if (t.b.seq >= a.stop.seq) continue;
        const leg1 = rideEstimate(r1.stops, b.stop.seq, t.a.seq);
        const leg2 = rideEstimate(r2.stops, t.b.seq, a.stop.seq);
        if (leg1.duration <= 0 || leg2.duration <= 0) continue;
        const walkTo = estWalkSec(b.dist, opts);
        const walkFrom = estWalkSec(a.dist, opts);
        const tWalk = estWalkSec(t.dist, opts);
        if (tWalk > 8 * 60) continue;
        out.push({
          kind: 'transfer', routes: [r1, r2],
          board: b.stop, alight: a.stop,
          leg1To: t.a, leg2From: t.b,
          walkToDist: b.dist, walkFromDist: a.dist, transferDist: t.dist,
          walkToSec: walkTo, walkFromSec: walkFrom, transferWalkSec: tWalk,
          rideSec: leg1.duration + leg2.duration,
          rideDist: leg1.distance + leg2.distance,
          waitSec: 4 * 60 + 4 * 60,
          estTotal: walkTo + 4 * 60 + leg1.duration + tWalk + 4 * 60 + leg2.duration + walkFrom,
        });
      }
    }
  }
  return out;
}

function dedupeCandidates(list) {
  const best = new Map();
  for (const c of list) {
    const key = `${c.routes[0].id}:${c.board.id}:${c.alight.id}:${c.kind}:${c.routes[1] ? c.routes[1].id : ''}:${c.leg1To ? c.leg1To.id : ''}`;
    const prev = best.get(key);
    if (!prev || c.estTotal < prev.estTotal) best.set(key, c);
  }
  return [...best.values()];
}

/* ---------- 精算（真實步行 + 實時到站） ---------- */
async function refine(cand, from, to, opts) {
  const opt = { ...cand };
  const walks = [];
  walks.push(walkTime(from, opt.board));                                   // 起點 → 上車站
  if (opt.kind === 'transfer') walks.push(walkTime(opt.leg1To, opt.leg2From));
  walks.push(walkTime(opt.alight, to));                                    // 落車站 → 終點
  const etas = [etaWait(opt.routes[0], opt.board, opt.routes[0].dir)];
  if (opt.kind === 'transfer') etas.push(etaWait(opt.routes[1], opt.leg2From, opt.routes[1].dir));
  const [wRes, eRes] = await Promise.all([Promise.all(walks), Promise.all(etas)]);
  const wTo = wRes[0];
  const wTransfer = opt.kind === 'transfer' ? wRes[1] : null;
  const wFrom = opt.kind === 'transfer' ? wRes[2] : wRes[1];
  opt.walkTo = wTo; opt.walkFrom = wFrom; opt.walkTransfer = wTransfer;
  opt.walkToSec = wTo.duration; opt.walkFromSec = wFrom.duration;
  opt.transferWalkSec = wTransfer ? wTransfer.duration : 0;
  opt.eta1 = eRes[0]; opt.eta2 = opt.kind === 'transfer' ? eRes[1] : null;
  opt.waitSec = (opt.eta1.secs != null ? Math.max(0, opt.eta1.secs) : 4 * 60) + (opt.kind === 'transfer' ? (opt.eta2.secs != null ? Math.max(0, opt.eta2.secs) : 4 * 60) : 0);
  // 車程：有實時到站就用地鐵式差值，否則用估算
  const rideFromEta = opt.eta1.rideSecs;
  opt.rideSec = rideFromEta != null && rideFromEta > 0 ? rideFromEta : opt.rideSec;
  opt.rideSource = rideFromEta != null && rideFromEta > 0 ? 'live' : 'est';
  opt.totalSec = opt.walkToSec + opt.waitSec + opt.rideSec + opt.transferWalkSec + opt.walkFromSec;
  opt.leaveAt = Date.now() + opt.walkToSec * 1000 + (opt.eta1.secs != null ? 0 : 0);
  opt.leaveInSec = Math.max(0, (opt.eta1.at ? opt.eta1.at - Date.now() : opt.waitSec * 1000) / 1000 - opt.walkToSec - state.settings.bufferSec);
  return opt;
}

async function etaWait(route, stop, dir) {
  try {
    const list = await fetchEta({ co: route.co, route: route.route, dir: route.dir, serviceType: route.serviceType, stopId: stop.id });
    if (!list.length) return { at: null, secs: null, rideSecs: null, list: [] };
    const first = list[0];
    let ride = null;
    const idx = route.stops.findIndex((s) => s.id === stop.id);
    if (idx >= 0 && route.stops[idx]) {
      // 用「同一部車」在落車站的預計到站時間估算實際車程
      const second = await fetchEta({ co: route.co, route: route.route, dir: route.dir, serviceType: route.serviceType, stopId: route.stops[route.stops.length - 1].id }).catch(() => []);
      const idxNow = route.stops.findIndex((s) => s.id === stop.id);
      const est = rideEstimate(route.stops, route.stops[Math.max(0, idxNow)].seq, route.stops[route.stops.length - 1].seq).duration;
      if (second.length && second[0].at > first.at && est > 0) {
        const raw = (second[0].at - first.at) / 1000;
        ride = Math.round(Math.min(est * 2, Math.max(est * 0.7, raw)));   // 夾在合理範圍，避免攞錯班次
      }
    }
    return { at: first.at, secs: first.secs, rideSecs: ride, list };
  } catch {
    return { at: null, secs: null, rideSecs: null, list: [] };
  }
}

/* ---------- 主入口 ---------- */
/**
 * @param {{lat,lng,name}} from
 * @param {{lat,lng,name}} to
 * @param {object} userOpts
 * @returns {Promise<{options:Array, checked:number, skipped:number}>}
 */
export async function plan(from, to, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  if (!from || !to) throw new Error('請先選擇起點與終點。');
  const routes = state.routes.filter((r) => Array.isArray(r.stops) && r.stops.length > 1);
  const skipped = state.routes.length - routes.length;
  if (!routes.length) return { options: [], checked: 0, skipped };

  transferCache.clear();
  const raw = [];
  for (const r of routes) raw.push(...candidatesForRoute(r, from, to, opts));
  const addTransfer = userOpts.allowTransfer !== false && routes.length > 1;
  if (addTransfer) {
    for (let i = 0; i < routes.length; i++) {
      for (let j = 0; j < routes.length; j++) {
        if (i === j) continue;
        raw.push(...candidatesForTransfer(routes[i], routes[j], from, to, opts));
      }
    }
  }
  let list = dedupeCandidates(raw).sort((a, b) => a.estTotal - b.estTotal);
  // 同路線直達優先：直達方案排在轉乘之前
  list.sort((a, b) => (a.kind === b.kind ? a.estTotal - b.estTotal : a.kind === 'direct' ? -1 : 1));
  const shortlist = list.slice(0, opts.shortlist);
  const refined = [];
  for (const c of shortlist) {
    try { refined.push(await refine(c, from, to, opts)); } catch { /* 單一方案失敗不影響其他 */ }
  }
  const options = refined
    .sort((a, b) => (a.kind === b.kind ? a.totalSec - b.totalSec : a.kind === 'direct' ? -1 : 1))
    .map((o) => shape(o, from, to));
  const bestDirect = options.find((o) => o.kind === 'direct');
  const best = bestDirect && (!options[0] || options[0].totalSec > bestDirect.totalSec + 180) ? bestDirect : options[0];
  return { options, best, checked: list.length, skipped };
}

function shape(o, from, to) {
  const legs = [];
  legs.push({
    type: 'walk', label: `行去 ${o.board.name}`, from: pt(from), to: pt(o.board),
    durationSec: o.walkToSec, distance: o.walkTo.distance, coords: o.walkTo.coords, source: o.walkTo.source,
  });
  legs.push({
    type: 'bus', route: o.routes[0], fromStop: o.board, toStop: o.kind === 'transfer' ? o.leg1To : o.alight,
    durationSec: rideEstimate(o.routes[0].stops, o.board.seq, (o.kind === 'transfer' ? o.leg1To.seq : o.alight.seq)).duration,
    distance: rideEstimate(o.routes[0].stops, o.board.seq, (o.kind === 'transfer' ? o.leg1To.seq : o.alight.seq)).distance,
    coords: busPolyline(o.routes[0].stops, o.board.seq, o.kind === 'transfer' ? o.leg1To.seq : o.alight.seq),
    waitSec: o.eta1.secs != null ? Math.max(0, o.eta1.secs) : 4 * 60,
    etaAt: o.eta1.at, seqFrom: o.board.seq, seqTo: o.kind === 'transfer' ? o.leg1To.seq : o.alight.seq,
  });
  if (o.kind === 'transfer') {
    legs.push({
      type: 'walk', label: `轉乘 ${o.routes[1].route}`, from: pt(o.leg1To), to: pt(o.leg2From),
      durationSec: o.transferWalkSec, distance: o.walkTransfer.distance, coords: o.walkTransfer.coords, source: o.walkTransfer.source,
    });
    legs.push({
      type: 'bus', route: o.routes[1], fromStop: o.leg2From, toStop: o.alight,
      durationSec: rideEstimate(o.routes[1].stops, o.leg2From.seq, o.alight.seq).duration,
      distance: rideEstimate(o.routes[1].stops, o.leg2From.seq, o.alight.seq).distance,
      coords: busPolyline(o.routes[1].stops, o.leg2From.seq, o.alight.seq),
      waitSec: o.eta2 && o.eta2.secs != null ? Math.max(0, o.eta2.secs) : 4 * 60,
      etaAt: o.eta2 ? o.eta2.at : null, seqFrom: o.leg2From.seq, seqTo: o.alight.seq,
    });
  }
  legs.push({
    type: 'walk', label: `行去 ${to.name}`, from: pt(o.alight), to: pt(to),
    durationSec: o.walkFromSec, distance: o.walkFrom.distance, coords: o.walkFrom.coords, source: o.walkFrom.source,
  });
  return {
    id: uid('plan'), kind: o.kind, from: pt(from), to: pt(to),
    totalSec: o.totalSec, walkSec: o.walkToSec + o.walkFromSec + (o.transferWalkSec || 0),
    rideSec: o.rideSec, waitSec: o.waitSec, busCount: o.routes.length,
    routes: o.routes, legs,
    leaveInSec: o.leaveInSec, rideSource: o.rideSource,
    board: o.board, alight: o.alight,
    transfers: o.kind === 'transfer' ? [{ ...pt(o.leg1To), name: o.leg1To.name }] : [],
    cand: o,
  };
}
