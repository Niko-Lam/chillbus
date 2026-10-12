/* ============================================================
   editors.js — 路線編輯器 / 地點編輯器 / 設定
   ============================================================ */
import {
  state, el, clear, toast, commit, uid, svgIcon, getPlace, getRoute, companyName,
  haversine, fmtDistance, deepClone,
} from './core.js';
import { openModal, confirmDialog } from './modal.js';
import { resolveRoute, fetchRouteStops, geocode, reverseGeocode, locate } from './services.js';
import { beginPick, endPick, setMarkers, fit, openDock } from './map.js';
import { refresh, syncMonitors } from './monitor.js';
import { clearPlanCache } from './planner.js';

const PLACE_KINDS = [
  { v: 'home', label: '屋企', icon: 'home' },
  { v: 'work', label: '公司', icon: 'work' },
  { v: 'other', label: '其他', icon: 'pin' },
];
const placeIcon = (kind) => (PLACE_KINDS.find((k) => k.v === kind) || PLACE_KINDS[2]).icon;

/* ============================================================
   地點編輯器
   ============================================================ */
export function openPlaceEditor(placeId, { onSaved } = {}) {
  const existing = placeId ? getPlace(placeId) : null;
  const draft = existing
    ? { ...existing }
    : { id: uid('place'), name: '', kind: 'other', lat: null, lng: null, address: '' };

  const nameInput = el('input', { class: 'input', placeholder: '例如：屋企、公司、健身房', value: draft.name, maxlength: '24' });
  const addrLabel = el('div', { class: 'li-sub', style: { minHeight: '18px' } });
  const coordLabel = el('span', { class: 'chip plain' });
  let kind = draft.kind;

  const kindSeg = el('div', { class: 'seg' }, PLACE_KINDS.map((k) => el('button', {
    type: 'button', class: k.v === kind ? 'is-active' : '', text: k.label,
    onclick: (e) => { kind = k.v; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.remove('is-active')); e.currentTarget.classList.add('is-active'); },
  })));

  function setCoord(lat, lng, { auto = false } = {}) {
    draft.lat = lat; draft.lng = lng;
    coordLabel.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setMarkers([{ lat, lng, kind: 'place', text: '選', label: nameInput.value || '已選位置' }]);
    fit([{ lat, lng }], { single: 16, pad: 80 });
    if (auto) {
      reverseGeocode(lat, lng).then((r) => {
        draft.address = r.label;
        addrLabel.textContent = r.label;
        if (!nameInput.value) nameInput.value = r.name;
      }).catch(() => {});
    }
  }
  if (draft.lat != null) { coordLabel.textContent = `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`; addrLabel.textContent = draft.address || ''; }

  /* --- 地址搜尋 --- */
  const searchInput = el('input', { class: 'input', placeholder: '搵地址或地標，例如「元朗站」' });
  const results = el('div', { class: 'option-list', style: { display: 'none' } });
  const doSearch = async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) return;
    clear(results); results.style.display = 'block';
    results.appendChild(el('div', { class: 'loading-inline' }, [el('span', { class: 'spinner' }), '搜尋中…']));
    try {
      const list = await geocode(q);
      clear(results);
      if (!list.length) { results.appendChild(el('div', { class: 'loading-inline', text: '搵唔到相關地點，試下其他關鍵字。' })); return; }
      list.forEach((r) => results.appendChild(el('button', {
        class: 'opt', type: 'button',
        onclick: () => { setCoord(r.lat, r.lng); addrLabel.textContent = r.label; draft.address = r.label; if (!nameInput.value) nameInput.value = r.name; results.style.display = 'none'; },
      }, [
        el('span', { class: 'oi', html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none">${'<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/>'}</svg>` }),
        el('span', { class: 'ot' }, [el('b', { text: r.name }), el('span', { text: r.label })]),
      ])));
    } catch (err) {
      clear(results); results.appendChild(el('div', { class: 'loading-inline', text: err.message || '搜尋失敗' }));
    }
  };
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

  const btnLocate = el('button', {
    class: 'btn line sm', type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '定位中…';
      try { const p = await locate(); setCoord(p.lat, p.lng, { auto: true }); openDock(); }
      catch (err) { toast('定位失敗', { body: err.message, type: 'alert' }); }
      finally { btn.disabled = false; btn.innerHTML = ''; btn.append(...[svgIcon('target', 16), document.createTextNode('用我目前位置')]); }
    },
  }, [svgIcon('target', 16), '用我目前位置']);

  const btnPick = el('button', {
    class: 'btn line sm', type: 'button',
    onclick: () => {
      openDock();
      const ok = beginPick((ll) => { setCoord(ll.lat, ll.lng, { auto: true }); endPick(); }, '點一下地圖設定位置');
      if (!ok) { toast('地圖未載入', { body: '請用搜尋或者定位功能，或者重新載入頁面。', type: 'alert' }); return; }
      toast('地圖選點中', { body: '喺地圖上點一下就得。', type: 'info' });
    },
  }, [svgIcon('pin', 16), '喺地圖選點']);

  const body = [
    el('div', { class: 'field' }, [el('label', { text: '名稱' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: '類型' }), kindSeg]),
    el('div', { class: 'field' }, [el('label', { text: '搵位置' }), el('div', { class: 'row' }, [searchInput, el('button', { class: 'btn sm', text: '搜尋', onclick: doSearch })])]),
    results,
    el('div', { class: 'hstack' }, [btnLocate, btnPick]),
    el('div', { class: 'note' }, [el('div', { class: 'hstack', style: { justifyContent: 'space-between' } }, [coordLabel, addrLabel])]),
  ];

  const modal = openModal({
    title: existing ? '編輯地點' : '新增地點',
    subtitle: '儲存常用出發點，之後一按就計好時間',
    body,
    footer: [
      existing ? el('button', { class: 'btn danger', text: '刪除', onclick: async () => { const ok = await confirmDialog({ title: '刪除地點？', body: `「${existing.name}」會被移除，使用它的路線要重新設定。`, okText: '刪除', danger: true }); if (!ok) return; state.places = state.places.filter((p) => p.id !== existing.id); state.routes.forEach((r) => { if (r.fromPlaceId === existing.id) r.fromPlaceId = null; if (r.toPlaceId === existing.id) r.toPlaceId = null; }); commit(); modal.close(); toast('已刪除地點', { type: 'info' }); onSaved && onSaved(); } }) : null,
      el('div', { class: 'grow' }),
      el('button', { class: 'btn line', text: '取消', onclick: () => modal.close() }),
      el('button', {
        class: 'btn primary', text: existing ? '儲存' : '新增地點',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) return toast('請輸入名稱', { body: '例如「屋企」或「公司」。', type: 'alert' });
          if (draft.lat == null) return toast('請設定位置', { body: '可以用搜尋、定位或者地圖選點。', type: 'alert' });
          draft.name = name; draft.kind = kind;
          if (existing) Object.assign(existing, draft);
          else state.places.push(draft);
          commit(); modal.close();
          toast(existing ? '已更新地點' : '已新增地點', { body: name, type: 'calm' });
          onSaved && onSaved(draft);
        },
      }),
    ],
  });
  return modal;
}

