/* =====================================================================
 *  경로 계산
 *  - 석촌역 → 잠실역 (대중교통·도보·자전거), 석촌역 → 송파나루 동호 공영주차장 (자동차)
 *    은 실제 카카오맵 화면과 같은 "데모 경로"
 *  - 그 밖의 출발/도착은 거리 기반으로 추정
 * ===================================================================== */
const Routes = (() => {
  /* ---------- 공통 유틸 ---------- */
  const rad = (d) => (d * Math.PI) / 180;
  function dist(a, b) {
    const R = 6371000;
    const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const P = (lat, lng) => ({ lat, lng });
  const pathLen = (path) => path.slice(1).reduce((s, c, i) => s + dist(P(...path[i]), P(...c)), 0);
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}분` : ''}`.trim() : `${m}분`);
  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(10, Math.round(m / 10) * 10)}m`);
  const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
  function hash(s) { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  const byId = (id) => PLACES.find((p) => p.id === id);
  const near = (a, id, r) => dist(a, byId(id)) <= r;

  // 출발·도착 사이 "도로처럼 꺾인" 경로 (variant 별로 다르게)
  function roadPath(a, b, v = 0) {
    const d = dist(a, b);
    if (d < 120) return [[a.lat, a.lng], [b.lat, b.lng]];
    const dl = b.lat - a.lat; const dg = b.lng - a.lng;
    const pts = [[a.lat, a.lng]];
    if (v === 0) { pts.push([a.lat + dl * 0.45, a.lng + dg * 0.08], [a.lat + dl * 0.55, a.lng + dg * 0.92]); }
    else if (v === 1) { pts.push([a.lat + dl * 0.1, a.lng + dg * 0.5], [a.lat + dl * 0.9, a.lng + dg * 0.55]); }
    else { pts.push([a.lat + dl * 0.3, a.lng + dg * 0.2], [a.lat + dl * 0.62, a.lng + dg * 0.5], [a.lat + dl * 0.8, a.lng + dg * 0.88]); }
    pts.push([b.lat, b.lng]);
    return pts;
  }
  // 경로 꺾이는 지점에서 좌/우회전 판단
  function turnAt(prev, cur, next) {
    const v1 = { x: cur[1] - prev[1], y: cur[0] - prev[0] };
    const v2 = { x: next[1] - cur[1], y: next[0] - cur[0] };
    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const ang = Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
    if (ang < 20) return 'straight';
    return cross > 0 ? 'left' : 'right';
  }
  function compass(a, b) {
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; // 0 = 북
    const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
  }
  function landmark(pos, r = 280) {
    let best = null; let bd = Infinity;
    PLACES.forEach((p) => { if (p.cat === '지하철출구') return; const d = dist(pos, p); if (d < bd) { bd = d; best = p; } });
    return bd <= r ? fullName(best) : null;
  }
  const TURN_TXT = { left: '좌회전', right: '우회전', straight: '직진' };
  const TRAFFIC = ['원활', '원활', '서행', '원활', '정체', '서행'];

  /* =================== 자동차 =================== */
  function carFromPath(s, e, path, steps, { distM, minutes } = {}) {
    const d = distM || pathLen(path) * 1.05;
    const t = minutes || Math.max(2, Math.round(d / 1000 / 22 * 60 + 2));
    const taxi = Math.round((4800 + Math.max(0, d - 1600) / 131 * 100 + t * 150) / 100) * 100;
    return { time: t, dist: d, toll: 0, taxi, fuel: Math.round(d / 1000 * 152), path, steps };
  }
  function carEstimate(s, e, v = 0, scale = 1) {
    const path = roadPath(s, e, v);
    const h = hash(s.name + e.name + v);
    const steps = [{ title: '출발지', desc: `${s.name}, 출발지`, turn: 'start', traffic: '원활', pos: P(...path[0]) }];
    for (let i = 1; i < path.length - 1; i++) {
      const seg = dist(P(...path[i - 1]), P(...path[i])) * 1.05 * scale;
      const t = turnAt(path[i - 1], path[i], path[i + 1]);
      const lm = landmark(P(...path[i]));
      const nextLm = landmark(P(...path[path.length - 1]), 2000) || e.name;
      steps.push({
        title: lm || '', turn: t, traffic: TRAFFIC[(h + i) % TRAFFIC.length], pos: P(...path[i]),
        desc: `${compass(path[i - 1], path[i])}쪽으로 ${fmtDist(seg)} 이동, ${nextLm} 방면으로 ${TURN_TXT[t]}`,
      });
    }
    const last = dist(P(...path[path.length - 2]), P(...path[path.length - 1])) * 1.05 * scale;
    steps.push({ title: '도착', desc: `${fmtDist(last)} 이동 후 ${e.name}`, turn: 'end', traffic: '원활', pos: P(...path[path.length - 1]) });
    const base = carFromPath(s, e, path, steps);
    base.dist *= scale;
    return base;
  }
  function carDemo(s, e) {
    const path = [[s.lat, s.lng], [37.50600, 127.10650], [37.50870, 127.10420], [37.51050, 127.10920], [37.51440, 127.10840], [37.51290, 127.10700], [37.51210, 127.10630], [e.lat, e.lng]];
    const steps = [
      { title: '출발지', desc: '송파대로, 출발지', turn: 'start', traffic: '원활', pos: P(...path[1]) },
      { title: '석촌호수', desc: '석촌호수로 457m 이동, 방이삼거리 방면으로 우회전', turn: 'right', traffic: '서행', pos: P(...path[2]) },
      { title: '방이삼거리', desc: '오금로 503m 이동, 송파구청 잠실나루역 방면으로 좌회전', turn: 'left', traffic: '정체', pos: P(...path[3]) },
      { title: '', desc: '잠실로 208m 이동, 석촌호수 방면으로 좌회전', turn: 'left', traffic: '서행', pos: P(...path[4]) },
      { title: '송파나루지하차도', desc: '잠실로 109m 이동, 지하차도 옆길', turn: 'side', traffic: '서행', pos: P(...path[5]) },
      { title: '', desc: '잠실로 186m 이동, 우측 방향', turn: 'right', traffic: '원활', pos: P(...path[6]) },
      { title: '도착', desc: `${e.name}`, turn: 'end', traffic: '원활', pos: P(...path[7]) },
    ];
    return carFromPath(s, e, path, steps, { distM: 1600, minutes: 9 });
  }
  const CAR_OPTS = [
    { key: 'rec', name: '내비추천' }, { key: 'big', name: '큰길우선' }, { key: 'short', name: '최단거리' }, { key: 'free', name: '무료도로' },
  ];
  function car(s, e) {
    const demo = near(s, 'p1', 250) && near(e, 'p7', 150);
    const out = {};
    if (demo) {
      const base = carDemo(s, e);
      out.rec = base;
      out.big = { ...base, time: 10, dist: 1800, taxi: 6600, fuel: 274 };
      out.short = { ...base, time: 9, dist: 1500, taxi: 6100, fuel: 228 };
      out.free = base;
    } else {
      out.rec = carEstimate(s, e, 0);
      out.big = carEstimate(s, e, 1, 1.08); out.big.time += 1;
      out.short = carEstimate(s, e, 2, 0.95);
      out.free = out.rec;
    }
    return out;
  }

  /* =================== 대중교통 =================== */
  const WALK_MPM = 67; // 분당 67m ≈ 4km/h
  function makeTransit(s, e, o) {
    // o: { cat, time, walk, fare, dist, transfers, rides:[...] }
    const legs = [];
    const segs = [];
    let cur = { name: s.name, lat: s.lat, lng: s.lng };
    o.rides.forEach((r) => {
      const wd = dist(cur, r.from) * 1.25;
      legs.push({ kind: 'walk', from: cur, to: r.from, d: wd });
      segs.push({ kind: 'walk', path: [[cur.lat, cur.lng], [r.from.lat, r.from.lng]] });
      legs.push({ kind: 'ride', ride: r });
      segs.push({ kind: 'ride', color: r.color, path: r.path || [[r.from.lat, r.from.lng], [r.to.lat, r.to.lng]] });
      cur = r.to;
    });
    const wd = dist(cur, e) * 1.25;
    legs.push({ kind: 'walk', from: cur, to: e, d: wd });
    segs.push({ kind: 'walk', path: [[cur.lat, cur.lng], [e.lat, e.lng]] });
    // 도보 시간 분배
    const walks = legs.filter((l) => l.kind === 'walk');
    const totalWd = walks.reduce((a, l) => a + l.d, 0) || 1;
    const walkMin = o.walk != null ? o.walk : Math.round(totalWd / WALK_MPM);
    walks.forEach((l) => { l.min = Math.max(1, Math.round(walkMin * (l.d / totalWd))); });
    return { ...o, walk: walkMin, legs, segs, transfers: o.rides.length - 1 };
  }

  // 데모: 석촌역 → 잠실역 (카카오맵 화면 기준)
  function transitDemo(s, e) {
    const st8 = P(37.50551, 127.10694); const jam8 = P(37.51443, 127.10398);
    const st9 = P(37.50566, 127.10625);
    const S = (id) => { const x = STOPS.find((t) => t.id === id); return { name: x.name, id: x.id, lat: x.lat, lng: x.lng, dir: x.dir }; };
    const bus = (lines, fromId, toId, mid, stations, min) => ({
      kind: 'bus', color: BUS_TYPE[lines[0][1]], lines: lines.map(([no, type]) => ({ no, type })),
      from: S(fromId), to: S(toId), stations, min,
      path: [[S(fromId).lat, S(fromId).lng], ...mid, [S(toId).lat, S(toId).lng]],
    });
    const songpaRoad = [[37.50870, 127.10420], [37.51031, 127.10259], [37.51250, 127.10290]];
    const lakeRoad = [[37.50600, 127.10720], [37.50870, 127.10420], [37.51100, 127.10290]];
    const opts = [
      { cat: 'subway', time: 13, walk: 11, fare: '1,550원', dist: 1900, rides: [{
        kind: 'subway', line: '8', color: SUBWAY['8'].color, from: { name: '석촌역(8호선)', ...st8, dir: '별내 방면' },
        to: { name: '잠실역', ...jam8 }, stations: ['잠실역'], min: 2, path: [[st8.lat, st8.lng], [37.50757, 127.10537], [37.50870, 127.10420], [37.51031, 127.10259], [37.51250, 127.10290], [jam8.lat, jam8.lng]] }] },
      { cat: 'bus', time: 15, walk: 13, fare: '1,650원 ~ 3,450원', dist: 1700, rides: [
        bus([['31', '일반'], ['1007', '직행'], ['500-1', '직행'], ['P9302(출근)', '직행'], ['P9301(출근)', '직행']], '24003', '24139', songpaRoad, ['잠실역.롯데월드(중)', '잠실광역환승센터(지하)'], 2)] },
      { cat: 'bus', time: 15, walk: 10, fare: '1,200원', dist: 1700, rides: [
        bus([['송파01', '마을']], '24540', '24164', lakeRoad, ['석촌호수', '송파나루공원', '잠실역2번출구'], 5)] },
      { cat: 'bus', time: 19, walk: 14, fare: '1,500원 ~ 3,200원', dist: 2000, rides: [
        bus([['340', '간선'], ['3313', '지선'], ['500-1', '직행']], '24003', '24141', songpaRoad, ['잠실역.롯데월드(중)'], 3)] },
      { cat: 'bus', time: 17, walk: 12, fare: '1,500원', dist: 1800, rides: [
        bus([['3216', '지선']], '24540', '24164', lakeRoad, ['석촌호수', '잠실역2번출구'], 4)] },
      { cat: 'bus', time: 18, walk: 11, fare: '1,500원', dist: 1900, rides: [
        bus([['360', '간선']], '24002', '24141', songpaRoad, ['석촌호수', '잠실역.롯데월드(중)'], 4)] },
      { cat: 'bus', time: 21, walk: 15, fare: '1,500원', dist: 2000, rides: [
        bus([['3313', '지선']], '24003', '24139', songpaRoad, ['잠실역.롯데월드(중)', '잠실광역환승센터(지하)'], 3)] },
      { cat: 'bus', time: 24, walk: 13, fare: '2,800원', dist: 2100, rides: [
        bus([['1007', '직행'], ['P9301(출근)', '직행']], '24003', '24139', songpaRoad, ['잠실광역환승센터(지하)'], 4)] },
      { cat: 'subway', time: 22, walk: 6, fare: '1,550원', dist: 4100, rides: [
        { kind: 'subway', line: '9', color: SUBWAY['9'].color, from: { name: '석촌역(9호선)', ...st9, dir: '중앙보훈병원 방면' },
          to: { name: '종합운동장역', lat: 37.51091, lng: 127.07355 }, stations: ['석촌고분역', '삼전역', '종합운동장역'], min: 5,
          path: [[st9.lat, st9.lng], [37.50223, 127.09703], [37.50466, 127.08800], [37.51091, 127.07355]] },
        { kind: 'subway', line: '2', color: SUBWAY['2'].color, from: { name: '종합운동장역(2호선)', lat: 37.51091, lng: 127.07355, dir: '잠실 방면' },
          to: { name: '잠실역', lat: 37.51332, lng: 127.10013 }, stations: ['잠실새내역', '잠실역'], min: 4,
          path: [[37.51091, 127.07355], [37.51165, 127.08616], [37.51332, 127.10013]] }] },
      { cat: 'mixed', time: 20, walk: 9, fare: '1,550원', dist: 2600, rides: [
        { kind: 'subway', line: '9', color: SUBWAY['9'].color, from: { name: '석촌역(9호선)', ...st9, dir: '중앙보훈병원 방면' },
          to: { name: '송파나루역', lat: 37.51031, lng: 127.11234 }, stations: ['송파나루역'], min: 2,
          path: [[st9.lat, st9.lng], [37.50780, 127.10950], [37.51031, 127.11234]] },
        { ...bus([['3411', '지선']], '24210', '24141', [[37.51250, 127.10900], [37.51300, 127.10500]], ['송파구청', '잠실역.롯데월드(중)'], 4) }] },
    ];
    return opts.map((o) => makeTransit(s, e, o));
  }

  function transitEstimate(s, e) {
    const d = dist(s, e);
    if (d < 450) return { tooClose: true, list: [] };
    const list = [];
    // 1) 지하철 : 같은 노선 위 가까운 역 찾기
    const stations = PLACES.filter((p) => /호선$/.test(p.cat));
    const lines = [...new Set(stations.map((p) => p.sub[0]))];
    lines.forEach((ln) => {
      const onLine = stations.filter((p) => p.sub[0] === ln);
      const a = onLine.reduce((b, p) => (dist(s, p) < dist(s, b) ? p : b));
      const b = onLine.reduce((b2, p) => (dist(e, p) < dist(e, b2) ? p : b2));
      if (a === b || dist(s, a) > 1200 || dist(e, b) > 1200) return;
      const rideD = dist(a, b) * 1.15;
      const walkD = (dist(s, a) + dist(e, b)) * 1.25;
      list.push({ cat: 'subway', time: Math.round(walkD / WALK_MPM + rideD / 500 + 3), walk: Math.round(walkD / WALK_MPM), fare: '1,550원',
        dist: rideD + walkD, rides: [{ kind: 'subway', line: ln, color: SUBWAY[ln].color, from: { name: `${a.name}(${a.sub})`, lat: a.lat, lng: a.lng, dir: '' },
          to: { name: a.name === b.name ? b.name : b.name, lat: b.lat, lng: b.lng }, stations: [b.name], min: Math.max(2, Math.round(rideD / 500)) }] });
    });
    // 2) 버스 : 근처 정류장끼리 공통 노선
    const ns = (pt) => STOPS.filter((t) => dist(pt, t) < 700).sort((x, y) => dist(pt, x) - dist(pt, y));
    ns(s).forEach((a) => ns(e).forEach((b) => {
      if (a.name === b.name) return;
      const common = a.lines.filter((l) => b.lines.includes(l));
      if (!common.length || list.some((o) => o.rides[0].from.id === a.id && o.rides[0].to.id === b.id)) return;
      const rideD = dist(a, b) * 1.3; const walkD = (dist(s, a) + dist(e, b)) * 1.25;
      const ls = common.map((no) => ({ no, type: (BUSES.find((x) => x.no === no) || { type: '지선' }).type }));
      list.push({ cat: 'bus', time: Math.round(walkD / WALK_MPM + rideD / 250 + 4), walk: Math.round(walkD / WALK_MPM),
        fare: ls.some((l) => l.type === '마을') ? '1,200원' : '1,500원', dist: rideD + walkD,
        rides: [{ kind: 'bus', color: BUS_TYPE[ls[0].type], lines: ls, from: { name: a.name, id: a.id, lat: a.lat, lng: a.lng, dir: a.dir },
          to: { name: b.name, id: b.id, lat: b.lat, lng: b.lng }, stations: [b.name], min: Math.max(2, Math.round(rideD / 250)) }] });
    }));
    // 3) 데이터 범위 밖 → 일반 버스 추정
    if (!list.length) {
      const h = hash(s.name + e.name);
      const towards = (a, b, m) => { const k = Math.min(1, m / Math.max(1, dist(a, b))); return P(a.lat + (b.lat - a.lat) * k, a.lng + (b.lng - a.lng) * k); };
      [['간선', 100 + (h % 600)], ['지선', 3000 + (h % 900)]].forEach(([type, no], i) => {
        const f = towards(s, e, 180 + i * 60); const t = towards(e, s, 160 + i * 50);
        const rideD = dist(f, t) * 1.35; const walkD = (340 + i * 110) * 1.25;
        list.push({ cat: 'bus', time: Math.round(walkD / WALK_MPM + rideD / 250 + 5), walk: Math.round(walkD / WALK_MPM), fare: '1,500원', dist: rideD + walkD,
          rides: [{ kind: 'bus', color: BUS_TYPE[type], lines: [{ no: String(no), type }], from: { name: `${s.name} 인근 정류장`, ...f, dir: '' },
            to: { name: `${e.name} 인근 정류장`, ...t }, stations: [`${e.name} 인근 정류장`], min: Math.max(2, Math.round(rideD / 250)),
            path: [[f.lat, f.lng], [t.lat, t.lng]] }] });
      });
    }
    list.sort((a, b) => a.time - b.time);
    return { list: list.slice(0, 8).map((o) => makeTransit(s, e, o)) };
  }

  function transit(s, e) {
    const demo = near(s, 'p1', 250) && (near(e, 'p4', 300) || near(e, 'p5', 300));
    if (demo) return { list: transitDemo(s, e) };
    return transitEstimate(s, e);
  }

  /* =================== 도보 / 자전거 =================== */
  function stepsFromPath(path, verb) {
    const out = [];
    for (let i = 1; i < path.length; i++) {
      const seg = dist(P(...path[i - 1]), P(...path[i])) * 1.08;
      const t = i < path.length - 1 ? turnAt(path[i - 1], path[i], path[i + 1]) : 'end';
      const lm = landmark(P(...path[i]), 200);
      out.push({ text: t === 'end' ? '도착' : `${lm ? `${lm} 앞에서 ` : ''}${TURN_TXT[t]}`, d: `${verb} ${fmtDist(seg)}`, pos: P(...path[i]) });
    }
    return out;
  }
  function walkDemo(s, e) {
    const base = [[s.lat, s.lng], [37.50757, 127.10537], [37.50870, 127.10420], [37.51031, 127.10259], [37.51250, 127.10290], [e.lat, e.lng]];
    const alt = [[s.lat, s.lng], [37.50757, 127.10537], [37.50980, 127.10330], [37.51250, 127.10300], [e.lat, e.lng]];
    const steps = [
      { text: '송파대로 따라 북서쪽으로 직진', d: '도보 260m', pos: P(...base[1]) },
      { text: '석촌호수 지하도 이용', d: '지하도 1회', pos: P(...base[2]) },
      { text: '송파나루공원 지나 직진', d: '도보 450m', pos: P(...base[3]) },
      { text: '롯데월드타워 앞에서 좌측 방향', d: '도보 240m', pos: P(...base[4]) },
      { text: '도착', d: '도보 120m', pos: P(...base[5]) },
    ];
    return [
      { label: '큰길우선', time: 19, dist: 1300, extra: '지하도 1회', kcal: 57, path: base, steps },
      { label: '최단거리', time: 19, dist: 1200, extra: '지하도 1회', kcal: 56, path: alt, steps: stepsFromPath(alt, '도보') },
      { label: '편안한길', time: 20, dist: 1300, extra: '지하도 1회', kcal: 60, path: base, steps },
    ];
  }
  function walk(s, e) {
    if (near(s, 'p1', 250) && (near(e, 'p4', 300) || near(e, 'p5', 300))) return walkDemo(s, e);
    return ['큰길우선', '최단거리', '편안한길'].map((label, v) => {
      const path = roadPath(s, e, [1, 2, 0][v]);
      const d = pathLen(path) * [1.08, 1.0, 1.1][v];
      const cross = path.length - 2;
      return { label, time: Math.max(1, Math.round(d / WALK_MPM)), dist: d, extra: `횡단보도 ${cross}회`, kcal: Math.round(d * 0.044), path, steps: stepsFromPath(path, '도보') };
    });
  }
  function elevation(seed, n = 24) {
    const h = hash(seed); const base = 12 + (h % 18); const amp = 1 + (h % 5);
    return Array.from({ length: n }, (_, i) => base + amp * Math.sin(i / 3 + (h % 7)) + ((h >> i) & 1) * 0.6);
  }
  function bike(s, e) {
    const demo = near(s, 'p1', 250) && (near(e, 'p4', 300) || near(e, 'p5', 300));
    return ['자전거 도로우선', '최단거리', '편안한길'].map((label, v) => {
      const path = demo ? walkDemo(s, e)[0].path : roadPath(s, e, [0, 2, 1][v]);
      const d = demo ? 1200 : pathLen(path) * [1.1, 1.0, 1.12][v];
      let el = elevation(s.name + e.name + (demo ? '' : v));
      if (demo) el = el.map((x, i) => 15 - (2 * i) / (el.length - 1) + (i % 5 === 0 ? 0.15 : 0));
      const lo = Math.round(Math.min(...el)); const hi = Math.round(Math.max(...el));
      return { label, time: Math.max(1, Math.round(d / 300)), dist: d, kcal: Math.round(d * 0.021), lo, hi, elev: el, path, steps: stepsFromPath(path, '자전거') };
    });
  }

  /* =================== 실제 도로 경로 (OSRM) =================== */
  function turnInfo(s) {
    const m = s.modifier;
    if (['fork', 'off ramp', 'on ramp', 'merge'].includes(s.type)) return { turn: 'side', txt: m.includes('left') ? '왼쪽 길로 진입' : '오른쪽 길로 진입' };
    if (['roundabout', 'rotary', 'exit roundabout', 'exit rotary'].includes(s.type)) return { turn: 'straight', txt: '회전교차로 통과' };
    if (m === 'uturn') return { turn: 'uturn', txt: '유턴' };
    if (m === 'left' || m === 'sharp left') return { turn: 'left', txt: '좌회전' };
    if (m === 'slight left') return { turn: 'left', txt: '좌측 방향' };
    if (m === 'right' || m === 'sharp right') return { turn: 'right', txt: '우회전' };
    if (m === 'slight right') return { turn: 'right', txt: '우측 방향' };
    return { turn: 'straight', txt: '직진' };
  }
  // 이름만 바뀌는 구간 / 그냥 직진은 앞 단계에 합치기
  function cleanSteps(steps) {
    const out = [];
    steps.forEach((s) => {
      const skip = s.type === 'new name' || (s.type === 'continue' && (!s.modifier || s.modifier === 'straight'));
      if (skip && out.length) { const l = out[out.length - 1]; l.distance += s.distance; if (!l.name) l.name = s.name; return; }
      out.push({ ...s });
    });
    return out;
  }
  const road = (s) => s.name || s.ref || '도로';

  function carSteps(r, s, e) {
    const st = cleanSteps(r.steps); const h = hash(s.name + e.name);
    return st.map((x, i) => {
      if (x.type === 'depart') return { title: '출발지', desc: `${road(x)}, 출발지`, turn: 'start', traffic: '원활', pos: x.pos };
      const p = st[i - 1];
      if (x.type === 'arrive') return { title: '도착', desc: `${road(p)} ${fmtDist(p.distance)} 이동 후 ${e.name}`, turn: 'end', traffic: '원활', pos: x.pos };
      const t = turnInfo(x);
      return { title: landmark(x.pos, 120) || x.name || '', turn: t.turn, traffic: TRAFFIC[(h + i) % TRAFFIC.length], pos: x.pos,
        desc: `${road(p)} ${fmtDist(p.distance)} 이동, ${x.name ? `${x.name} 방면으로 ` : ''}${t.txt}` };
    });
  }
  async function carReal(s, e) {
    const rs = await Geo.route('car', [s, e], { alternatives: true });
    if (!rs) return { ...car(s, e), estimated: true };
    const all = rs.map((r) => carFromPath(s, e, r.path, carSteps(r, s, e), { distM: r.distance, minutes: Math.max(1, Math.round(r.duration / 60 * 1.5 + 1)) }));
    const short = all.reduce((a, b) => (b.dist < a.dist ? b : a));
    return { rec: all[0], big: all[1] || all[0], short, free: all[0] };
  }

  function lineSteps(r, verb) {
    const st = cleanSteps(r.steps);
    return st.filter((x) => x.type !== 'depart').map((x, i) => {
      if (x.type === 'arrive') return { text: '도착', d: '', pos: x.pos };
      const t = turnInfo(x);
      return { text: `${x.name ? `${x.name} 방향으로 ` : ''}${t.txt}`, d: `${verb} ${fmtDist(x.distance)}`, pos: x.pos };
    });
  }
  async function pickVariants(kind, s, e) {
    const rs = await Geo.route(kind, [s, e], { alternatives: true });
    if (!rs) return null;
    const short = rs.reduce((a, b) => (b.distance < a.distance ? b : a));
    return [rs[0], short, rs[1] || rs[0]];
  }
  async function walkReal(s, e) {
    const v = await pickVariants('foot', s, e);
    if (!v) return walk(s, e);
    return ['큰길우선', '최단거리', '편안한길'].map((label, i) => {
      const r = v[i]; const turns = cleanSteps(r.steps).filter((x) => !['depart', 'arrive'].includes(x.type)).length;
      return { label, time: Math.max(1, Math.round(r.distance / WALK_MPM)), dist: r.distance, extra: `방향전환 ${turns}회`,
        kcal: Math.round(r.distance * 0.044), path: r.path, steps: lineSteps(r, '도보') };
    });
  }
  async function bikeReal(s, e) {
    const v = await pickVariants('bike', s, e);
    if (!v) return bike(s, e);
    return ['자전거 도로우선', '최단거리', '편안한길'].map((label, i) => {
      const r = v[i]; const el = elevation(s.name + e.name + i);
      return { label, time: Math.max(1, Math.round(r.distance / 300)), dist: r.distance, kcal: Math.round(r.distance * 0.021),
        lo: Math.round(Math.min(...el)), hi: Math.round(Math.max(...el)), elev: el, path: r.path, steps: lineSteps(r, '자전거') };
    });
  }
  // 대중교통 : 선택한 경로만 실제 도로 모양으로 다시 그림 (도보=보행로, 버스·지하철=도로)
  async function transitGeometry(o) {
    if (o.realSegs) return o.realSegs;
    o.realSegs = await Promise.all(o.segs.map(async (sg) => {
      const pts = sg.path.map((c) => P(...c));
      const a = pts[0]; const b = pts[pts.length - 1];
      if (dist(a, b) < 25) return sg;
      const r = await Geo.route(sg.kind === 'walk' ? 'foot' : 'car', sg.kind === 'walk' ? [a, b] : pts);
      return r ? { ...sg, path: r[0].path } : sg;
    }));
    return o.realSegs;
  }

  return { car: carReal, transit, walk: walkReal, bike: bikeReal, transitGeometry, CAR_OPTS, dist, fmtMin, fmtDist, won };
})();
