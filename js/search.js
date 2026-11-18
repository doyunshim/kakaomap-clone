/* =====================================================================
 *  검색 : 자동완성 · 최근검색 · 결과목록(탭/정렬/페이지) · 마커 · 말풍선 · 상세
 * ===================================================================== */
const Search = (() => {
  const PAGE = 15;
  const LETTERS = 'ABCDEFGHIJKLMNO';
  const st = {
    q: '', tab: 'all', sort: 'acc', page: 1, bounds: null,
    places: { list: [], total: 0, pages: 0 }, addrs: [], buses: [], stops: [],
    selected: null, markers: [], balloon: null, single: null, suggestIdx: -1, suggestItems: [], openRel: null,
  };
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const hi = (text, q) => {
    const i = norm(text).indexOf(norm(q));
    if (!q || i < 0) return esc(text);
    // 공백 무시 매칭 위치를 원문 위치로 환산
    let n = 0; let start = -1; let end = -1;
    for (let k = 0; k < text.length; k++) {
      if (/\s/.test(text[k])) continue;
      if (n === i) start = k;
      n++;
      if (n === i + norm(q).length) { end = k + 1; break; }
    }
    if (start < 0 || end < 0) return esc(text);
    return `${esc(text.slice(0, start))}<em>${esc(text.slice(start, end))}</em>${esc(text.slice(end))}`;
  };

  /* ---------------- 로컬 검색 ---------------- */
  function scorePlace(p, q) {
    const s = rawScore(p, q);
    return p.cat === '지하철출구' ? s * 0.5 : s; // 출구는 본 장소보다 뒤에
  }
  function rawScore(p, q) {
    const nq = norm(q); const nm = norm(fullName(p)); const bare = norm(p.name);
    if (!nq) return 0;
    if (bare === nq || nm === nq) return 100;
    if (nm.startsWith(nq)) return 85;
    if (nm.includes(nq)) return 70;
    if (nq.includes(bare) && bare.length >= 2) return 55;
    if (norm(p.kw).includes(nq) || norm(p.cat).includes(nq)) return 40;
    if (norm(p.addr).includes(nq) || norm(p.jibun).includes(nq)) return 25;
    return 0;
  }
  function localPlaces(q, { sort, bounds }) {
    let arr = PLACES.map((p) => ({ p, s: scorePlace(p, q) })).filter((x) => x.s > 0);
    if (bounds) arr = arr.filter(({ p }) => p.lat >= bounds.sw.lat && p.lat <= bounds.ne.lat && p.lng >= bounds.sw.lng && p.lng <= bounds.ne.lng);
    arr.sort((a, b) => (sort === 'pop' ? b.p.pop - a.p.pop : b.s - a.s || b.p.pop - a.p.pop));
    return arr.map((x) => x.p);
  }
  function localAddrs(q) {
    const nq = norm(q); if (nq.length < 2) return [];
    const seen = new Map();
    PLACES.forEach((p) => {
      if (p.cat === '지하철출구') return;
      [p.addr, p.jibun && `서울 송파구 ${p.jibun}`].filter(Boolean).forEach((a) => {
        if (norm(a).includes(nq) && !seen.has(a)) seen.set(a, { addr: a, lat: p.lat, lng: p.lng, ref: fullName(p) });
      });
    });
    return [...seen.values()];
  }
  const localBuses = (q) => { const nq = norm(q); return nq ? BUSES.filter((b) => norm(b.no).startsWith(nq) || b.stops.some((s) => norm(s).includes(nq))) : []; };
  const localStops = (q) => { const nq = norm(q); return nq.length >= 2 ? STOPS.filter((s) => norm(s.name).includes(nq) || s.id === q.trim()) : []; };

  // 데모 장소와 같은 곳(이름 겹치고 150m 이내)인 OSM 결과는 빼기
  function merge(local, osm) {
    const dup = (o) => local.some((l) => Routes.dist(l, o) < 150 && (norm(fullName(l)).includes(norm(o.name)) || norm(o.name).includes(norm(l.name))));
    return [...local, ...osm.filter((o) => !dup(o))];
  }
  // 자동완성 · 길찾기 입력에서 쓰는 장소 찾기
  async function findPlaces(q, limit = 8) {
    const kk = await MapX.keywordSearch(q, { size: Math.min(15, limit), center: MapX.getCenter() });
    if (kk) return kk.list;
    const local = localPlaces(q, { sort: 'acc' }).slice(0, 4);
    const osm = await Geo.search(q, { center: MapX.getCenter(), limit: limit + 2 });
    return merge(local, osm).slice(0, limit);
  }

  /* ---------------- 최근 검색 ---------------- */
  const recent = () => store.get('km_recent', []);
  function pushRecent(q) {
    const list = recent().filter((r) => r.q !== q);
    list.unshift({ q, t: Date.now() });
    store.set('km_recent', list.slice(0, 10));
  }

  /* ---------------- 자동완성 ---------------- */
  let sgTimer = null; let sgToken = 0;
  function showSuggest() {
    const q = $('#searchInput').value.trim();
    clearTimeout(sgTimer);
    if (!q) return renderRecent();
    sgTimer = setTimeout(async () => {
      const token = ++sgToken;
      const found = await findPlaces(q, 8);
      if (token !== sgToken) return;
      const items = found.map((p) => ({ kind: 'place', label: fullName(p), sub: `${p.cat} · ${p.addr}`, place: p }));
      localBuses(q).slice(0, 2).forEach((b) => items.push({ kind: 'bus', label: `${b.no}번 버스`, sub: `${b.type} · ${b.route}`, bus: b }));
      localStops(q).slice(0, 2).forEach((s) => items.push({ kind: 'stop', label: s.name, sub: `정류장 ${s.id} · ${s.dir}`, stop: s }));
      st.suggestItems = items; st.suggestIdx = -1;
      const box = $('#searchSuggest');
      box.innerHTML = items.length
        ? items.map((it, i) => `<div class="sg-item" data-i="${i}"><span class="sg-ico">${it.kind === 'place' ? ICON.mapPin : it.kind === 'bus' ? ICON.search : ICON.mapPin}</span>
            <div class="sg-main"><div class="sg-name">${hi(it.label, q)}</div><div class="sg-sub">${esc(it.sub || '')}</div></div></div>`).join('')
          + `<div class="sg-foot"><span>Enter 키로 '${esc(q)}' 전체 검색</span></div>`
        : `<div class="sg-empty">'${esc(q)}' 추천 검색어가 없어요<br>Enter 를 눌러 검색해 보세요</div>`;
      box.hidden = false;
    }, 220);
  }
  function renderRecent() {
    const list = recent();
    const box = $('#searchSuggest');
    st.suggestItems = list.map((r) => ({ kind: 'recent', label: r.q }));
    st.suggestIdx = -1;
    box.innerHTML = `<div class="sg-head"><span>최근 검색</span>${list.length ? '<button data-act="clearall">전체삭제</button>' : ''}</div>`
      + (list.length
        ? list.map((r, i) => `<div class="sg-item" data-i="${i}"><span class="sg-ico">${ICON.clock}</span><div class="sg-main"><div class="sg-name">${esc(r.q)}</div></div>
            <span class="sg-sub">${new Date(r.t).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\s/g, '')}</span><button class="sg-del" data-del="${i}" aria-label="삭제"></button></div>`).join('')
        : '<div class="sg-empty">최근 검색 기록이 없어요</div>');
    box.hidden = false;
  }
  function hideSuggest() { $('#searchSuggest').hidden = true; }
  function pickSuggest(i) {
    const it = st.suggestItems[i];
    if (!it) return;
    hideSuggest();
    if (it.kind === 'recent') { $('#searchInput').value = it.label; return run(it.label); }
    if (it.kind === 'place') {
      $('#searchInput').value = it.label;
      return run(it.label, { focusId: it.place.id, extra: it.place });
    }
    if (it.kind === 'bus') { $('#searchInput').value = it.bus.no; st.tab = 'bus'; return run(it.bus.no, { keepTab: true }); }
    if (it.kind === 'stop') { $('#searchInput').value = it.stop.name; st.tab = 'stop'; return run(it.stop.name, { keepTab: true }); }
  }

  /* ---------------- 검색 실행 ---------------- */
  async function run(q, { focusId, extra, keepTab, bounds, page = 1 } = {}) {
    q = q.trim();
    if (!q) return;
    if (!keepTab && q !== st.q) st.tab = 'all';
    if (q !== st.q) st.sort = 'acc';
    st.q = q; st.page = page; st.bounds = bounds || null; st.openRel = null; st.category = null; editing = null;
    pushRecent(q);
    hideSuggest();
    $('#searchInput').value = q;
    $('#searchClear').hidden = false;
    $('#searchTabs').hidden = false;
    $('#researchBtn').hidden = true;
    closeDetail();
    await fetchPlaces();
    if (extra && !st.places.list.some((p) => p.id === extra.id)) st.places.list.unshift(extra);
    st.addrs = localAddrs(q); st.buses = localBuses(q); st.stops = localStops(q);
    render();
    if (focusId) {
      const p = st.places.list.find((x) => x.id === focusId);
      if (p) select(p, { scroll: true });
    }
  }
  async function fetchPlaces() {
    if (st.category) { // 주변 탐색 결과 (가까운 순)
      let all = st.catList || [];
      if (st.sort === 'pop') all = [...all].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      st.places = { all, total: all.length, pages: Math.ceil(all.length / PAGE), list: all.slice((st.page - 1) * PAGE, st.page * PAGE) };
      return;
    }
    const kk = await MapX.keywordSearch(st.q, {
      page: st.page, size: PAGE, sort: st.sort === 'pop' ? 'distance' : 'accuracy', center: MapX.getCenter(), bounds: st.bounds,
    });
    if (kk) { st.places = kk; return; }
    // 키 없음 : 데모 데이터 + 전국 장소(OpenStreetMap) 합치기
    const ck = `${st.q}|${JSON.stringify(st.bounds)}`;
    if (st.osmKey !== ck) { st.osm = await Geo.search(st.q, { center: MapX.getCenter(), bounds: st.bounds }); st.osmKey = ck; }
    let all = merge(localPlaces(st.q, { sort: st.sort, bounds: st.bounds }), st.osm);
    if (st.sort === 'pop') all = [...all].sort((a, b) => (b.pop || 0) - (a.pop || 0));
    st.places = { all, total: all.length, pages: Math.ceil(all.length / PAGE), list: all.slice((st.page - 1) * PAGE, st.page * PAGE) };
  }

  /* ---------------- 렌더링 ---------------- */
  function setTab(t) {
    st.tab = t;
    $$('#searchTabs [data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === t));
    render();
  }
  function render(opts = {}) {
    $$('#searchTabs [data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === st.tab));
    const body = $('#searchBody');
    const { tab } = st;
    let html = '';
    if (tab === 'all') {
      html += st.category ? `<div class="res-info">지도 중심 주변 <em>${esc(st.q)}</em> 검색결과</div>` : `<div class="res-info">장소명 <em>${esc(st.q)}</em> 검색결과${st.bounds ? '<small>현재 지도 영역에서 다시 검색한 결과예요</small>' : ''}</div>`;
      if (!st.places.total && !st.addrs.length && !st.buses.length && !st.stops.length) html += noRes();
      if (st.places.total) html += placeSection();
      if (st.addrs.length) html += miniSection('주소', st.addrs.slice(0, 3), addrRow, 'addr', st.addrs.length);
      if (st.buses.length) html += miniSection('버스', st.buses.slice(0, 3), busRow, 'bus', st.buses.length);
      if (st.stops.length) html += miniSection('정류장', st.stops.slice(0, 3), stopRow, 'stop', st.stops.length);
    } else if (tab === 'place') {
      html = st.places.total ? placeSection() : noRes();
    } else if (tab === 'addr') {
      html = st.addrs.length ? `<div class="sec-head"><h4>주소 <span>${st.addrs.length}</span></h4></div>${st.addrs.map(addrRow).join('')}` : noRes();
    } else if (tab === 'bus') {
      html = st.buses.length ? `<div class="sec-head"><h4>버스 <span>${st.buses.length}</span></h4></div>${st.buses.map(busRow).join('')}` : noRes();
    } else if (tab === 'stop') {
      html = st.stops.length ? `<div class="sec-head"><h4>정류장 <span>${st.stops.length}</span></h4></div>${st.stops.map(stopRow).join('')}` : noRes();
    }
    body.innerHTML = html;
    if (opts.fit !== false) body.scrollTop = 0;
    drawMarkers(opts);
  }
  const noRes = () => `<div class="no-res"><b>'${esc(st.q)}'</b>에 대한 검색결과가 없습니다.<br>
    · 단어의 철자가 정확한지 확인해 보세요.<br>· 띄어쓰기를 다르게 해 보세요.<br>· 데모 데이터는 석촌역·잠실 주변만 있어요.</div>`;
  function placeSection() {
    const sortHtml = MapX.type === 'kakao'
      ? `<button data-sort="acc" class="${st.sort === 'acc' ? 'on' : ''}">정확도순</button><i>|</i><button data-sort="pop" class="${st.sort === 'pop' ? 'on' : ''}">거리순</button>`
      : `<button data-sort="acc" class="${st.sort === 'acc' ? 'on' : ''}">정확도순</button><i>|</i><button data-sort="pop" class="${st.sort === 'pop' ? 'on' : ''}">인기도순</button>`;
    let h = `<div class="sec-head"><h4>장소 <span>${st.places.total}</span></h4><div class="sort">${sortHtml}</div></div>`;
    h += st.places.list.map((p, i) => placeRow(p, i)).join('');
    if (st.places.pages > 1) {
      h += '<div class="paging">';
      for (let n = 1; n <= Math.min(st.places.pages, 5); n++) h += `<button data-page="${n}" class="${n === st.page ? 'on' : ''}">${n}</button>`;
      h += '</div>';
    }
    return h;
  }
  // 즐겨찾기 : 장소 정보를 통째로 저장 (예전 형식인 id 문자열은 무시)
  const savedList = () => store.get('km_saved', []).filter((x) => x && typeof x === 'object');
  const isSavedId = (id) => savedList().some((x) => x.id === id);
  function placeRow(p, i) {
    const name = p.sub ? `${esc(p.name)} <small>${esc(p.sub)}</small>` : esc(p.name);
    const isSaved = isSavedId(p.id);
    const rel = p.rel && p.rel.length
      ? `<div><button class="pl-rel ${st.openRel === p.id ? 'open' : ''}" data-rel="${p.id}">관련장소 <b>${p.rel.length}</b></button></div>
         ${st.openRel === p.id ? `<div class="rel-list">${p.rel.map((r) => `<button data-relgo="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}`
      : '';
    return `<div class="pl-item ${st.selected && st.selected.id === p.id ? 'on' : ''}" data-pid="${p.id}">
      <div class="pl-title"><span class="pl-mark">${LETTERS[i] || ''}</span><span class="pl-name">${name}</span><span class="pl-cat">${esc(p.cat)}</span></div>
      <div class="pl-addr">${esc(p.addr)}</div>
      ${p.jibun ? `<div class="pl-jibun">(지번) ${esc(p.jibun)}</div>` : ''}
      <div class="pl-meta">${p.tel ? `<span class="pl-tel">${esc(p.tel)}</span><span class="bar">·</span>` : ''}<a class="pl-link" data-detail="${p.id}">상세보기</a></div>
      ${rel}
      <div class="pl-btns"><button class="sq-btn ${isSaved ? 'saved' : ''}" data-save="${p.id}" aria-label="저장">${ICON.bookmark}</button><button class="sq-btn" data-todo aria-label="로드뷰">${ICON.roadview}</button></div>
    </div>`;
  }
  function miniSection(title, rows, fn, tab, total) {
    return `<div class="sec-head"><h4>${title} <span>${total}</span></h4></div>${rows.map(fn).join('')}
      ${total > 3 ? `<button class="more-row" data-gotab="${tab}">${title} 더보기 ›</button>` : '<div style="border-bottom:9px solid #f4f4f4"></div>'}`;
  }
  const addrRow = (a) => `<div class="mini-item" data-addr="${esc(a.addr)}"><div class="t">${hi(a.addr, st.q)}</div><div class="s">${esc(a.ref)} 위치</div></div>`;
  const busTag = (type) => `<span class="tag" style="background:${BUS_TYPE[type] || '#888'}">${type}</span>`;
  const busRow = (b) => `<div class="mini-item" data-bus="${esc(b.no)}"><div class="t">${busTag(b.type)}${esc(b.no)}</div><div class="s">${esc(b.area)} ${esc(b.type)}버스 · ${esc(b.route)}</div></div>`;
  const stopRow = (s) => `<div class="mini-item" data-stop="${s.id}"><div class="t">${esc(s.name)} <span style="font-weight:400;font-size:13px;color:#999">${s.id}</span></div>
    <div class="s">${esc(s.dir)} · ${s.lines.map(esc).join(', ')}</div></div>`;

  /* ---------------- 지도 마커 ---------------- */
  function clearMarkers() {
    st.markers.forEach((m) => m.ov.remove()); st.markers = [];
    if (st.balloon) { st.balloon.remove(); st.balloon = null; }
    if (st.single) { st.single.remove(); st.single = null; }
  }
  function drawMarkers({ fit = true } = {}) {
    clearMarkers();
    if (App.tab !== 'search' || !st.q) return;
    const list = (st.tab === 'all' || st.tab === 'place') ? st.places.list : [];
    list.forEach((p, i) => {
      const node = el(ICON.pin('#2f6ff0', LETTERS[i] || ''));
      node.addEventListener('click', (e) => { e.stopPropagation(); select(p, { scroll: true, pan: false }); });
      node.addEventListener('mouseenter', () => node.classList.add('on'));
      node.addEventListener('mouseleave', () => { if (!st.selected || st.selected.id !== p.id) node.classList.remove('on'); });
      st.markers.push({ id: p.id, node, ov: MapX.addOverlay(p, node, { z: 10 - i * 0.01 }) });
    });
    if (st.selected) {
      const m = st.markers.find((x) => x.id === st.selected.id);
      if (m) { m.node.classList.add('on'); showBalloon(st.selected); }
    }
    if (fit && list.length && !st.bounds) MapX.fitPoints(list, 70);
  }
  function showBalloon(p) {
    if (st.balloon) st.balloon.remove();
    const node = el(`<div style="padding-bottom:50px"><div class="balloon"><span class="bl-name">${esc(fullName(p))}</span>
      <button class="bl-s">출발</button><button class="bl-e">도착</button><button class="bl-x" aria-label="닫기">×</button></div></div>`);
    $('.bl-name', node).addEventListener('click', () => openDetail(p));
    $('.bl-s', node).addEventListener('click', () => toRoute('start', p));
    $('.bl-e', node).addEventListener('click', () => toRoute('end', p));
    $('.bl-x', node).addEventListener('click', () => { st.balloon.remove(); st.balloon = null; });
    st.balloon = MapX.addOverlay(p, node, { z: 50 });
  }
  function toRoute(which, p) {
    Dir.setPoint(which, { name: fullName(p), lat: p.lat, lng: p.lng });
    App.showTab('route');
  }
  function select(p, { scroll = false, pan = true } = {}) {
    st.selected = p;
    $$('#searchBody .pl-item').forEach((n) => n.classList.toggle('on', n.dataset.pid === p.id));
    st.markers.forEach((m) => m.node.classList.toggle('on', m.id === p.id));
    st.markers.forEach((m) => m.ov.setZ(m.id === p.id ? 40 : 10));
    if (pan) MapX.setCenter(p, 3);
    showBalloon(p);
    if (scroll) { const n = $(`#searchBody .pl-item[data-pid="${p.id}"]`); if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  // 목록에 없는 장소(관련장소, 주소, 정류장) 하나만 표시
  function showSingle(p) {
    if (st.single) st.single.remove();
    const node = el(ICON.pin('#e8382f', ''));
    st.single = MapX.addOverlay(p, node, { z: 45 });
    st.selected = null;
    $$('#searchBody .pl-item').forEach((n) => n.classList.remove('on'));
    MapX.setCenter(p, 3);
    showBalloon(p);
  }

  /* ---------------- 상세 ---------------- */
  function openDetail(p) {
    const box = $('#placeDetail');
    const rows = [];
    rows.push(`<div class="dt-row"><i>주소</i><div>${esc(p.addr)}${p.jibun ? `<div class="sub">(지번) ${esc(p.jibun)}</div>` : ''}</div></div>`);
    if (p.tel) rows.push(`<div class="dt-row"><i>전화</i><div style="color:var(--green)">${esc(p.tel)}</div></div>`);
    rows.push(`<div class="dt-row"><i>분류</i><div>${esc(p.fullCat || p.cat)}</div></div>`);
    if (p.url) rows.push(`<div class="dt-row"><i>더보기</i><div><a href="${esc(p.url)}" target="_blank" rel="noopener">카카오맵 장소 페이지에서 보기 ›</a></div></div>`);
    if (p.rel && p.rel.length) rows.push(`<div class="dt-row"><i>관련장소</i><div class="dt-rel">${p.rel.map((r) => `<button data-relgo="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>`);
    const isSaved = isSavedId(p.id);
    box.innerHTML = `<div class="dt-top"><button class="dt-back" aria-label="뒤로"></button><span>${esc(st.q || '장소')} 검색결과</span></div>
      <div class="scroll">
        <div class="dt-hero"><svg width="120" height="110" viewBox="0 0 64 64"><path d="M32 4C20.4 4 11 13.2 11 24.6 11 39.4 29.4 58 30.6 59.2c.8.8 2 .8 2.8 0C34.6 58 53 39.4 53 24.6 53 13.2 43.6 4 32 4z" fill="#2f6ff0"/><circle cx="32" cy="24" r="8" fill="#fff"/></svg></div>
        <div class="dt-head">
          <div class="dt-name">${esc(fullName(p))}</div>
          <div class="dt-cat">${esc(p.cat)}</div>
          <div class="dt-actions">
            <button data-dt="start"><span class="ic" style="background:var(--blue)">출</span>출발</button>
            <button data-dt="end"><span class="ic" style="background:var(--red)">도</span>도착</button>
            <button data-dt="save"><span class="ic" style="background:${isSaved ? 'var(--blue)' : '#bbb'}">★</span>${isSaved ? '저장됨' : '저장'}</button>
            <button data-todo><span class="ic" style="background:#555">⇪</span>공유</button>
          </div>
        </div>
        <div class="dt-rows">${rows.join('')}</div>
      </div>`;
    box.hidden = false;
    $('.dt-back', box).addEventListener('click', closeDetail);
    box.querySelector('[data-dt="start"]').addEventListener('click', () => toRoute('start', p));
    box.querySelector('[data-dt="end"]').addEventListener('click', () => toRoute('end', p));
    box.querySelector('[data-dt="save"]').addEventListener('click', () => { toggleSave(p); openDetail(p); });
    $$('[data-relgo]', box).forEach((b) => b.addEventListener('click', () => goRel(b.dataset.relgo)));
    if (st.markers.some((m) => m.id === p.id)) select(p); else showSingle(p);
  }
  function closeDetail() { $('#placeDetail').hidden = true; }
  function toggleSave(p) {
    const s = savedList(); const i = s.findIndex((x) => x.id === p.id);
    if (i >= 0) { s.splice(i, 1); App.toast('즐겨찾기를 해제했어요'); } else { s.push(slim(p)); App.toast('즐겨찾기에 추가했어요'); }
    store.set('km_saved', s);
  }
  function goRel(name) {
    const p = PLACES.find((x) => x.name === name || fullName(x) === name);
    if (p) showSingle(p);
  }

  /* ---------------- 이벤트 ---------------- */
  function init() {
    const inp = $('#searchInput');
    inp.addEventListener('focus', showSuggest);
    inp.addEventListener('input', () => { $('#searchClear').hidden = !inp.value; showSuggest(); });
    inp.addEventListener('keydown', (e) => {
      const items = $$('#searchSuggest .sg-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        st.suggestIdx = (st.suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((n, i) => n.classList.toggle('on', i === st.suggestIdx));
        const it = st.suggestItems[st.suggestIdx]; if (it) inp.value = it.label;
      } else if (e.key === 'Escape') { hideSuggest(); }
    });
    $('#searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (st.suggestIdx >= 0 && !$('#searchSuggest').hidden) return pickSuggest(st.suggestIdx);
      run(inp.value);
      inp.blur();
    });
    $('#searchClear').addEventListener('click', () => { inp.value = ''; $('#searchClear').hidden = true; inp.focus(); });
    $('#searchSuggest').addEventListener('mousedown', (e) => e.preventDefault()); // 입력창 포커스 유지
    $('#searchSuggest').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="clearall"]')) { store.set('km_recent', []); return renderRecent(); }
      const del = e.target.closest('[data-del]');
      if (del) { const l = recent(); l.splice(+del.dataset.del, 1); store.set('km_recent', l); return renderRecent(); }
      const it = e.target.closest('.sg-item');
      if (it) pickSuggest(+it.dataset.i);
    });
    inp.addEventListener('blur', () => setTimeout(hideSuggest, 120));
    $$('#searchTabs [data-st]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.st)));
    $('#searchClose').addEventListener('click', reset);

    $('#searchBody').addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-todo]')) return;
      if (!st.q) return onHomeClick(e); // 초기 화면
      const sortB = t.closest('[data-sort]');
      if (sortB) { st.sort = sortB.dataset.sort; st.page = 1; await fetchPlaces(); return render(); }
      const pg = t.closest('[data-page]');
      if (pg) { st.page = +pg.dataset.page; await fetchPlaces(); return render(); }
      const go = t.closest('[data-gotab]'); if (go) return setTab(go.dataset.gotab);
      const sv = t.closest('[data-save]');
      if (sv) { const p = st.places.list.find((x) => x.id === sv.dataset.save); if (p) { toggleSave(p); sv.classList.toggle('saved'); } return; }
      const dt = t.closest('[data-detail]');
      if (dt) { const p = st.places.list.find((x) => x.id === dt.dataset.detail); if (p) openDetail(p); return; }
      const rel = t.closest('[data-rel]');
      if (rel) { st.openRel = st.openRel === rel.dataset.rel ? null : rel.dataset.rel; const keep = $('#searchBody').scrollTop; render({ fit: false }); $('#searchBody').scrollTop = keep; return; }
      const rg = t.closest('[data-relgo]'); if (rg) return goRel(rg.dataset.relgo);
      const ad = t.closest('[data-addr]');
      if (ad) { const a = st.addrs.find((x) => x.addr === ad.dataset.addr); return showSingle({ id: 'addr', name: a.addr, cat: '주소', addr: a.addr, lat: a.lat, lng: a.lng }); }
      const sp = t.closest('[data-stop]');
      if (sp) { const s = STOPS.find((x) => x.id === sp.dataset.stop); return showSingle({ id: s.id, name: s.name, cat: `정류장 ${s.id}`, addr: s.dir, lat: s.lat, lng: s.lng }); }
      const bs = t.closest('[data-bus]');
      if (bs) {
        const b = BUSES.find((x) => x.no === bs.dataset.bus);
        const pts = STOPS.filter((s) => s.lines.includes(b.no));
        clearMarkers();
        pts.forEach((s) => { const node = el(ICON.pin(BUS_TYPE[b.type], '')); st.markers.push({ id: s.id, node, ov: MapX.addOverlay(s, node, { z: 10 }) }); });
        if (pts.length) MapX.fitPoints(pts, 90);
        return App.toast(`${b.no}번 버스가 서는 정류장을 표시했어요`);
      }
      const item = t.closest('.pl-item');
      if (item) { const p = st.places.list.find((x) => x.id === item.dataset.pid); if (p) select(p); }
    });
    $('#searchBody').addEventListener('mouseover', (e) => {
      const item = e.target.closest('.pl-item');
      st.markers.forEach((m) => m.node.classList.toggle('on', (item && m.id === item.dataset.pid) || (st.selected && st.selected.id === m.id)));
    });

    // 이 지역 재검색
    const onMove = () => { if (App.tab === 'search' && st.q && (st.tab === 'all' || st.tab === 'place')) $('#researchBtn').hidden = false; };
    MapX.on('moved', onMove);
    $('#researchBtn').addEventListener('click', () => (st.category ? runCategory(st.category) : run(st.q, { keepTab: true, bounds: MapX.getBounds() })));

    renderHome();
  }
  /* ---------------- 초기 화면 : 주변 탐색 · 내 장소 · 즐겨찾기 ---------------- */
  const CATS = [
    { key: 'food', label: '음식점', kakao: 'FD6', osm: ['amenity=restaurant', 'amenity=fast_food'],
      icon: '<svg viewBox="0 0 24 24"><path d="M7 3v7.5a2 2 0 0 0 1.2 1.8V21h1.6v-8.7A2 2 0 0 0 11 10.5V3H9.9v6.3h-.8V3H8.1v6.3h-.8V3zM15.5 3c-1.4 0-2.5 2.2-2.5 5.3 0 2 .8 3.3 1.8 3.8V21h1.6V3z" fill="#333"/></svg>' },
    { key: 'cafe', label: '카페', kakao: 'CE7', osm: ['amenity=cafe'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 7h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h1.5a2.5 2.5 0 0 1 0 5H16" fill="#333" stroke="#333" stroke-width="1.6"/></svg>' },
    { key: 'bus', label: '버스', osm: ['highway=bus_stop'],
      icon: '<svg viewBox="0 0 24 24"><path d="M6 3h12a2 2 0 0 1 2 2v13H4V5a2 2 0 0 1 2-2zM5 18h3v2.2a.8.8 0 0 1-.8.8H5.8a.8.8 0 0 1-.8-.8zm11 0h3v2.2a.8.8 0 0 1-.8.8h-1.4a.8.8 0 0 1-.8-.8z" fill="#333"/><rect x="6" y="6" width="12" height="6" rx=".6" fill="#fff"/><circle cx="7.6" cy="15" r="1.1" fill="#fff"/><circle cx="16.4" cy="15" r="1.1" fill="#fff"/></svg>' },
    { key: 'subway', label: '지하철', kakao: 'SW8', osm: ['railway=station', 'station=subway'],
      icon: '<svg viewBox="0 0 24 24"><path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#333"/><rect x="6.3" y="6" width="11.4" height="5" rx=".6" fill="#fff"/><circle cx="8.3" cy="14.6" r="1.2" fill="#fff"/><circle cx="15.7" cy="14.6" r="1.2" fill="#fff"/><path d="M7.5 18l-2 3.5M16.5 18l2 3.5" stroke="#333" stroke-width="1.8"/></svg>' },
    { key: 'hotel', label: '숙박', kakao: 'AD5', osm: ['tourism=hotel', 'tourism=motel', 'tourism=guest_house'],
      icon: '<svg viewBox="0 0 24 24"><path d="M3 5v15M3 16h18v4M21 16v-3a3 3 0 0 0-3-3h-7v6" fill="none" stroke="#333" stroke-width="2"/><circle cx="7" cy="11.5" r="2.2" fill="#333"/></svg>' },
    { key: 'bank', label: '은행', kakao: 'BK9', osm: ['amenity=bank'],
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="#333"/><path d="M6.5 8l2.2 8 2-6 2 0 .1 0 2 6 2.2-8M6 11.5h12" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
    { key: 'conv', label: '편의점', kakao: 'CS2', osm: ['shop=convenience'],
      icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="#333"/><path d="M8 3.5v3M16 3.5v3" stroke="#333" stroke-width="1.8"/><text x="12" y="16.3" font-family="Arial" font-size="8" font-weight="700" fill="#fff" text-anchor="middle">24</text></svg>' },
  ];
  const MP_ICON = {
    home: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#c3c6cc"/><path d="M5.5 10L10 6l4.5 4v4.5h-3v-3h-3v3h-3z" fill="#fff"/></svg>',
    work: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#c3c6cc"/><path d="M6.5 6h7v8.5h-2.3v-2.3H8.8v2.3H6.5z" fill="#fff"/><path d="M8.3 8h1.2M10.5 8h1.2M8.3 10h1.2M10.5 10h1.2" stroke="#c3c6cc" stroke-width=".9"/></svg>',
    fav: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#c3c6cc"/><path d="M7 5.5v9.5" stroke="#fff" stroke-width="1.4"/><path d="M7.6 5.8h6.4l-1.6 2.2 1.6 2.3H7.6z" fill="#fff"/></svg>',
  };
  const myPlaces = () => { const m = store.get('km_myplaces', {}); return { home: m.home || null, work: m.work || null, fav: Array.isArray(m.fav) ? m.fav : [] }; };
  const slim = (p) => ({ id: p.id, name: fullName(p), cat: p.cat, addr: p.addr, lat: p.lat, lng: p.lng });
  let editing = null; // 'home' | 'work' | 'fav'

  function mpRow(kind, p, i) {
    const empty = { home: '집 주소를 등록하세요.', work: '회사/학교 주소를 등록하세요.', fav: '자주 가는 장소 주소를 등록하세요. <small>(최대 5개)</small>' }[kind];
    if (editing === kind && !p) {
      return `<div class="mp-row editing">${MP_ICON[kind]}<div class="mp-edit"><input id="mpInput" type="text" placeholder="장소, 주소 검색" autocomplete="off">
        <button class="mp-cancel" data-mp-cancel aria-label="취소"></button><div id="mpSuggest" class="mp-sg" hidden></div></div></div>`;
    }
    if (!p) return `<button class="mp-row" data-mp-add="${kind}">${MP_ICON[kind]}<span class="mp-empty">${empty}</span></button>`;
    const label = { home: '집', work: '회사/학교', fav: '' }[kind];
    return `<div class="mp-row set" data-mp-go="${kind}" data-mp-i="${i ?? ''}">${MP_ICON[kind]}
      <div class="mp-txt"><b>${label ? `${label} · ` : ''}${esc(p.name)}</b><span>${esc(p.addr)}</span></div>
      <button class="mp-del" data-mp-del="${kind}" data-mp-i="${i ?? ''}" aria-label="삭제"></button></div>`;
  }
  function renderHome() {
    const m = myPlaces();
    const favRows = m.fav.map((p, i) => mpRow('fav', p, i)).join('') + (m.fav.length < 5 ? mpRow('fav', null) : '');
    const saved = savedList();
    $('#searchBody').innerHTML = `<div class="home">
      <section class="hm-sec"><h4>주변 탐색</h4>
        <div class="nearby">${CATS.map((c) => `<button data-cat="${c.key}"><span class="nb-ic">${c.icon}</span>${c.label}</button>`).join('')}</div></section>
      <section class="hm-sec"><h4><button class="hm-more" data-todo>내 장소</button></h4>
        <div class="mp-list">${mpRow('home', m.home)}${mpRow('work', m.work)}${favRows}</div></section>
      <section class="hm-sec"><h4><button class="hm-more" data-todo>즐겨찾기</button></h4>
        ${saved.length ? `<div class="mp-list">${saved.map((p) => `<div class="mp-row set" data-saved="${esc(p.id)}">${ICON.bookmark.replace('width="22" height="22"', 'width="20" height="20"')}
            <div class="mp-txt"><b>${esc(p.name)}</b><span>${esc(p.addr)}</span></div></div>`).join('')}</div>`
          : '<p class="hm-desc">저장한 즐겨찾기에 대해 \'홈 목록 추가\'한 장소가 나옵니다.<br>자주 쓰는 즐겨찾기를 더 빠르게 사용해 보세요.</p>'}</section>
    </div>
    <div class="notice"><span class="nt-tag">공지</span><span class="nt-txt">짭카오맵 검색 · 길찾기 서비스가 열렸어요.</span><button data-todo>더보기</button></div>`;
    const inp = $('#mpInput');
    if (inp) {
      inp.focus();
      let tm = null;
      inp.addEventListener('input', () => {
        clearTimeout(tm);
        const q = inp.value.trim();
        const box = $('#mpSuggest');
        if (!q) { box.hidden = true; return; }
        tm = setTimeout(async () => {
          const list = await findPlaces(q, 6);
          if (inp.value.trim() !== q) return;
          st.mpItems = list;
          box.innerHTML = list.length ? list.map((p, i) => `<div class="sg-item" data-mp-pick="${i}"><span class="sg-ico">${ICON.mapPin}</span>
            <div class="sg-main"><div class="sg-name">${esc(fullName(p))}</div><div class="sg-sub">${esc(p.addr)}</div></div></div>`).join('')
            : `<div class="sg-empty">'${esc(q)}' 검색결과가 없어요</div>`;
          box.hidden = false;
        }, 220);
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { editing = null; renderHome(); }
        if (e.key === 'Enter' && st.mpItems && st.mpItems.length) pickMyPlace(st.mpItems[0]);
      });
    }
  }
  function pickMyPlace(p) {
    const m = myPlaces();
    if (editing === 'fav') m.fav.push(slim(p)); else m[editing] = slim(p);
    store.set('km_myplaces', m);
    App.toast('내 장소에 등록했어요');
    editing = null; st.mpItems = null;
    renderHome();
  }
  function onHomeClick(e) {
    const t = e.target;
    const cat = t.closest('[data-cat]'); if (cat) return runCategory(CATS.find((c) => c.key === cat.dataset.cat));
    const add = t.closest('[data-mp-add]'); if (add) { editing = add.dataset.mpAdd; return renderHome(); }
    if (t.closest('[data-mp-cancel]')) { editing = null; return renderHome(); }
    const pick = t.closest('[data-mp-pick]'); if (pick) return pickMyPlace(st.mpItems[+pick.dataset.mpPick]);
    const del = t.closest('[data-mp-del]');
    if (del) {
      const m = myPlaces(); const k = del.dataset.mpDel;
      if (k === 'fav') m.fav.splice(+del.dataset.mpI, 1); else m[k] = null;
      store.set('km_myplaces', m); return renderHome();
    }
    const go = t.closest('[data-mp-go]');
    if (go) { const m = myPlaces(); const k = go.dataset.mpGo; return showSingle(k === 'fav' ? m.fav[+go.dataset.mpI] : m[k]); }
    const sv = t.closest('[data-saved]');
    if (sv) { const p = savedList().find((x) => x.id === sv.dataset.saved); if (p) showSingle(p); }
  }

  /* ---------------- 주변 탐색 (카테고리) ---------------- */
  async function runCategory(c) {
    if (!c) return;
    st.q = c.label; st.category = c; st.tab = 'all'; st.sort = 'acc'; st.page = 1; st.bounds = null; st.openRel = null; st.selected = null;
    $('#searchInput').value = c.label; $('#searchClear').hidden = false; $('#searchTabs').hidden = false; $('#researchBtn').hidden = true;
    closeDetail(); hideSuggest();
    $('#searchBody').innerHTML = '<div class="loading"><div class="spinner"></div>주변 장소를 찾고 있어요</div>';
    const center = MapX.getCenter();
    let list = c.kakao ? await MapX.categorySearch(c.kakao, center) : null;
    if (!list) list = await Geo.nearby(c.osm, center, c.label);
    if (st.category !== c) return;
    if (!list) {
      // 주변 탐색 서버가 모두 바쁠 때 : 이름에 분류가 들어간 장소로 대신 보여주기
      list = await findPlaces(c.label, 30);
      if (st.category !== c) return;
      App.toast('주변 장소 서버가 바빠서 이름 검색 결과로 보여드려요. 잠시 후 다시 눌러 보세요');
    }
    st.catList = list;
    await fetchPlaces();
    st.addrs = []; st.buses = []; st.stops = [];
    render();
  }

  function reset() {
    editing = null; st.category = null;
    st.q = ''; st.selected = null; st.bounds = null;
    $('#searchInput').value = ''; $('#searchClear').hidden = true; $('#searchTabs').hidden = true; $('#researchBtn').hidden = true;
    closeDetail(); clearMarkers(); renderHome();
  }

  return {
    init,
    show() { if (st.q) drawMarkers({ fit: false }); },
    hide() { clearMarkers(); $('#researchBtn').hidden = true; hideSuggest(); },
    run,
    findPlaces,
    reset,
  };
})();
