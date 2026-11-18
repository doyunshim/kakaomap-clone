/* =====================================================================
 *  길찾기 : 출발/도착 입력(자동완성) · 바꾸기 · 이동수단 4종 · 경로 그리기
 * ===================================================================== */
const Dir = (() => {
  const st = {
    start: null, end: null, mode: null, lastMode: store.get('km_mode', 'car'),
    carOpt: 'rec', data: null, sel: { transit: 0, walk: 0, bike: 0 }, open: null, trTab: 'all', stepSel: -1,
    layers: [], stepMarkers: [], sgFor: null, sgItems: [], sgIdx: -1, loading: false, ddOpen: false,
  };
  const BLUE = '#2c62f0';
  const { fmtMin, fmtDist } = Routes;
  const timeHtml = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}<small>분</small>` : ''}` : `${m}<small>분</small>`);

  const TURN = {
    right: '<svg width="34" height="30" viewBox="0 0 34 30"><path d="M9 29V15.5a4.5 4.5 0 0 1 4.5-4.5H23" fill="none" stroke="#111" stroke-width="4.2"/><path d="M21.5 2.5l9 8.5-9 8.5z" fill="#111"/></svg>',
    left: '<svg width="34" height="30" viewBox="0 0 34 30" style="transform:scaleX(-1)"><path d="M9 29V15.5a4.5 4.5 0 0 1 4.5-4.5H23" fill="none" stroke="#111" stroke-width="4.2"/><path d="M21.5 2.5l9 8.5-9 8.5z" fill="#111"/></svg>',
    straight: '<svg width="34" height="30" viewBox="0 0 34 30"><path d="M17 29V10" stroke="#111" stroke-width="4.2"/><path d="M8.5 12L17 2l8.5 10z" fill="#111"/></svg>',
    uturn: '<svg width="34" height="30" viewBox="0 0 34 30"><path d="M24 29V12a7 7 0 0 0-14 0v6" fill="none" stroke="#111" stroke-width="4.2"/><path d="M2.5 16l7.5 9 7.5-9z" fill="#111"/></svg>',
    side: '<svg width="34" height="30" viewBox="0 0 34 30"><path d="M3 28c3-1 5-2 7-5l7-12" fill="none" stroke="#111" stroke-width="4"/><path d="M31 28c-3-1-5-2-7-5l-7-12" fill="none" stroke="#111" stroke-width="4"/><path d="M17 11V2" stroke="#111" stroke-width="2"/><rect x="2" y="2" width="30" height="5" rx="1.5" fill="#111" opacity=".85"/></svg>',
  };
  const TRAFFIC_COLOR = { 원활: '#2fb359', 서행: '#f5b800', 정체: '#e8382f' };

  /* ---------------- 공개 API ---------------- */
  function setPoint(which, p) {
    st[which] = p;
    const inp = which === 'start' ? $('#inpStart') : $('#inpEnd');
    inp.value = p ? p.name : '';
    toggleClear();
    compute();
  }

  /* ---------------- 경로 계산 ---------------- */
  async function compute() {
    st.stepSel = -1; st.open = null; st.sel = { transit: 0, walk: 0, bike: 0 }; st.trTab = 'all'; st.carOpt = 'rec';
    if (!(st.start && st.end)) { st.data = null; render(); return; }
    if (Routes.dist(st.start, st.end) < 20) { App.toast('출발지와 도착지가 같아요'); st.data = null; render(); return; }
    st.mode = st.mode || st.lastMode || 'car';
    const token = ++compute.token;
    const s = st.start; const e = st.end;
    st.data = { transit: Routes.transit(s, e) };
    st.loading = true;
    render();
    const [car, walk, bike] = await Promise.all([Routes.car(s, e), Routes.walk(s, e), Routes.bike(s, e)]);
    if (token !== compute.token) return; // 그 사이 출발/도착이 바뀜
    st.data = { car, transit: st.data.transit, walk, bike };
    st.loading = false;
    if (car.rec.estimated) App.toast('경로 서버에 연결하지 못해 직선 추정 경로로 표시해요');
    render(true);
  }
  compute.token = 0;
  const hasRoute = () => !!(st.data && st.mode && !st.loading);

  /* ---------------- 렌더링 ---------------- */
  function render(fit = false) {
    $$('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    $('.modes').classList.toggle('has-route', !!st.data);
    const body = $('#routeBody');
    if (!st.data) body.innerHTML = emptyHtml();
    else if (st.loading) body.innerHTML = '<div class="loading"><div class="spinner"></div>경로를 찾고 있어요</div>';
    else if (st.mode === 'car') body.innerHTML = carHtml();
    else if (st.mode === 'transit') body.innerHTML = transitHtml();
    else if (st.mode === 'walk') body.innerHTML = cardsHtml('walk');
    else if (st.mode === 'bike') body.innerHTML = cardsHtml('bike');
    App.updateFooter();
    if (App.tab === 'route') draw(fit);
  }
  function emptyHtml() {
    return `<div class="route-empty"><div class="msg"><h3>오늘은<br>어디로 안내할까요?</h3><p>매일매일 업데이트되는 최신정보로<br>가장 빠른 경로를 알려드려요.</p>
      <p style="font-size:13px;margin-top:22px;color:#aaa">출발지·도착지를 입력하거나 지도를 우클릭해 보세요</p></div>
      <svg viewBox="0 0 390 230" preserveAspectRatio="xMidYMax meet">
        <g fill="#cfe1f7"><path d="M90 92c4-14 26-16 32-4 10-3 20 4 18 12H72c-2-6 6-12 18-8z"/><path d="M300 128c3-10 20-12 25-3 8-2 16 3 14 9h-52c-1-4 4-9 13-6z"/></g>
        <path d="M0 196q10-9 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0V206H0z" fill="#3f8a52"/>
        <rect y="204" width="390" height="26" fill="#5c5c5c"/><rect y="204" width="390" height="4" fill="#777"/>
        <g transform="translate(150 132)">
          <path d="M8 44c0-8 3-13 10-15l14-4 12-15c3-4 8-6 13-6h30c6 0 10 2 13 7l11 14 12 3c6 2 9 6 9 12v10c0 3-2 5-5 5H13c-3 0-5-2-5-5z" fill="#c9ad86"/>
          <path d="M52 12h22v15H40zM80 12h12c3 0 5 1 7 4l7 11H80z" fill="#3b4a5c"/>
          <circle cx="68" cy="24" r="6" fill="#f1c9a5"/><path d="M60 22c0-6 4-9 9-9s8 3 8 8z" fill="#222"/>
          <circle cx="36" cy="58" r="12" fill="#222"/><circle cx="36" cy="58" r="5" fill="#999"/>
          <circle cx="104" cy="58" r="12" fill="#222"/><circle cx="104" cy="58" r="5" fill="#999"/>
          <rect x="128" y="38" width="6" height="5" rx="1" fill="#f6d36b"/>
        </g>
      </svg></div>`;
  }

  /* ----- 자동차 ----- */
  function carHtml() {
    const d = st.data.car[st.carOpt];
    const optName = Routes.CAR_OPTS.find((o) => o.key === st.carOpt).name;
    const dd = st.ddOpen ? `<div class="dropdown">${Routes.CAR_OPTS.map((o) => {
      const x = st.data.car[o.key];
      return `<button data-caropt="${o.key}" class="${o.key === st.carOpt ? 'on' : ''}">${o.name}<small>${fmtMin(x.time)} · ${fmtDist(x.dist)}</small></button>`;
    }).join('')}</div>` : '';
    const steps = d.steps.map((s, i) => {
      const isStart = s.turn === 'start'; const isEnd = s.turn === 'end';
      const ico = isStart ? `<b>출발</b>${s.traffic}` : isEnd ? '<b>도착</b>' : `${TURN[s.turn] || TURN.straight}${s.traffic}`;
      const txt = s.title && !isStart && !isEnd ? `<b>${esc(s.title)}</b><p>${esc(s.desc)}</p>`
        : isStart ? `<b>출발지</b><p>${esc(s.desc)}</p>` : isEnd ? `<b>도착</b><p>${esc(s.desc)}</p>` : `<p class="only">${esc(s.desc)}</p>`;
      return `<li class="step ${st.stepSel === i ? 'on' : ''}" data-step="${i}" style="--tc:${TRAFFIC_COLOR[s.traffic]}">
        <div class="st-ico">${ico}</div><div class="st-num">${i + 1}</div><div class="st-txt">${txt}</div>
        <button class="st-rv" data-todo aria-label="로드뷰">${ICON.roadview}</button></li>`;
    }).join('');
    return `<div class="car-opts"><button class="pill-sel strong" id="carOptBtn">${optName}</button><button class="pill-sel" data-todo>경로 옵션</button>
        <button class="car-fuel" data-todo>1종, 휘발유 기준</button>${dd}</div>
      <div class="car-sum"><div class="car-time"><b>${timeHtml(d.time)}</b><span>${fmtDist(d.dist)}</span></div>
        <button class="btn-later" data-todo><svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="7.5" fill="none" stroke="#333" stroke-width="1.5"/><path d="M10 5.5V10l3 2" fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round"/></svg>나중에 출발</button>
        <div class="car-cost">통행료 약 ${Routes.won(d.toll)}<i></i>택시비 약 ${Routes.won(d.taxi)}<i></i>주유비 약 ${Routes.won(d.fuel)}</div></div>
      <div class="car-start"><span class="pin-sm">${ICON.pin('#2f6ff0').replace('<b></b>', '')}<span>출발</span></span>${esc(st.start.name)}<button class="btn-sm" data-todo>상세보기</button></div>
      <ul class="steps">${steps}</ul>`;
  }

  /* ----- 대중교통 ----- */
  const busBadge = (color) => `<span class="tl-badge" style="background:#2c3f7c"><svg viewBox="0 0 16 16" width="17" height="17">${ICON.bus.replace(/<\/?svg[^>]*>/g, '')}</svg></span>`;
  const subBadge = (r) => `<span class="tl-badge" style="background:${r.color}">${r.line}</span>`;
  function linesHtml(r) {
    if (r.kind !== 'bus') return '';
    const groups = [];
    r.lines.forEach((l) => { const g = groups.find((x) => x.type === l.type); if (g) g.nos.push(l.no); else groups.push({ type: l.type, nos: [l.no] }); });
    return `<div class="tl-lines">${groups.map((g) => `<span class="tag" style="background:${BUS_TYPE[g.type]}">${g.type}</span>${g.nos.map(esc).join(', ')}`).join(', ')}</div>`;
  }
  function transitHtml() {
    const T = st.data.transit;
    if (T.tooClose) {
      return `<div class="no-res">출발지와 도착지가 가까워요.<br><b>도보 이용</b>을 추천해요.<br><br>
        <button class="pill-sel" style="margin:0 auto" data-gomode="walk">도보 길찾기 보기</button></div>`;
    }
    const L = T.list;
    const cnt = { all: L.length, bus: L.filter((o) => o.cat === 'bus').length, subway: L.filter((o) => o.cat === 'subway').length, mixed: L.filter((o) => o.cat === 'mixed').length };
    const tabs = [['all', '전체'], ['bus', '버스'], ['subway', '지하철'], ['mixed', '버스+지하철']];
    let h = `<div class="tr-tabs">${tabs.map(([k, n]) => `<button data-trtab="${k}" class="${st.trTab === k ? 'on' : ''}">${n} ${cnt[k]}</button>`).join('')}</div>`;
    const shown = L.map((o, i) => ({ o, i })).filter(({ o }) => st.trTab === 'all' || o.cat === st.trTab);
    if (!shown.length) h += '<div class="no-res">해당하는 경로가 없어요</div>';
    h += shown.map(({ o, i }) => {
      const rows = o.rides.map((r) => `<div class="tl-row"><div class="rail">${r.kind === 'bus' ? busBadge() : subBadge(r)}<span class="bar"></span></div>
          <div class="tl-body"><div class="tl-stop">${esc(r.from.name)}${r.kind === 'bus' && r.from.id ? `<small>${r.from.id}</small>` : ''}${r.kind === 'subway' && r.from.dir ? `<small>${esc(r.from.dir)}</small>` : ''}</div>${linesHtml(r)}</div></div>`).join('');
      const last = o.rides[o.rides.length - 1].to;
      const open = st.open === `t${i}`;
      return `<div class="card ${st.sel.transit === i ? 'on' : ''} ${open ? 'open' : ''}" data-card="${i}">
        <div class="card-hd"><span class="tm">${timeHtml(o.time)}</span><span class="meta">도보${o.walk}분<i></i>${o.transfers ? `환승${o.transfers}회` : '환승없음'}<i></i>요금 ${o.fare}<i></i>${fmtDist(o.dist)}</span>
          <button class="caret" data-caret="t${i}" aria-label="상세"></button></div>
        <div class="tline">${rows}<div class="tl-row"><div class="rail"><span class="tl-end"></span></div><div class="tl-body" style="padding-bottom:0"><div class="tl-stop">${esc(last.name)}</div></div></div></div>
        ${open ? transitDetail(o) : ''}</div>`;
    }).join('');
    return h;
  }
  function transitDetail(o) {
    const rows = o.legs.map((l, li) => {
      if (l.kind === 'walk') {
        if (l.d < 15) return '';
        return `<div class="td-row" data-pan="${l.to.lat},${l.to.lng}"><div class="td-rail"><span class="td-ico" style="background:#999">${ICON.walk}</span><span class="line walk"></span></div>
          <div class="td-body"><b>도보 ${l.min}분</b><div class="g">${fmtDist(l.d)} · ${esc(l.to.name)}까지</div></div></div>`;
      }
      const r = l.ride;
      const badge = r.kind === 'bus' ? `<span class="td-ico" style="background:${r.color}">버스</span>` : `<span class="td-ico" style="background:${r.color}">${r.line}</span>`;
      const label = r.kind === 'bus' ? linesHtml(r) : `<div class="g">${SUBWAY[r.line].name}${r.from.dir ? ` · ${esc(r.from.dir)}` : ''}</div>`;
      return `<div class="td-row" data-pan="${r.from.lat},${r.from.lng}"><div class="td-rail">${badge}<span class="line" style="background:${r.color}"></span></div>
        <div class="td-body"><b>${esc(r.from.name)} 승차</b>${label}
          <details class="stops"><summary>${r.stations.length}개 ${r.kind === 'bus' ? '정류장' : '역'} 이동 (${r.min}분)</summary><ol>${r.stations.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details></div></div>
        <div class="td-row" data-pan="${r.to.lat},${r.to.lng}"><div class="td-rail"><span class="td-ico" style="background:#fff;border:3px solid ${r.color}"></span></div>
        <div class="td-body"><b>${esc(r.to.name)} 하차</b></div></div>`;
    }).join('');
    return `<div class="tr-detail">${rows}<div class="td-row"><div class="td-rail"><span class="td-ico" style="background:var(--red)">도</span></div><div class="td-body"><b>도착</b><div class="g">${esc(st.end.name)}</div></div></div></div>`;
  }

  /* ----- 도보 / 자전거 ----- */
  function elevSvg(r) {
    const W = 300; const H = 66; const lo = Math.min(...r.elev) - 2; const hi = Math.max(...r.elev) + 2;
    const pts = r.elev.map((v, i) => [(i / (r.elev.length - 1)) * W, H - 22 - ((v - lo) / (hi - lo)) * 26]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const f = pts[0]; const l = pts[pts.length - 1];
    return `<div class="elev"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${line}L${W},${H}L0,${H}Z" fill="#cfe4fb"/><path d="${line}" fill="none" stroke="#e9f3fe" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <path d="M${f[0] + 3},${f[1]}V${H}M${l[0] - 3},${l[1]}V${H}" stroke="#3a86e8" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/></svg>
      <span style="left:10px">${Math.round(r.elev[0])}m</span><span style="right:10px">${Math.round(r.elev[r.elev.length - 1])}m</span></div>`;
  }
  function cardsHtml(kind) {
    const list = st.data[kind];
    let h = list.map((r, i) => {
      const open = st.open === `${kind}${i}`;
      const meta = kind === 'walk' ? `${r.extra}<i></i>${r.kcal}kcal소모` : `고도 최저 ${r.lo}m, 최고 ${r.hi}m<i></i>${r.kcal}kcal`;
      const steps = open ? `<ol class="wk-steps">${r.steps.map((s, k) => `<li data-pan="${s.pos.lat},${s.pos.lng}"><span class="n">${k + 1}</span>${esc(s.text)}<span class="d">${esc(s.d)}</span></li>`).join('')}</ol>` : '';
      return `<div class="wk-card ${st.sel[kind] === i ? 'on' : ''} ${open ? 'open' : ''}" data-wk="${i}">
        <div class="lbl">${r.label}</div>
        <div class="tm"><b>${timeHtml(r.time)}</b><span>${fmtDist(r.dist)}</span></div>
        <div class="meta">${meta}</div>
        <button class="caret" data-caret="${kind}${i}" aria-label="상세"></button>
        ${steps}${kind === 'bike' ? elevSvg(r) : ''}</div>`;
    }).join('');
    if (kind === 'bike') h += '<div class="bike-note">소요시간은 자전거 평속 20km/h 내외로 환산하여 제공됩니다.</div>';
    return h;
  }

  /* ---------------- 지도 그리기 ---------------- */
  function clearLayers() { st.layers.forEach((l) => l.remove()); st.layers = []; st.stepMarkers = []; }
  function pinNode(cls, text) { return el(`<div class="route-pin ${cls}"><span>${text}</span></div>`); }
  function draw(fit) {
    clearLayers();
    const pts = [];
    if (st.start) { st.layers.push(MapX.addOverlay(st.start, pinNode('s', '출발'), { z: 60 })); pts.push(st.start); }
    if (st.end) { st.layers.push(MapX.addOverlay(st.end, pinNode('e', '도착'), { z: 60 })); pts.push(st.end); }
    const add = (path) => path.forEach((c) => pts.push({ lat: c[0], lng: c[1] }));
    if (hasRoute()) {
      if (st.mode === 'car') {
        const d = st.data.car[st.carOpt];
        st.layers.push(MapX.addLine(d.path, { color: BLUE, weight: 9 }));
        st.layers.push(MapX.addLine(d.path, { color: '#ffffff', weight: 2, opacity: 0.9, dashed: 'dash', outline: false }));
        add(d.path);
        d.steps.slice(0, -1).forEach((s, i) => {
          const node = el(`<div class="step-num ${st.stepSel === i ? 'on' : ''}">${i + 1}</div>`);
          node.addEventListener('click', () => selectStep(i, false));
          st.stepMarkers.push(node);
          st.layers.push(MapX.addOverlay(s.pos, node, { xAnchor: 0.5, yAnchor: 0.5, z: 30 }));
        });
      } else if (st.mode === 'transit' && st.data.transit.list.length) {
        const o = st.data.transit.list[st.sel.transit];
        if (o) {
          if (!o.realSegs) {
            Routes.transitGeometry(o).then(() => {
              if (st.mode === 'transit' && App.tab === 'route' && st.data && st.data.transit.list[st.sel.transit] === o) draw(false);
            });
          }
          (o.realSegs || o.segs).forEach((s) => {
            if (s.kind === 'walk') st.layers.push(MapX.addLine(s.path, { color: '#777', weight: 5, dashed: true, outline: false }));
            else st.layers.push(MapX.addLine(s.path, { color: s.color, weight: 8 }));
            add(s.path);
          });
          o.rides.forEach((r) => [r.from, r.to].forEach((p) => {
            const node = el(`<div class="stop-dot" style="border-color:${r.color}"></div>`);
            st.layers.push(MapX.addOverlay(p, node, { xAnchor: 0.5, yAnchor: 0.5, z: 25 }));
          }));
        }
      } else if (st.mode === 'walk' || st.mode === 'bike') {
        const r = st.data[st.mode][st.sel[st.mode]];
        st.layers.push(MapX.addLine(r.path, { color: BLUE, weight: st.mode === 'walk' ? 7 : 8 }));
        add(r.path);
      }
    }
    if (fit && pts.length) MapX.fitPoints(pts, 80);
    else if (fit === 'one' && pts.length === 1) MapX.setCenter(pts[0], 3);
  }
  function selectStep(i, pan = true) {
    st.stepSel = i;
    $$('#routeBody .step').forEach((n) => n.classList.toggle('on', +n.dataset.step === i));
    st.stepMarkers.forEach((n, k) => n.classList.toggle('on', k === i));
    const s = st.data.car[st.carOpt].steps[i];
    if (pan) MapX.setCenter(s.pos, 2);
    else { const n = $(`#routeBody .step[data-step="${i}"]`); if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  /* ---------------- 입력 자동완성 ---------------- */
  let sgTimer = null;
  function toggleClear() {
    $('[data-clear="start"]').hidden = !$('#inpStart').value;
    $('[data-clear="end"]').hidden = !$('#inpEnd').value;
  }
  function suggest(which) {
    const inp = which === 'start' ? $('#inpStart') : $('#inpEnd');
    const q = inp.value.trim();
    const box = $('#routeSuggest');
    st.sgFor = which;
    clearTimeout(sgTimer);
    if (!q) { box.hidden = true; return; }
    sgTimer = setTimeout(async () => {
      const items = (await Search.findPlaces(q, 8)).map((p) => ({ name: fullName(p), sub: `${p.cat} · ${p.addr}`, lat: p.lat, lng: p.lng }));
      if (inp.value.trim() !== q) return;
      st.sgItems = items; st.sgIdx = items.length ? 0 : -1;
      const row = inp.closest('.rf-row');
      box.style.top = `${row.getBoundingClientRect().bottom - $('.route-form').getBoundingClientRect().top}px`;
      box.innerHTML = items.length
        ? items.map((it, i) => `<div class="sg-item ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="sg-ico">${ICON.mapPin}</span><div class="sg-main"><div class="sg-name">${esc(it.name)}</div><div class="sg-sub">${esc(it.sub)}</div></div></div>`).join('')
        : `<div class="sg-empty">'${esc(q)}' 검색결과가 없어요</div>`;
      box.hidden = false;
    }, 220);
  }
  function pick(i) {
    const it = st.sgItems[i];
    if (!it || !st.sgFor) return;
    $('#routeSuggest').hidden = true;
    const which = st.sgFor;
    setPoint(which, { name: it.name, lat: it.lat, lng: it.lng });
    if (which === 'start' && !st.end) $('#inpEnd').focus();
    else if (which === 'end' && !st.start) $('#inpStart').focus();
    else document.activeElement.blur();
    if (!(st.start && st.end)) MapX.setCenter(it, 3);
  }

  /* ---------------- 이벤트 ---------------- */
  function init() {
    [['start', '#inpStart'], ['end', '#inpEnd']].forEach(([which, sel]) => {
      const inp = $(sel);
      inp.addEventListener('input', () => {
        toggleClear();
        if (st[which]) { st[which] = null; st.data = null; render(); }
        suggest(which);
      });
      inp.addEventListener('focus', () => { if (inp.value && !st[which]) suggest(which); });
      inp.addEventListener('blur', () => setTimeout(() => { if (st.sgFor === which) $('#routeSuggest').hidden = true; }, 150));
      inp.addEventListener('keydown', (e) => {
        const box = $('#routeSuggest');
        const items = $$('.sg-item', box);
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length && !box.hidden) {
          e.preventDefault();
          st.sgIdx = (st.sgIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items.forEach((n, k) => n.classList.toggle('on', k === st.sgIdx));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (!box.hidden && st.sgIdx >= 0) pick(st.sgIdx);
        } else if (e.key === 'Escape') box.hidden = true;
      });
    });
    $('#routeSuggest').addEventListener('mousedown', (e) => e.preventDefault());
    $('#routeSuggest').addEventListener('click', (e) => { const it = e.target.closest('.sg-item'); if (it) pick(+it.dataset.i); });
    $$('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      const which = b.dataset.clear;
      st[which] = null; $(which === 'start' ? '#inpStart' : '#inpEnd').value = '';
      toggleClear(); st.data = null; render();
      $(which === 'start' ? '#inpStart' : '#inpEnd').focus();
    }));
    $('#btnSwap').addEventListener('click', () => {
      [st.start, st.end] = [st.end, st.start];
      [$('#inpStart').value, $('#inpEnd').value] = [$('#inpEnd').value, $('#inpStart').value];
      toggleClear(); compute();
    });
    $('#btnReset').addEventListener('click', () => {
      st.start = null; st.end = null; st.data = null; st.mode = null;
      $('#inpStart').value = ''; $('#inpEnd').value = ''; toggleClear(); render();
    });
    $$('.modes button').forEach((b) => b.addEventListener('click', () => {
      st.mode = b.dataset.mode; st.lastMode = st.mode; store.set('km_mode', st.mode);
      st.open = null; st.stepSel = -1; st.ddOpen = false;
      render(true);
      $('#routeBody').scrollTop = 0;
    }));
    $('#btnOverview').addEventListener('click', () => draw(true));

    $('#routeBody').addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-todo]')) return;
      if (t.closest('#carOptBtn')) { st.ddOpen = !st.ddOpen; return render(); }
      const co = t.closest('[data-caropt]');
      if (co) { st.carOpt = co.dataset.caropt; st.ddOpen = false; st.stepSel = -1; return render(true); }
      if (st.ddOpen) { st.ddOpen = false; render(); }
      const gm = t.closest('[data-gomode]');
      if (gm) { st.mode = gm.dataset.gomode; return render(true); }
      const step = t.closest('[data-step]'); if (step) return selectStep(+step.dataset.step);
      const tt = t.closest('[data-trtab]');
      if (tt) {
        st.trTab = tt.dataset.trtab;
        const first = st.data.transit.list.findIndex((o) => st.trTab === 'all' || o.cat === st.trTab);
        if (first >= 0) st.sel.transit = first;
        st.open = null; return render(true);
      }
      if (t.closest('summary')) return;
      const pan = t.closest('[data-pan]');
      if (pan) { const [lat, lng] = pan.dataset.pan.split(',').map(Number); MapX.setCenter({ lat, lng }, 2); return; }
      const caret = t.closest('[data-caret]');
      const card = t.closest('[data-card]'); const wk = t.closest('[data-wk]');
      const kind = card ? 'transit' : wk ? st.mode : null;
      if (!kind) return;
      const idx = +(card ? card.dataset.card : wk.dataset.wk);
      const key = kind === 'transit' ? `t${idx}` : `${kind}${idx}`;
      const changed = st.sel[kind] !== idx;
      if (caret || !changed) st.open = st.open === key ? null : key;
      else st.open = null;
      st.sel[kind] = idx;
      const keep = $('#routeBody').scrollTop;
      render(changed);
      $('#routeBody').scrollTop = keep;
    });

    render();
  }

  return {
    init, setPoint, hasRoute,
    show() { draw(true); },
    hide() { clearLayers(); $('#routeSuggest').hidden = true; },
  };
})();