/* ============================================================
   路線編輯器
   ============================================================ */
export function openRouteEditor(routeId, { onSaved } = {}) {
  const existing = routeId ? getRoute(routeId) : null;
  const draft = existing
    ? deepClone(existing)
    : {
        id: uid('route'), name: '', co: 'KMB', route: '', bound: null, dir: null, serviceType: '1',
        orig: '', dest: '', stops: [], boardStopId: null, alightStopId: null,
        fromPlaceId: state.places.find((p) => p.kind === 'work')?.id || state.places[0]?.id || null,
        toPlaceId: state.places.find((p) => p.kind === 'home')?.id || (state.places[1] && state.places[1].id) || null,
        createdAt: Date.now(),
      };
  let step = existing ? 2 : 1;
  let picked = existing ? { co: existing.co, route: existing.route, bound: existing.bound, dir: existing.dir, serviceType: existing.serviceType, orig: existing.orig, dest: existing.dest } : null;
  let co = existing ? existing.co : 'KMB';
  const modal = openModal({ title: existing ? '編輯路線' : '新增路線', subtitle: '', body: [], wide: false });

  const stepsBar = () => el('div', { class: 'steps' }, [
    el('div', { class: `st ${step === 1 ? 'is-active' : step > 1 ? 'is-done' : ''}` }, [el('i', { text: '1' }), '揀路線']),
    el('div', { class: 'bar' }),
    el('div', { class: `st ${step === 2 ? 'is-active' : step > 2 ? 'is-done' : ''}` }, [el('i', { text: '2' }), '出發／到達']),
    el('div', { class: 'bar' }),
    el('div', { class: `st ${step === 3 ? 'is-active' : ''}` }, [el('i', { text: '3' }), '揀車站']),
  ]);

  function render() {
    modal.setSubtitle(`第 ${step} 步，共 3 步`);
    const body = [stepsBar()];
    if (step === 1) body.push(...stepRoute());
    if (step === 2) body.push(...stepPlaces());
    if (step === 3) body.push(...stepStops());
    modal.setBody(body);
    modal.setFooter(footerFor());
  }

  /* ---------- 第 1 步：路線 ---------- */
  function stepRoute() {
    const coSeg = el('div', { class: 'seg' }, [
      el('button', { class: co === 'KMB' || co === 'LWB' ? 'is-active' : '', text: '九巴 / 龍運', type: 'button', onclick: (e) => { co = 'KMB'; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.remove('is-active')); e.currentTarget.classList.add('is-active'); } }),
      el('button', { class: co === 'CTB' ? 'is-active' : '', text: '城巴', type: 'button', onclick: (e) => { co = 'CTB'; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.remove('is-active')); e.currentTarget.classList.add('is-active'); } }),
    ]);
    const routeInput = el('input', { class: 'input tnum', placeholder: '例如 968、1A、A41', value: picked ? picked.route : draft.route, autocapitalize: 'characters' });
    const out = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    const run = async () => {
      clear(out);
      out.appendChild(el('div', { class: 'loading-inline' }, [el('span', { class: 'spinner' }), '查緊路線資料…']));
      try {
        const list = await resolveRoute(co, routeInput.value);
        clear(out);
        out.appendChild(el('div', { class: 'note', text: `搵到 ${list.length} 個方向，揀返你會搭嘅一個。` }));
        const box = el('div', { class: 'option-list' });
        list.forEach((opt) => box.appendChild(el('button', {
          class: 'opt', type: 'button',
          onclick: () => {
            picked = opt;
            draft.co = opt.co; draft.route = opt.route; draft.bound = opt.bound; draft.dir = opt.dir;
            draft.serviceType = opt.serviceType; draft.orig = opt.orig; draft.dest = opt.dest;
            draft.stops = []; draft.boardStopId = null; draft.alightStopId = null;
            step = 2; render();
          },
        }, [
          el('span', { class: 'oi', text: '→' }),
          el('span', { class: 'ot' }, [
            el('b', { text: `${companyName(opt.co)} ${opt.route} · 往 ${opt.dest}` }),
            el('span', { text: `由 ${opt.orig} 開出${opt.serviceType && opt.serviceType !== '1' ? ` · 特別班次 ${opt.serviceType}` : ''}` }),
          ]),
          svgIcon('arrow', 18),
        ])));
        out.appendChild(box);
      } catch (err) {
        clear(out);
        out.appendChild(el('div', { class: 'note err', text: err.message || '查唔到路線，請確認號碼。' }));
      }
    };
    const search = el('button', { class: 'btn primary', text: '查詢', onclick: run });
    routeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    if (picked) run();
    return [
      el('div', { class: 'field' }, [el('label', { text: '巴士公司' }), coSeg]),
      el('div', { class: 'field' }, [el('label', { text: '路線號碼' }), el('div', { class: 'row' }, [routeInput, search])]),
      out,
      el('div', { class: 'note', text: '資料來自香港政府開放數據（九巴／龍運／城巴實時到站）。' }),
    ];
  }

  /* ---------- 第 2 步：出發點／到達點 ---------- */
  function stepPlaces() {
    const mk = (label, key, hint) => {
      const sel = el('select', { class: 'select' }, [
        el('option', { value: '', text: `請選擇${label}` }),
        ...state.places.map((p) => el('option', { value: p.id, text: p.name, selected: draft[key] === p.id })),
      ]);
      sel.value = draft[key] || '';
      sel.addEventListener('change', () => { draft[key] = sel.value || null; });
      const add = el('button', {
        class: 'btn line sm', type: 'button', text: '＋ 新增',
        onclick: () => openPlaceEditor(null, { onSaved: (p) => { draft[key] = p.id; render(); } }),
      });
      return el('div', { class: 'field' }, [el('label', { text: label }), el('div', { class: 'row' }, [sel, add]), hint ? el('div', { class: 'li-sub', text: hint }) : null]);
    };
    const swap = el('button', {
      class: 'btn line', type: 'button',
      onclick: () => { const t = draft.fromPlaceId; draft.fromPlaceId = draft.toPlaceId; draft.toPlaceId = t; render(); },
    }, [svgIcon('swap', 17), '交換出發點／到達點']);
    return [
      el('div', { class: 'note', text: '出發點係你行去巴士站嘅起點；到達點係落車之後要去嘅地方。' }),
      mk('出發點', 'fromPlaceId', state.places.length ? '' : '未有儲存地點，先新增一個。'),
      el('div', { class: 'hstack', style: { justifyContent: 'center' } }, [swap]),
      mk('到達點', 'toPlaceId'),
    ];
  }

  /* ---------- 第 3 步：車站 ---------- */
  function stepStops() {
    const box = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const fromPlace = getPlace(draft.fromPlaceId), toPlace = getPlace(draft.toPlaceId);
    const loading = el('div', { class: 'loading-inline' }, [el('span', { class: 'spinner' }), '載緊站點資料…']);
    box.appendChild(loading);
    let tab = draft.boardStopId ? 'alight' : 'board';

    const renderLists = () => {
      clear(box);
      const stops = draft.stops || [];
      const boardStop = stops.find((s) => s.id === draft.boardStopId);
      const alightStop = stops.find((s) => s.id === draft.alightStopId);
      const nameInput = el('input', { class: 'input', placeholder: '路線名稱（可留空自動命名）', value: draft.name });
      nameInput.addEventListener('input', () => { draft.name = nameInput.value; });

      const summary = el('div', { class: 'note' }, [
        el('div', { class: 'hstack', style: { justifyContent: 'space-between' } }, [
          el('span', { html: `<b>上車</b> ${boardStop ? boardStop.name : '未揀'}` }),
          el('span', { class: 'chip plain', text: boardStop ? `第 ${boardStop.seq} 站` : '' }),
        ]),
        el('div', { class: 'hstack', style: { justifyContent: 'space-between', marginTop: '6px' } }, [
          el('span', { html: `<b>落車</b> ${alightStop ? alightStop.name : '未揀'}` }),
          el('span', { class: 'chip plain', text: alightStop ? `第 ${alightStop.seq} 站` : '' }),
        ]),
      ]);

      const seg = el('div', { class: 'seg' }, [
        el('button', { class: tab === 'board' ? 'is-active' : '', text: `上車站${boardStop ? ' ✓' : ''}`, type: 'button', onclick: () => { tab = 'board'; renderLists(); } }),
        el('button', { class: tab === 'alight' ? 'is-active' : '', text: `落車站${alightStop ? ' ✓' : ''}`, type: 'button', onclick: () => { tab = 'alight'; renderLists(); } }),
      ]);

      const q = el('input', { class: 'input', placeholder: '搜尋站名…' });
      const listBox = el('div', { class: 'option-list' });
      const target = tab === 'board' ? fromPlace : toPlace;
      const draw = () => {
        clear(listBox);
        const needle = q.value.trim().toLowerCase();
        let items = stops.filter((s) => !needle || s.name.toLowerCase().includes(needle));
        if (tab === 'board' && alightStop) items = items.filter((s) => s.seq < alightStop.seq);
        if (tab === 'alight' && boardStop) items = items.filter((s) => s.seq > boardStop.seq);
        if (target) items = items.map((s) => ({ ...s, dist: haversine(s, target) })).sort((a, b) => a.dist - b.dist);
        if (!items.length) { listBox.appendChild(el('div', { class: 'loading-inline', text: '冇符合嘅車站。' })); return; }
        items.forEach((s) => {
          const selected = tab === 'board' ? s.id === draft.boardStopId : s.id === draft.alightStopId;
          listBox.appendChild(el('button', {
            class: `opt ${selected ? 'is-sel' : ''}`, type: 'button',
            onclick: () => {
              if (tab === 'board') { draft.boardStopId = s.id; if (alightStop && alightStop.seq <= s.seq) draft.alightStopId = null; tab = 'alight'; }
              else { draft.alightStopId = s.id; }
              renderLists();
            },
          }, [
            el('span', { class: 'oi', text: s.seq }),
            el('span', { class: 'ot' }, [el('b', { text: s.name }), el('span', { text: s.dist != null ? `距離${tab === 'board' ? '出發點' : '到達點'} ${fmtDistance(s.dist)}` : `第 ${s.seq} 站` })]),
            selected ? svgIcon('tick', 18) : null,
          ]));
        });
      };
      q.addEventListener('input', draw);
      draw();
      if (tab === 'alight' && !alightStop) {
        box.appendChild(el('div', { class: 'note warn', text: toPlace ? '未揀落車站，可以先喺下面揀，或者用「上一步」設定到達點再自動建議。' : '未設定到達點，所以冇自動建議落車站 — 請喺下面揀一個。' }));
      }

      box.append(
        el('div', { class: 'field' }, [el('label', { text: '路線名稱' }), nameInput]),
        summary,
        seg, q, listBox,
        el('div', { class: 'note', text: `${companyName(draft.co)} ${draft.route} 往 ${draft.dest} · 全程 ${stops.length} 個站。落車站會自動列喺上車站之後。` }),
      );
    };

    (async () => {
      if (!draft.stops || !draft.stops.length) {
        try {
          const stops = await fetchRouteStops({ co: draft.co, route: draft.route, bound: draft.bound, serviceType: draft.serviceType });
          draft.stops = stops;
          // 自動建議：最近出發點做上車站、最近到達點做落車站
          if (!draft.boardStopId && fromPlace) {
            const near = [...stops].sort((a, b) => haversine(a, fromPlace) - haversine(b, fromPlace))[0];
            if (near) draft.boardStopId = near.id;
          }
          if (!draft.alightStopId && toPlace) {
            const board = stops.find((s) => s.id === draft.boardStopId);
            const cands = stops.filter((s) => !board || s.seq > board.seq);
            const near = cands.sort((a, b) => haversine(a, toPlace) - haversine(b, toPlace))[0];
            if (near) draft.alightStopId = near.id;
          }
        } catch (err) {
          clear(box);
          box.appendChild(el('div', { class: 'note err', text: err.message || '載入站點失敗。' }));
          box.appendChild(el('button', { class: 'btn line', text: '返回上一步', onclick: () => { step = 1; render(); } }));
          return;
        }
      }
      renderLists();
    })();

    return [box];
  }

  /* ---------- Footer ---------- */
  function footerFor() {
    const f = [];
    if (step > 1) f.push(el('button', { class: 'btn line', text: '上一步', onclick: () => { step--; render(); } }));
    f.push(el('div', { class: 'grow' }));
    if (step === 1) f.push(el('button', { class: 'btn line', text: '取消', onclick: () => modal.close() }));
    else if (step === 2) f.push(el('button', { class: 'btn primary', text: '下一步', onclick: () => { step = 3; render(); } }));
    else {
      f.push(el('button', { class: 'btn line', text: '取消', onclick: () => modal.close() }));
      f.push(el('button', { class: 'btn primary', text: existing ? '儲存路線' : '新增路線', onclick: save }));
    }
    return f;
  }

  async function save() {
    const stops = draft.stops || [];
    const board = stops.find((s) => s.id === draft.boardStopId);
    const alight = stops.find((s) => s.id === draft.alightStopId);
    if (!board) return toast('請揀上車站', { type: 'alert' });
    if (!alight) return toast('請揀落車站', { type: 'alert' });
    if (alight.seq <= board.seq) return toast('落車站要喺上車站之後', { type: 'alert' });
    const from = getPlace(draft.fromPlaceId), to = getPlace(draft.toPlaceId);
    draft.boardName = board.name; draft.boardLat = board.lat; draft.boardLng = board.lng; draft.boardSeq = board.seq;
    draft.alightName = alight.name; draft.alightLat = alight.lat; draft.alightLng = alight.lng; draft.alightSeq = alight.seq;
    draft.name = (draft.name || '').trim() || `${from ? from.name : '出發'} → ${to ? to.name : draft.dest} · ${draft.route}`;
    draft.updatedAt = Date.now();
    if (existing) Object.assign(existing, draft);
    else state.routes.push(draft);
    if (!state.activeRouteId) state.activeRouteId = draft.id;
    commit();
    clearPlanCache(); syncMonitors();
    if (state.settings.autoMonitor !== false && existing) refresh(draft.id);
    modal.close();
    toast(existing ? '已更新路線' : '已新增路線', { body: draft.name, type: 'calm' });
    onSaved && onSaved(draft);
  }

  render();
  return modal;
}

