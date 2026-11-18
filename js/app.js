/* =====================================================================
 *  앱 공통 : 탭 전환, 토스트, 지도 우클릭 메뉴, 공용 아이콘
 * ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 무시 */ } },
};

const ICON = {
  pin: (color, letter = '') => `<div class="mk-pin"><svg width="32" height="42" viewBox="0 0 32 42"><path d="M16 1.2C7.8 1.2 1.2 7.7 1.2 15.8c0 10.4 13 23.6 14 24.5.5.5 1.2.5 1.6 0 1-.9 14-14.1 14-24.5C30.8 7.7 24.2 1.2 16 1.2z" fill="${color}" stroke="#fff" stroke-width="1.6"/></svg><b>${letter}</b></div>`,
  bookmark: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" fill="none" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  roadview: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="9.5" r="5.8" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="12" cy="9.5" r="2" fill="none" stroke="#333" stroke-width="1.5"/><path d="M8 14.5l-2 5.5h12l-2-5.5" fill="none" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="none" stroke="#999" stroke-width="1.4"/><path d="M8 4.5V8l2.4 1.6" fill="none" stroke="#999" stroke-width="1.4" stroke-linecap="round"/></svg>',
  mapPin: '<svg viewBox="0 0 16 16"><path d="M8 1.5a5 5 0 0 0-5 5c0 3.6 4.4 7.6 4.6 7.8.2.2.6.2.8 0 .2-.2 4.6-4.2 4.6-7.8a5 5 0 0 0-5-5z" fill="#9a9a9a"/><circle cx="8" cy="6.5" r="1.8" fill="#fff"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="#999" stroke-width="1.5"/><path d="M10.4 10.4l3.6 3.6" stroke="#999" stroke-width="1.6" stroke-linecap="round"/></svg>',
  bus: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="10.5" rx="2" fill="#fff"/><rect x="4.3" y="4" width="7.4" height="3.6" rx=".6" fill="var(--c,#33447a)"/><circle cx="5.5" cy="10" r=".9" fill="var(--c,#33447a)"/><circle cx="10.5" cy="10" r=".9" fill="var(--c,#33447a)"/><rect x="4" y="12.3" width="2" height="1.8" rx=".5" fill="#fff"/><rect x="10" y="12.3" width="2" height="1.8" rx=".5" fill="#fff"/></svg>',
  walk: '<svg viewBox="0 0 32 32" width="15" height="15" fill="#fff"><circle cx="17.5" cy="4.6" r="2.9"/><path d="M15.3 9.4c1.6-.7 3.4-.4 4.3 1.2l2.1 4.1 4 1.9c.7.3 1 1.2.6 1.9-.3.6-1.1.9-1.8.6l-4.5-2.2-1.2-2.2-1.4 6 3.4 3.9c.3.3.4.7.4 1.1l.6 6.1c.1.8-.5 1.6-1.4 1.6-.7 0-1.3-.5-1.4-1.3l-.6-5.5-3.6-3.8-1.6 4.6c-.1.3-.3.6-.5.8l-4.5 5c-.5.6-1.4.6-2 .1-.6-.5-.6-1.4-.1-2l4.2-4.7 2.5-10.1-2.1 1-1.5 4.3c-.3.7-1 1.1-1.8.8-.7-.3-1.1-1-.8-1.8l1.8-4.9c.1-.4.4-.7.8-.9z"/></svg>',
};

const PANEL_INSET = 390 + 12; // 패널 너비 + 왼쪽 여백 (지도 위에 떠 있음)

const App = {
  tab: 'search',
  async boot() {
    const type = await MapX.init($('#map'), { lat: 37.5075, lng: 127.1045 }, 4);
    MapX.setInset(PANEL_INSET);
    if (type === 'leaflet') {
      const b = $('#mapBadge');
      b.textContent = window.KAKAO_JS_KEY ? '카카오 키 확인 필요 · 무료 지도로 표시 중' : '무료 지도(OSM) 모드 · config.js에 카카오 키를 넣으면 카카오 지도로 바뀌어요';
      b.hidden = false;
    }

    // 상단 탭
    $$('.gnb button').forEach((b) => b.addEventListener('click', () => { if (!b.hasAttribute('data-todo')) this.showTab(b.dataset.tab); }));
    // 아직 만들지 않은 버튼
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-todo]');
      if (t) { e.preventDefault(); this.toast('이번 과제 범위 밖의 기능이에요 (검색 · 길찾기만 구현)'); }
    });
    // 패널 접기
    $('#panelToggle').addEventListener('click', () => {
      const c = document.body.classList.toggle('collapsed');
      MapX.setInset(c ? 0 : PANEL_INSET);
    });
    // 로고 → 처음 화면 (검색 탭 초기화)
    $('#logoHome').addEventListener('click', () => { this.showTab('search'); Search.reset(); $('#searchBody').scrollTop = 0; });
    $('#zoomIn').addEventListener('click', () => MapX.zoom(1));
    $('#zoomOut').addEventListener('click', () => MapX.zoom(-1));

    // 지도 우클릭 → 출발/도착
    const ctx = $('#ctxMenu');
    let ctxPos = null;
    MapX.on('rightclick', (pos, pt) => {
      ctxPos = pos;
      const mapRect = $('#map').getBoundingClientRect();
      ctx.style.left = `${mapRect.left + pt.x}px`;
      ctx.style.top = `${mapRect.top + pt.y}px`;
      ctx.hidden = false;
    });
    MapX.on('click', () => { ctx.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ctx.hidden = true; });
    $('#map').addEventListener('contextmenu', (e) => e.preventDefault());
    ctx.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ctx]');
      if (!b || !ctxPos) return;
      ctx.hidden = true;
      const point = await this.pointFromMap(ctxPos);
      Dir.setPoint(b.dataset.ctx, point);
      this.showTab('route');
    });

    Search.init();
    Dir.init();
    this.showTab('search');
  },

  async pointFromMap(pos) {
    const geo = await MapX.reverseGeocode(pos);
    if (geo) return { name: geo.building || geo.road || geo.jibun || '지도에서 선택한 위치', lat: pos.lat, lng: pos.lng };
    // 무료 지도 모드 : 가까운 데모 장소 이름 사용
    let best = null; let bd = Infinity;
    PLACES.forEach((p) => { const d = Routes.dist(pos, p); if (d < bd) { bd = d; best = p; } });
    if (best && bd < 60) return { name: fullName(best), lat: pos.lat, lng: pos.lng };
    const osm = await Geo.reverse(pos);
    if (osm) return { name: osm.name, lat: pos.lat, lng: pos.lng };
    return { name: '지도에서 선택한 위치', lat: pos.lat, lng: pos.lng };
  },

  showTab(name) {
    this.tab = name;
    $$('.gnb button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${name}`));
    if (name === 'search') { Dir.hide(); Search.show(); } else { Search.hide(); Dir.show(); }
    this.updateFooter();
  },
  updateFooter() {
    const routeShown = this.tab === 'route' && Dir.hasRoute();
    $('#ftRoute').hidden = !routeShown;
    $('#ftLinks').hidden = routeShown;
  },

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), 2000);
  },
};
