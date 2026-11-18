/* =====================================================================
 *  무료 외부 API (키 필요 없음)
 *  - 장소 검색 / 주소 변환 : Photon (OpenStreetMap 데이터)  https://photon.komoot.io
 *  - 실제 도로 경로       : OSRM (routing.openstreetmap.de) – 자동차 / 도보 / 자전거
 * ===================================================================== */
const Geo = (() => {
  const KOREA_BBOX = '124.5,33,131.9,38.7';
  const CAT = {
    university: '대학교', college: '대학', school: '학교', kindergarten: '유치원', hospital: '병원', clinic: '의원', doctors: '의원',
    dentist: '치과', pharmacy: '약국', cafe: '카페', restaurant: '음식점', fast_food: '패스트푸드', bar: '술집', pub: '술집',
    bank: '은행', atm: 'ATM', bus_stop: '버스정류장', platform: '정류장', station: '역', subway_entrance: '지하철출구',
    parking: '주차장', fuel: '주유소', park: '공원', department_store: '백화점', mall: '쇼핑몰', supermarket: '마트',
    convenience: '편의점', hotel: '호텔', motel: '모텔', museum: '박물관', library: '도서관', townhall: '관공서',
    police: '경찰서', fire_station: '소방서', post_office: '우체국', place_of_worship: '종교시설', attraction: '관광명소',
    theme_park: '테마파크', stadium: '경기장', cinema: '영화관', theatre: '공연장', apartments: '아파트', residential: '주거지',
    city: '도시', town: '지역', village: '마을', suburb: '동네', neighbourhood: '동네', quarter: '지역', office: '사무실',
    primary: '도로', secondary: '도로', tertiary: '도로', trunk: '도로', motorway: '고속도로', river: '하천', peak: '산',
  };
  const fetchJson = async (url, ms = 8000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } finally { clearTimeout(t); }
  };

  function toPlace(f) {
    const p = f.properties; const [lng, lat] = f.geometry.coordinates;
    const road = [p.state, p.city, p.county, p.street, p.housenumber].filter(Boolean).join(' ');
    const area = [p.state, p.city, p.county, p.district || p.locality].filter(Boolean).join(' ');
    return {
      id: `o${p.osm_type}${p.osm_id}`, name: p.name || p.street || area, cat: CAT[p.osm_value] || CAT[p.osm_key] || '장소',
      addr: road || area || '주소 정보 없음', jibun: road && area !== road ? area : '', lat, lng, osm: true,
    };
  }
  async function search(q, { center, limit = 40, bounds } = {}) {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}`;
    url += bounds ? `&bbox=${bounds.sw.lng},${bounds.sw.lat},${bounds.ne.lng},${bounds.ne.lat}` : `&bbox=${KOREA_BBOX}`;
    if (center) url += `&lat=${center.lat.toFixed(5)}&lon=${center.lng.toFixed(5)}`;
    const j = await fetchJson(url);
    if (!j) return [];
    // 한국 안의 장소만
    return j.features.filter((f) => f.properties.name && f.properties.countrycode === 'KR').map(toPlace);
  }
  async function reverse(pos) {
    const j = await fetchJson(`https://photon.komoot.io/reverse?lat=${pos.lat}&lon=${pos.lng}&limit=1`);
    if (!j || !j.features.length) return null;
    const p = toPlace(j.features[0]);
    return { name: j.features[0].properties.name || p.addr, addr: p.addr };
  }

  /* ---------- 주변 탐색 : 지도 중심 반경 약 1km 안의 음식점·카페 등 (Overpass) ---------- */
  async function nearby(filters, center, label) {
    const dLat = 0.009; const dLng = 0.0115;
    const bbox = `${center.lat - dLat},${center.lng - dLng},${center.lat + dLat},${center.lng + dLng}`;
    const q = `[out:json][timeout:20];(${filters.map((f) => { const [k, v] = f.split('='); return `nwr["${k}"="${v}"]["name"](${bbox});`; }).join('')});out center 120;`;
    // 무료 서버라 자주 바쁨 → 여러 서버를 차례로 시도
    const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    let j = null;
    for (const url of servers) {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: ctl.signal });
        if (r.ok) j = await r.json();
      } catch (e) { j = null; } finally { clearTimeout(tm); }
      if (j) break;
    }
    if (!j) return null; // 모든 서버 실패
    const d2 = (p) => (p.lat - center.lat) ** 2 + ((p.lng - center.lng) * 0.79) ** 2;
    return j.elements.map((e) => {
      const t = e.tags || {};
      const lat = e.lat ?? (e.center && e.center.lat); const lng = e.lon ?? (e.center && e.center.lon);
      const road = [t['addr:city'], t['addr:district'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
      return { id: `n${e.type}${e.id}`, name: t.name, cat: t.cuisine && label === '음식점' ? `음식점 · ${t.cuisine}` : label,
        addr: road || t['addr:full'] || '주소 정보 없음', jibun: '', tel: t.phone || t['contact:phone'] || '', lat, lng, osm: true };
    }).filter((p) => p.lat && p.name).sort((a, b) => d2(a) - d2(b)).slice(0, 45);
  }

  /* ---------- 실제 도로 경로 ---------- */
  const PROFILE = { car: 'routed-car/route/v1/driving', foot: 'routed-foot/route/v1/foot', bike: 'routed-bike/route/v1/bike' };
  const cache = new Map();
  async function route(kind, pts, { alternatives = false } = {}) {
    const coords = pts.map((p) => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
    const key = `${kind}|${coords}|${alternatives}`;
    if (cache.has(key)) return cache.get(key);
    const url = `https://routing.openstreetmap.de/${PROFILE[kind]}/${coords}?overview=full&geometries=geojson&steps=true${alternatives ? '&alternatives=3' : ''}`;
    const j = await fetchJson(url, 10000);
    const res = j && j.code === 'Ok' ? j.routes.map((r) => ({
      distance: r.distance, duration: r.duration,
      path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      steps: r.legs.flatMap((l) => l.steps).map((s) => ({
        type: s.maneuver.type, modifier: s.maneuver.modifier || '', name: s.name || '', ref: s.ref || '', distance: s.distance,
        pos: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
      })),
    })) : null;
    if (res) cache.set(key, res);
    return res;
  }

  return { search, reverse, route, nearby };
})();