/* ============================================================
   設定
   ============================================================ */
export function openSettings() {
  const s = state.settings;
  const mkSelect = (label, key, options, note) => {
    const sel = el('select', { class: 'select' }, options.map((o) => el('option', { value: o.v, text: o.label, selected: String(s[key]) === String(o.v) })));
    sel.addEventListener('change', () => { s[key] = isNaN(+sel.value) ? sel.value : +sel.value; commit(); });
    return el('div', { class: 'field' }, [el('label', { text: label }), sel, note ? el('div', { class: 'li-sub', text: note }) : null]);
  };
  const mkToggle = (label, key, note) => {
    const input = el('input', { type: 'checkbox', checked: !!s[key] });
    input.addEventListener('change', () => { s[key] = input.checked; commit(); });
    return el('label', { class: 'switch', style: { justifyContent: 'space-between', width: '100%', padding: '9px 0' } }, [
      el('span', {}, [el('span', { class: 'label', text: label }), note ? el('div', { class: 'li-sub', text: note }) : null]),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [input, el('span', { class: 'track' })]),
    ]);
  };

  const exportBtn = el('button', {
    class: 'btn line sm', text: '匯出資料',
    onclick: () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `chillbus-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('已匯出備份檔', { type: 'calm' });
    },
  });
  const importInput = el('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { replaceState } = await import('./core.js');
      replaceState(data);
      toast('已匯入資料', { body: `${(data.routes || []).length} 條路線、${(data.places || []).length} 個地點。`, type: 'calm' });
    } catch { toast('匯入失敗', { body: '檔案格式不正確。', type: 'alert' }); }
  });

  const body = [
    el('div', { class: 'section-title' }, [el('h3', { text: '步行與時間' })]),
    mkSelect('步行速度', 'walkSpeed', [
      { v: 1.0, label: '慢慢行（約 3.6 km/h）' },
      { v: 1.25, label: '正常速度（約 4.5 km/h）' },
      { v: 1.5, label: '行得快（約 5.4 km/h）' },
    ], '用嚟估算行去車站要幾久。'),
    mkSelect('出發保險時間', 'bufferSec', [
      { v: 0, label: '唔要緩衝' }, { v: 60, label: '1 分鐘' }, { v: 90, label: '1.5 分鐘' },
      { v: 120, label: '2 分鐘' }, { v: 180, label: '3 分鐘' },
    ], '預留少少時間，避免剛剛好或者送車尾。'),
    mkSelect('到站更新頻率', 'pollSec', [
      { v: 15, label: '每 15 秒' }, { v: 30, label: '每 30 秒' }, { v: 60, label: '每 60 秒' }, { v: 120, label: '每 2 分鐘' },
    ]),
    el('div', { class: 'divider' }),
    el('div', { class: 'section-title' }, [el('h3', { text: '提醒方式' })]),
    mkToggle('系統彈窗通知', 'notify', '需要授權；App 喺背景分頁時用系統通知提你。'),
    mkToggle('提示音', 'sound'),
    mkToggle('震動', 'vibrate', '手機支援時生效。'),
    el('div', { class: 'hstack' }, [
      el('button', {
        class: 'btn line sm', text: '要求通知權限',
        onclick: async () => {
          const { requestNotif } = await import('./core.js');
          const r = await requestNotif();
          toast(r === 'granted' ? '已開啟通知 ✓' : '未開啟通知', { body: r === 'granted' ? '夠鐘出發會彈窗提你。' : '你仍然會喺 App 內收到提示。', type: r === 'granted' ? 'calm' : 'info' });
        },
      }),
    ]),
    el('div', { class: 'divider' }),
    el('div', { class: 'section-title' }, [el('h3', { text: '資料' })]),
    el('div', { class: 'hstack' }, [exportBtn, el('button', { class: 'btn line sm', text: '匯入資料', onclick: () => importInput.click() }), importInput]),
    el('button', {
      class: 'btn danger sm', text: '清除所有資料',
      onclick: async () => {
        const ok = await confirmDialog({ title: '確定清除？', body: '所有路線、地點同設定都會被刪除，無法復原。建議先匯出備份。', okText: '全部清除', danger: true });
        if (!ok) return;
        const { replaceState } = await import('./core.js');
        replaceState({ places: [], routes: [], activeRouteId: null, settings: state.settings });
        toast('已清除所有資料', { type: 'info' });
      },
    }),
    el('div', { class: 'note', text: 'ChillBus 只會將資料儲存在你部裝置（localStorage）。實時到站資料來自香港政府資料一線通（data.gov.hk）。' }),
  ];
  return openModal({ title: '設定', subtitle: '調校成你最順手嘅節奏', body });
}
