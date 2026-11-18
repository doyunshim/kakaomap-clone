/* =====================================================================
 *  지도 어댑터
 *  - 카카오맵 JS SDK 를 우선 사용하고, 키가 없거나 실패하면 Leaflet(OSM)으로 전환
 *  - 앱 코드는 이 파일의 MapX 함수만 사용하므로 지도 종류를 몰라도 됨
 * ===================================================================== */
const MapX = (() => {
  let type = null;   // 'kakao' | 'leaflet'
  let map = null;
  let geocoder = null;
  let places = null;

  const levelToZoom = (lv) => 20 - lv;
  const zoomToLevel = (z) => 20 - z;

  function loadKakao(key) {
    return new Promise((resolve, reject) => {
      if (!key) return reject(new Error('no key'));
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
      const timer = setTimeout(() => reject(new Error('timeout')), 6000);
      s.onload = () => {
        if (!window.kakao || !kakao.maps || !kakao.maps.load) { clearTimeout(timer); return reject(new Error('sdk')); }
        kakao.maps.load(() => { clearTimeout(timer); resolve(); });
      };
      s.onerror = () => { clearTimeout(timer); reject(new Error('load')); };
      document.head.appendChild(s);
    });
  }

  async function init(el, center, level) {
    try {
      await loadKakao(window.KAKAO_JS_KEY);
      type = 'kakao';
      map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(center.lat, center.lng), level });
      geocoder = new kakao.maps.services.Geocoder();
      places = new kakao.maps.services.Places();
    } catch (e) {
      type = 'leaflet';
      // 지도 이동 범위를 한국으로 제한
      map = L.map(el, {
        zoomControl: false, attributionControl: true, minZoom: 7,
        maxBounds: [[32.8, 124.0], [38.9, 132.0]], maxBoundsViscosity: 1.0,
      }).setView([center.lat, center.lng], levelToZoom(level));
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }).addTo(map);
    }
    return type;
  }

  /* ---------- 오버레이(마커) : HTML 요소를 그대로 지도에 올림 ---------- */
  function addOverlay(pos, el, { xAnchor = 0.5, yAnchor = 1, z = 1 } = {}) {
    if (type === 'kakao') {
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(pos.lat, pos.lng), content: el, xAnchor, yAnchor, zIndex: z, clickable: true,
      });
      ov.setMap(map);
      return { remove: () => ov.setMap(null), setZ: (v) => ov.setZIndex(v) };
    }
    const wrap = document.createElement('div');
    wrap.style.transform = `translate(${-xAnchor * 100}%, ${-yAnchor * 100}%)`;
    wrap.style.width = 'max-content';
    wrap.appendChild(el);
    L.DomEvent.disableClickPropagation(wrap);
    const m = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({ html: wrap, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
      zIndexOffset: z * 100, interactive: true, keyboard: false,
    }).addTo(map);
    return { remove: () => m.remove(), setZ: (v) => m.setZIndexOffset(v * 100) };
  }

  /* ---------- 선 ---------- */
  function addLine(path, { color = '#2b6fe9', weight = 7, opacity = 0.95, dashed = false, outline = true } = {}) {
    const parts = [];
    if (type === 'kakao') {
      const p = path.map((c) => new kakao.maps.LatLng(c[0], c[1]));
      if (outline && !dashed) parts.push(new kakao.maps.Polyline({ path: p, strokeWeight: weight + 4, strokeColor: '#ffffff', strokeOpacity: 1 }));
      parts.push(new kakao.maps.Polyline({
        path: p, strokeWeight: weight, strokeColor: color, strokeOpacity: opacity,
        strokeStyle: dashed === 'dash' ? 'shortdash' : dashed ? 'shortdot' : 'solid',
      }));
      parts.forEach((l) => l.setMap(map));
      return { remove: () => parts.forEach((l) => l.setMap(null)) };
    }
    if (outline && !dashed) parts.push(L.polyline(path, { color: '#fff', weight: weight + 4, opacity: 1, interactive: false }));
    parts.push(L.polyline(path, {
      color, weight, opacity, dashArray: dashed === 'dash' ? '6 8' : dashed ? '1 9' : null, lineCap: 'round', lineJoin: 'round', interactive: false,
    }));
    parts.forEach((l) => l.addTo(map));
    return { remove: () => parts.forEach((l) => l.remove()) };
  }

  /* ---------- 시점 ---------- */
  // 왼쪽 패널이 지도를 덮는 폭 → 가운데 맞출 때 그만큼 오른쪽으로 보정
  let inset = 0;
  function setInset(px) { inset = px; }
  function setCenter(pos, level) {
    if (type === 'kakao') {
      if (level) map.setLevel(level);
      const proj = map.getProjection();
      const pt = proj.pointFromCoords(new kakao.maps.LatLng(pos.lat, pos.lng));
      map.panTo(proj.coordsFromPoint(new kakao.maps.Point(pt.x - inset / 2, pt.y)));
    } else {
      const z = level ? levelToZoom(level) : map.getZoom();
      const p = map.project([pos.lat, pos.lng], z).subtract([inset / 2, 0]);
      map.setView(map.unproject(p, z), z, { animate: true });
    }
  }
  function fitPoints(points, pad = 60) {
    if (!points.length) return;
    if (points.length === 1) return setCenter(points[0], 3);
    if (type === 'kakao') {
      const b = new kakao.maps.LatLngBounds();
      points.forEach((p) => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
      map.setBounds(b, pad, pad, pad, pad + inset);
    } else {
      map.fitBounds(points.map((p) => [p.lat, p.lng]), { paddingTopLeft: [pad + inset, pad], paddingBottomRight: [pad, pad], maxZoom: 17 });
    }
  }
  function getCenter() {
    if (type === 'kakao') { const c = map.getCenter(); return { lat: c.getLat(), lng: c.getLng() }; }
    const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
  }
  function getBounds() {
    if (type === 'kakao') {
      const b = map.getBounds(); const sw = b.getSouthWest(); const ne = b.getNorthEast();
      return { sw: { lat: sw.getLat(), lng: sw.getLng() }, ne: { lat: ne.getLat(), lng: ne.getLng() } };
    }
    const b = map.getBounds();
    return { sw: { lat: b.getSouth(), lng: b.getWest() }, ne: { lat: b.getNorth(), lng: b.getEast() } };
  }
  function zoom(d) {
    if (type === 'kakao') map.setLevel(map.getLevel() - d, { animate: true });
    else map.setZoom(map.getZoom() + d);
  }
  function relayout() {
    if (type === 'kakao') map.relayout(); else map.invalidateSize();
  }

  /* ---------- 이벤트 ---------- */
  function on(evt, cb) {
    if (type === 'kakao') {
      const name = { click: 'click', rightclick: 'rightclick', moved: 'dragend', zoomed: 'zoom_changed' }[evt];
      kakao.maps.event.addListener(map, name, (e) => {
        if (e && e.latLng) cb({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, { x: e.point.x, y: e.point.y });
        else cb();
      });
    } else {
      const name = { click: 'click', rightclick: 'contextmenu', moved: 'dragend', zoomed: 'zoomend' }[evt];
      map.on(name, (e) => {
        if (e && e.latlng) cb({ lat: e.latlng.lat, lng: e.latlng.lng }, { x: e.containerPoint.x, y: e.containerPoint.y });
        else cb();
      });
    }
  }

  /* ---------- 서비스 (카카오 전용, 없으면 null) ---------- */
  function reverseGeocode(pos) {
    return new Promise((resolve) => {
      if (type !== 'kakao') return resolve(null);
      geocoder.coord2Address(pos.lng, pos.lat, (res, status) => {
        if (status !== kakao.maps.services.Status.OK || !res[0]) return resolve(null);
        const r = res[0];
        resolve({ road: r.road_address && r.road_address.address_name, jibun: r.address && r.address.address_name,
          building: r.road_address && r.road_address.building_name });
      });
    });
  }
  function keywordSearch(q, { page = 1, size = 15, sort = 'accuracy', center, bounds } = {}) {
    return new Promise((resolve) => {
      if (type !== 'kakao') return resolve(null);
      const S = kakao.maps.services;
      const opt = { page, size };
      if (center) { opt.location = new kakao.maps.LatLng(center.lat, center.lng); }
      if (bounds) {
        opt.bounds = new kakao.maps.LatLngBounds(new kakao.maps.LatLng(bounds.sw.lat, bounds.sw.lng), new kakao.maps.LatLng(bounds.ne.lat, bounds.ne.lng));
      }
      if (sort === 'distance' && center) opt.sort = S.SortBy.DISTANCE;
      places.keywordSearch(q, (data, status, pg) => {
        if (status === S.Status.ZERO_RESULT) return resolve({ list: [], total: 0, pages: 0 });
        if (status !== S.Status.OK) return resolve(null);
        resolve({ total: pg.totalCount, pages: pg.last, list: data.map(kakaoPlace) });
      }, opt);
    });
  }
  const kakaoPlace = (d) => ({
    id: 'k' + d.id, name: d.place_name, cat: d.category_name.split(' > ').pop(), fullCat: d.category_name,
    addr: d.road_address_name || d.address_name, jibun: d.road_address_name ? d.address_name : '',
    tel: d.phone, lat: +d.y, lng: +d.x, url: d.place_url, kakao: true,
  });
  // 카테고리 검색 (음식점 FD6, 카페 CE7 …) — 지도 중심 1km, 가까운 순, 최대 45개
  function categorySearch(code, center) {
    return new Promise((resolve) => {
      if (type !== 'kakao') return resolve(null);
      const S = kakao.maps.services; const out = [];
      const get = (page) => places.categorySearch(code, (data, status, pg) => {
        if (status === S.Status.OK) out.push(...data.map(kakaoPlace));
        if (status === S.Status.OK && pg.hasNextPage && page < 3) get(page + 1); else resolve(out);
      }, { location: new kakao.maps.LatLng(center.lat, center.lng), radius: 1000, sort: S.SortBy.DISTANCE, page });
      get(1);
    });
  }

  return {
    init, setInset, addOverlay, addLine, setCenter, fitPoints, getCenter, getBounds, zoom, relayout, on,
    reverseGeocode, keywordSearch, categorySearch, get type() { return type; },
  };
})();
