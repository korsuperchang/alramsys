
// ── 4. 입력 ──
const GROUPS = [["design", "<span class=\"step\">2</span>설계", false], ["open", "<span class=\"step\">3</span>갱구 · 편 개설", false], ["sched", "<span class=\"step\">4</span>생산 일정", false], ["econ", "<span class=\"step\">5</span>경제성", false],
  ["a-sf", "필러 안전율 세부", true], ["a-lim", "채굴 범위", true], ["a-dev", "굴진", true], ["a-cost", "원가 세부", true]];
const PARAMS = [
  { id: "p", g: "design", label: "필러 폭", min: 6, max: 30, step: 0.5, v: 12, u: "m" },
  { id: "h", g: "design", label: "갱도 높이", min: 4, max: 20, step: 0.5, v: 12, u: "m" },
  { id: "w", g: "design", label: "갱도 폭", min: 4, max: 25, step: 0.5, v: 13, u: "m" },
  { id: "lv", g: "design", label: "편 간격", min: 8, max: 40, step: 1, v: 20, u: "m" },
  { id: "ucs", g: "design", label: "암석 일축압축강도", min: 30, max: 200, step: 5, v: 80, u: "MPa" },
  { id: "sfmin", g: "design", label: "기준 안전율", min: 1.2, max: 3, step: 0.1, v: 2.0, u: "", d: 1 },
  { id: "az", g: "open", label: "갱구 굴진 방위", min: 0, max: 359, step: 1, v: 90, u: "°" },
  { id: "dip0", g: "open", label: "진입 경사 (0 = 수평갱)", min: 0, max: 20, step: 0.5, v: 0, u: "° 하향", d: 1 },
  { id: "ia", g: "open", label: "연층 사갱 경사", min: 5, max: 25, step: 0.5, v: 16, u: "°", d: 1 },
  { id: "trig", g: "open", label: "다음 편 개설 (윗편 채굴률)", min: 0, max: 100, step: 5, v: 50, u: "%" },
  { id: "ann", g: "sched", label: "연간 생산 목표", min: 10, max: 1000, step: 10, v: 80, u: "만t" },
  { id: "nface", g: "sched", label: "동시 작업장 수", min: 1, max: 60, step: 1, v: 6, u: "곳" },
  { id: "frate", g: "sched", label: "작업장당 월 생산", min: 2, max: 60, step: 1, v: 12, u: "천t" },
  { id: "y0", g: "sched", label: "착공 연도", min: 2026, max: 2040, step: 1, v: 2027, u: "", raw: true },
  { id: "price", g: "econ", label: "판매가", min: 5000, max: 30000, step: 500, v: 14000, u: "원/t" },
  { id: "opex", g: "econ", label: "운영비", min: 3000, max: 20000, step: 250, v: 8500, u: "원/t" },
  { id: "disc", g: "econ", label: "할인율", min: 3, max: 15, step: 0.5, v: 8, u: "%", d: 1 },
  { id: "kf", g: "a-sf", label: "규모 효과 계수", min: 0.3, max: 0.8, step: 0.05, v: 0.5, u: "", d: 2 },
  { id: "sill", g: "a-sf", label: "수평 필러 기준 (두께÷갱도 폭)", min: 0.2, max: 1.5, step: 0.05, v: 0.5, u: "", d: 2 },
  { id: "rho", g: "a-lim", label: "비중", min: 2.0, max: 4.5, step: 0.01, v: 2.7, u: "", d: 2 },
  { id: "minfrac", g: "a-lim", label: "최소 광체 비율", min: 50, max: 100, step: 5, v: 80, u: "%" },
  { id: "cover", g: "a-lim", label: "최소 지표 피복", min: 0, max: 100, step: 5, v: 30, u: "m" },
  { id: "bnd", g: "a-lim", label: "광구 경계 이격", min: 0, max: 50, step: 5, v: 20, u: "m" },
  { id: "iw", g: "a-lim", label: "사갱 보호 폭 (한쪽)", min: 5, max: 50, step: 5, v: 20, u: "m" },
  { id: "maxlv", g: "a-lim", label: "편 수 제한 (위에서부터)", min: 1, max: 60, step: 1, v: 60, u: "편" },
  { id: "minblk", g: "a-lim", label: "떨어진 블록 최소 크기", min: 1, max: 30, step: 1, v: 6, u: "판넬" },
  { id: "minval", g: "a-lim", label: "떨어진 블록 최소 순이익", min: 0, max: 20, step: 0.5, v: 3, u: "억원", d: 1 },
  { id: "rate", g: "a-dev", label: "굴진 속도 (수평갱·사갱)", min: 20, max: 150, step: 5, v: 60, u: "m/월" },
  { id: "lead", g: "a-dev", label: "편 개발 선행", min: 0, max: 12, step: 1, v: 4, u: "개월" },
  { id: "hinc", g: "a-cost", label: "편당 운반비 증가", min: 0, max: 1500, step: 50, v: 300, u: "원/t" },
  { id: "hcost", g: "a-cost", label: "편 내 운반비", min: 0, max: 300, step: 10, v: 60, u: "원/t·100m" },
  { id: "devc", g: "a-cost", label: "굴진비 (수평갱·사갱)", min: 100, max: 600, step: 10, v: 250, u: "만원/m" },
  { id: "dcost", g: "a-cost", label: "편 갱도 굴진비", min: 50, max: 400, step: 10, v: 150, u: "만원/m" },
  { id: "capex", g: "a-cost", label: "초기 투자", min: 0, max: 500, step: 10, v: 150, u: "억원" },
];
const form = $("params"), adv = document.createElement("details"); adv.className = "adv"; adv.id = "adv"; adv.innerHTML = "<summary>고급 옵션 (기본값으로 두어도 됩니다)</summary>";
for (const [g, title, isAdv] of GROUPS) {
  const fs = document.createElement("fieldset"); fs.innerHTML = `<legend>${title}</legend>`;
  if (g === "open") fs.insertAdjacentHTML("beforeend", `<div class="portalbar"><button type="button" id="pick" aria-pressed="false">평면도에서 갱구 놓기</button><button type="button" id="autoportal">자동 위치</button></div>`);
  for (const p of PARAMS.filter(q => q.g === g)) {
    const row = document.createElement("div"); row.className = "sl";
    row.innerHTML = `<label for="p-${p.id}">${p.label}</label><output id="o-${p.id}" for="p-${p.id}"></output><input type="range" id="p-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.v}">`;
    fs.appendChild(row);
    if (p.id === "az") fs.insertAdjacentHTML("beforeend", `<label class="opt"><input type="checkbox" id="p-azauto" checked>방위 자동 (가장 가까운 광체 쪽)</label>`);
    if (p.id === "dip0") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="portalinfo"></div>`);
  }
  if (g === "design") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="derived"></div>`);
  if (g === "sched") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="capinfo"></div>`);
  if (g === "a-sf") fs.insertAdjacentHTML("beforeend", `<label class="opt"><input type="checkbox" id="p-sfx">기준 미달 판넬은 설계에서 제외</label>`);
  if (g === "a-lim") fs.insertAdjacentHTML("beforeend", `<label class="opt" for="p-grid">채광 격자 방향 <select id="p-grid"><option value="entry">갱구 굴진 방향</option><option value="ore">광체 긴 축</option><option value="ns">남북 고정</option></select></label><label class="opt"><input type="checkbox" id="p-econ" checked>수지 안 맞는 떨어진 블록은 캐지 않음</label>`);
  (isAdv ? adv : form).appendChild(fs);
}
form.appendChild(adv);
function readP() { const o = {}; for (const p of PARAMS) o[p.id] = +$("p-" + p.id).value; o.sfx = $("p-sfx").checked; o.econ = $("p-econ").checked; o.azauto = $("p-azauto").checked; o.grid = $("p-grid").value; return o; }
function showOutputs() { for (const p of PARAMS) { const v = +$("p-" + p.id).value; $("o-" + p.id).textContent = (p.raw ? String(v) : fmt(v, p.d || 0)) + (p.u ? " " + p.u : ""); } }
const bearing = deg => { const a = (deg % 360 + 360) % 360; return a <= 90 ? `N${fmt(a)}°E` : a <= 180 ? `S${fmt(180 - a)}°E` : a <= 270 ? `S${fmt(a - 180)}°W` : `N${fmt(360 - a)}°W`; };

// ── 5. 채광 격자(굴진 방향으로 돌린 좌표) · 광체 수직선 ──
// 격자 좌표 (u, v): 원점 = 1편 진입점, u = 격자 방향, v = 그 왼쪽. 판넬 경계가 v = 0에 오므로 진입 굴진이 갱도 중심선을 따라 들어간다.
let RAY = null, USERPORTAL = null;
const toLoc = (F, x, y) => [(x - F.ox) * F.ux + (y - F.oy) * F.uy, -(x - F.ox) * F.uy + (y - F.oy) * F.ux];
const toW = (F, u, v) => [F.ox + u * F.ux - v * F.uy, F.oy + u * F.uy + v * F.ux];
function buildRays(S, F) {
  const key = [S, F.ox, F.oy, F.ux, F.uy, DATAVER].join("|"); if (RAY && RAY.key === key) return RAY;
  const s = S / 3, T = ORE.tris; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let t = 0; t < T.length; t += 3) { const u = (T[t] - F.ox) * F.ux + (T[t + 1] - F.oy) * F.uy, v = -(T[t] - F.ox) * F.uy + (T[t + 1] - F.oy) * F.ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  const gx0 = Math.floor(u0 / S) * S, gy0 = Math.floor(v0 / S) * S, nx = Math.max(1, Math.ceil((u1 - gx0) / S)), ny = Math.max(1, Math.ceil((v1 - gy0) / S)), rx = nx * 3, ry = ny * 3;
  const jx = 0.0137 * s, jy = 0.0071 * s, pr = new Array(rx * ry); let odd = 0;
  for (const sd of ORE.solids) {                                              // 솔리드마다 따로 교차 → 구간, 나중에 합침
    const cr = new Array(rx * ry), Ts = sd.tris;
    for (let t = 0; t < Ts.length; t += 9) {
      const ax = (Ts[t] - F.ox) * F.ux + (Ts[t + 1] - F.oy) * F.uy, ay = -(Ts[t] - F.ox) * F.uy + (Ts[t + 1] - F.oy) * F.ux, az = Ts[t + 2];
      const bx = (Ts[t + 3] - F.ox) * F.ux + (Ts[t + 4] - F.oy) * F.uy, by = -(Ts[t + 3] - F.ox) * F.uy + (Ts[t + 4] - F.oy) * F.ux, bz = Ts[t + 5];
      const cx = (Ts[t + 6] - F.ox) * F.ux + (Ts[t + 7] - F.oy) * F.uy, cy = -(Ts[t + 6] - F.ox) * F.uy + (Ts[t + 7] - F.oy) * F.ux, cz = Ts[t + 8];
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - gx0 - jx) / s - 0.5)), i1 = Math.min(rx - 1, Math.floor((Math.max(ax, bx, cx) - gx0 - jx) / s - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - gy0 - jy) / s - 0.5)), j1 = Math.min(ry - 1, Math.floor((Math.max(ay, by, cy) - gy0 - jy) / s - 0.5));
      if (i0 > i1 || j0 > j1) continue; const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-12) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = gx0 + (i + 0.5) * s + jx, py = gy0 + (j + 0.5) * s + jy, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue; const k = j * rx + i; (cr[k] || (cr[k] = [])).push(l1 * az + l2 * bz + l3 * cz);
      }
    }
    for (let k = 0; k < cr.length; k++) {
      const a = cr[k]; if (!a) continue; a.sort((p, q) => p - q);
      const u = [a[0]]; for (let q = 1; q < a.length; q++) if (a[q] - u[u.length - 1] > 1e-6) u.push(a[q]);
      if (u.length % 2) { odd++; u.pop(); }
      for (let q = 0; q < u.length; q += 2) (pr[k] || (pr[k] = [])).push([u[q], u[q + 1]]);
    }
  }
  const iv = new Array(rx * ry); let vol = 0, volRaw = 0, hit = 0, zTop = -Infinity;
  for (let k = 0; k < pr.length; k++) {
    if (!pr[k]) continue; hit++; const u = mergeIv(pr[k]);
    const w = toW(F, gx0 + (k % rx + 0.5) * s + jx, gy0 + (Math.floor(k / rx) + 0.5) * s + jy), tz = terrainZ(w[0], w[1]), o = [];
    for (let q = 0; q < u.length; q += 2) { volRaw += (u[q + 1] - u[q]) * s * s; const hi = Math.min(u[q + 1], tz); if (hi > u[q]) { o.push(u[q], hi); vol += (hi - u[q]) * s * s; if (hi > zTop) zTop = hi; } }
    if (o.length) iv[k] = o;
  }
  return RAY = { key, S, s, gx0, gy0, nx, ny, rx, ry, iv, odd, hit, vol, volRaw, zTop };
}
const inPoly = (x, y, pg) => { let c = false; for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) { const a = pg[i], b = pg[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const edgeDist = (x, y, pg) => { let m = Infinity; for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) { const a = pg[i], b = pg[j], dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1); m = Math.min(m, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return m; };
const allowed = (x, y, m) => { if (!CLAIM.length) return true; for (const pg of CLAIM) if (inPoly(x, y, pg) && edgeDist(x, y, pg) >= m) return true; return false; };
function autoPortal(P, H) {
  // 광체 꼭대기에서 한 편 아래 높이의 사면 중, 광체 윗부분에 가장 가까운 곳. 없으면 광체 근처에서 가장 낮은 지표.
  const ob = ORE.bbox, zt = ob.z1 - H - 2, band = [], T = ORE.tris, st = Math.max(3, Math.floor(T.length / 3 / 600) * 3);
  for (let t = 0; t < T.length; t += st) if (T[t + 2] > zt - P.lv) band.push([T[t], T[t + 1]]);
  let best = null;
  for (const strict of [true, false]) {
    const cand = [];
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      const tz = G.z[j * G.nx + i]; if (tz < zt - P.lv || tz > zt) continue; const x = G.x0 + i * G.d, y = G.y0 + j * G.d;
      if (strict && !allowed(x, y, 0)) continue;
      let bd = Infinity; for (const b of band) { const d = Math.hypot(b[0] - x, b[1] - y); if (d < bd) bd = d; } cand.push({ x, y, z: tz, bd });
    }
    if (!cand.length) continue;
    // 가까운 후보 가운데 실제로 굴진해 보아 광체까지 가장 짧은 곳
    cand.sort((a, b) => a.bd - b.bd); const near = cand.slice(0, 240), pick = []; for (let k = 0; k < near.length; k += Math.max(1, Math.floor(near.length / 40))) pick.push(near[k]);
    let bs = Infinity; for (const c of pick) for (let a = 0; a < 360; a += 15) { const h = marchEntry(c, a, P.dip0, H, P.minfrac / 100, 6, P.cover); if (h && h.s < bs) { bs = h.s; best = c; } }
    if (!best) best = cand[0];
    break;
  }
  if (!best) { let lo = Infinity; const m = 300; for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const x = G.x0 + i * G.d, y = G.y0 + j * G.d; if (x < ob.x0 - m || x > ob.x1 + m || y < ob.y0 - m || y > ob.y1 + m) continue; const tz = G.z[j * G.nx + i]; if (tz < lo) { lo = tz; best = { x, y }; } } }
  return best || { x: ob.x0 - 50, y: (ob.y0 + ob.y1) / 2 };
}
// 갱구에서 정한 방위·경사로 곧게 굴진해, 갱도 높이의 대부분이 광체 안에 들고 지표 피복·광구 조건도 맞는 첫 지점까지
function marchEntry(P0, azDeg, dipDeg, H, minfrac, step, cover) {
  const a = azDeg * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), tg = Math.tan(dipDeg * Math.PI / 180), ob = ORE.bbox;
  const far = Math.hypot(Math.max(Math.abs(P0.x - ob.x0), Math.abs(P0.x - ob.x1)), Math.max(Math.abs(P0.y - ob.y0), Math.abs(P0.y - ob.y1))) + 10;
  for (let s = 0; s <= far; s += step) {
    const x = P0.x + ux * s, y = P0.y + uy * s; if (x < ob.x0 || x > ob.x1 || y < ob.y0 || y > ob.y1) continue;
    const z = P0.z - s * tg, o = oreAt(x, y); let ov = 0; for (let q = 0; q < o.length; q += 2) ov += Math.max(0, Math.min(o[q + 1], z + H) - Math.max(o[q], z));
    if (ov >= minfrac * H && terrainZ(x, y) - (z + H) >= cover && allowed(x, y, 0)) return { s, x, y, z };
  }
  return null;
}

// ── 6. 설계: 갱구 · 진입 굴진 · 편 · 판넬 · 연층 사갱 · 블록 ──
function design(P) {
  const warn = []; let H = P.h; const Pw = P.p, S = P.p + P.w, mf = P.minfrac / 100;
  if (H > P.lv - 2) { H = P.lv - 2; warn.push(`갱도 높이를 ${fmt(H, 1)}m로 줄여 계산 (수평 필러 최소 2m)`); }
  const auto = !USERPORTAL, pp = USERPORTAL || autoPortal(P, H), PORTAL = { x: pp.x, y: pp.y, z: terrainZ(pp.x, pp.y) }, zP = PORTAL.z;
  // 진입 굴진: 방위 자동이면 5°씩 돌려 가장 짧게 광체에 닿는 방향
  let az = P.az, hit = null; const azAsk = P.az;
  if (P.azauto) { let bs = Infinity; for (let a = 0; a < 360; a += 5) { const h = marchEntry(PORTAL, a, P.dip0, H, mf, 4, P.cover); if (h && h.s < bs) { bs = h.s; az = a; } } }
  hit = marchEntry(PORTAL, az, P.dip0, H, mf, 1, P.cover);
  if (!hit) {
    warn.push(`갱구에서 ${bearing(az)} 방향, 경사 ${fmt(P.dip0, 1)}°로는 광체에 닿지 않음 — 방위·경사나 갱구 위치를 바꾸세요`);
    const s = Math.hypot(ORE.cx - PORTAL.x, ORE.cy - PORTAL.y); az = Math.atan2(ORE.cx - PORTAL.x, ORE.cy - PORTAL.y) * 180 / Math.PI; hit = { s, x: ORE.cx, y: ORE.cy, z: zP - s * Math.tan(P.dip0 * Math.PI / 180), miss: true };
  }
  const E1 = { x: hit.x, y: hit.y, z: hit.z }, z1 = E1.z, entryLen = Math.max(5, hit.s / Math.cos(P.dip0 * Math.PI / 180));
  const gAz = P.grid === "ore" ? ORE.axisAz : P.grid === "ns" ? 0 : az * Math.PI / 180, F = { ox: E1.x, oy: E1.y, ux: Math.sin(gAz), uy: Math.cos(gAz) };
  const R = buildRays(S, F);
  // 판넬 기둥(같은 평면 위치): 경계·지표
  const cols = [], h2 = S / 2;
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const rays = []; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { const o = R.iv[(j * 3 + b) * R.rx + i * 3 + a]; if (o) rays.push(o); }
    if (!rays.length) continue; const u = R.gx0 + (i + 0.5) * S, v = R.gy0 + (j + 0.5) * S, [x, y] = toW(F, u, v);
    if (!allowed(x, y, P.bnd + h2)) continue;
    let tzm = terrainZ(x, y); const tzc = tzm; for (const [du, dv] of [[-h2, -h2], [h2, -h2], [-h2, h2], [h2, h2]]) { const w = toW(F, u + du, v + dv); tzm = Math.min(tzm, terrainZ(w[0], w[1])); }
    cols.push({ i, j, u, v, x, y, rays, tzc, tzm });
  }
  let aboveV = 0; for (const o of R.iv) if (o) for (let q = 0; q < o.length; q += 2) aboveV += Math.max(0, o[q + 1] - Math.max(o[q], z1 + H)) * R.s * R.s;
  const all = [], st = P.kf * P.ucs * (0.778 + 0.222 * Pw / H); let nUsed = 0, cut = false;
  for (let k = 0; k < 500; k++) {
    const zf = z1 - k * P.lv; if (zf + H < ORE.bbox.z0) break; const cand = [], rej = [];
    for (const c of cols) {
      let ov = 0; for (const o of c.rays) for (let q = 0; q < o.length; q += 2) ov += Math.max(0, Math.min(o[q + 1], zf + H) - Math.max(o[q], zf));
      const frac = ov / (9 * H); if (frac < mf) continue;
      const depth = c.tzc - (zf + H / 2), p = { i: c.i, j: c.j, u: c.u, v: c.v, x: c.x, y: c.y, zf, frac, depth, t: (S * S - Pw * Pw) * H * P.rho };
      p.sf = depth > 0 ? st / (P.rho * 9.81 * depth / 1000 * S * S / (Pw * Pw)) : 99;
      if (c.tzm - (zf + H) < P.cover) { p.why = "cover"; rej.push(p); } else cand.push(p);
    }
    if (cand.length || rej.length) all.push({ zf, cand, rej });
    if (cand.length && ++nUsed >= P.maxlv) { if (zf - P.lv + H > ORE.bbox.z0) cut = true; break; }
  }
  if (cut) warn.push(`편 수 제한 ${fmt(P.maxlv)}편까지만 설계 (그 아래 광체는 계획에 없음)`);
  const used = all.filter(L => L.cand.length), iaR = P.ia * Math.PI / 180, ti = Math.tan(iaR);
  for (const L of all) { L.J = null; L.xc = 0; let w = 0; L.cx = L.cy = 0; for (const p of L.cand) { L.cx += p.x; L.cy += p.y; w++; } if (w) { L.cx /= w; L.cy /= w; } }
  // 1편 진입점: 진입 굴진이 광체에 닿은 곳. 그 편에 캘 판넬이 없으면 가장 가까운 아래 편 판넬까지 사갱을 더 판다
  let J0 = { ...E1 }, len0 = entryLen;
  if (used.length) {
    let bd = Infinity, bp = null; for (const p of used[0].cand) { const d = Math.hypot(p.x - E1.x, p.y - E1.y); if (d < bd) { bd = d; bp = p; } }
    const dz = z1 - used[0].zf;
    if (dz >= 1 || bd > S) { J0 = { x: bp.x, y: bp.y, z: used[0].zf }; len0 += dz >= 1 ? Math.max(Math.hypot(bd, dz), dz / Math.sin(iaR)) : bd; if (!hit.miss && (dz >= 1 || bd > S * 3)) warn.push(`진입점 주변에 캘 판넬이 없어 ${fmt(bd)}m 떨어진 판넬까지 더 굴진`); }
    else J0 = { x: E1.x, y: E1.y, z: used[0].zf };
  }
  // 편마다 연층 사갱 한 구간: 수평 거리 = 높이차 ÷ tan(경사). 그 원 위에서 아랫편 광체 안이고 갱구·그 편 중심에 가까운 곳으로
  let prev = J0;
  used.forEach((L, k) => {
    if (!k) { L.J = { ...J0 }; return; }
    const r = (prev.z - L.zf) / ti; let bj = null, bs = Infinity;
    for (let q = 0; q < 72; q++) {
      const th = q * Math.PI / 36, x = prev.x + r * Math.sin(th), y = prev.y + r * Math.cos(th);
      let dOre = Infinity; for (const p of L.cand) dOre = Math.min(dOre, Math.hypot(p.x - x, p.y - y));
      const sc = Math.max(0, dOre - S / 2) * 8 + 0.5 * Math.hypot(x - PORTAL.x, y - PORTAL.y) + 0.5 * Math.hypot(x - L.cx, y - L.cy);
      if (sc < bs) { bs = sc; bj = { x, y, dOre }; }
    }
    L.J = { x: bj.x, y: bj.y, z: L.zf }; L.xc = Math.max(0, bj.dOre - S / 2); prev = L.J;
  });
  const segs = used.slice(1).map((L, k) => ({ a: used[k].J, b: L.J }));
  const INC = { E1, J0, PORTAL, zP, z1, auto, az, azShow: hit.miss && !P.azauto ? azAsk : az, dip0: P.dip0, entryLen, miss: !!hit.miss, ia: P.ia, iaR, ti, segs, len0, F, gAz };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const L of all) {
    L.panels = []; L.map = new Map(); L.drives = [];
    for (const p of L.cand) {
      p.L = L; let inc = false;
      for (const g of segs) {                                             // 사갱 보호 광주
        const ax = g.b.x - g.a.x, ay = g.b.y - g.a.y, u = ((p.x - g.a.x) * ax + (p.y - g.a.y) * ay) / (ax * ax + ay * ay || 1);
        if (u < -0.15 || u > 1.15) continue;
        const cu = clamp(u, 0, 1), d = Math.hypot(p.x - g.a.x - ax * cu, p.y - g.a.y - ay * cu), zi = g.a.z + (g.b.z - g.a.z) * cu;
        if (d < P.iw + S / 2 && Math.abs(p.zf + H / 2 - zi) < H / 2 + 6) { inc = true; break; }
      }
      if (inc) { p.why = "incline"; L.rej.push(p); }
      else if (P.sfx && p.sf < P.sfmin) { p.why = "sf"; L.rej.push(p); }
      else L.panels.push(p);
    }
    // 블록(상하좌우로 붙은 판넬)을 진입점에서 가까운 것부터 잇고, 경로 거리순으로 캔다. 떨어진 블록은 가장 가까운 연결점에서 편 갱도.
    const base = P.opex + Math.max(0, used.indexOf(L)) * P.hinc, cost = d => base + P.hcost * d / 100;
    if (L.J) {
      const idx = new Map(L.panels.map(p => [p.i + "," + p.j, p])), seen = new Set(); let rest = [];
      for (const p0 of L.panels) {
        if (seen.has(p0)) continue; const blk = [], stk = [p0]; seen.add(p0);
        while (stk.length) { const p = stk.pop(); p.bid = rest.length; blk.push(p); for (const [di, dj] of NB) { const q = idx.get((p.i + di) + "," + (p.j + dj)); if (q && !seen.has(q)) { seen.add(q); stk.push(q); } } }
        rest.push(blk);
      }
      const root = { x: L.J.x, y: L.J.y, path: 0 }, conn = [root], out = [];
      while (rest.length) {
        const cs = rest.map(blk => { let d = Infinity, src = null, ent = null; for (const c of conn) for (const p of blk) { const e = Math.hypot(p.x - c.x, p.y - c.y); if (e < d) { d = e; src = c; ent = p; } } return { blk, d, src, ent }; }).sort((a, b) => a.d - b.d);
        let took = null;
        for (const c of cs) {
          const path = new Map([[c.ent, c.src.path + c.d]]), pre = new Map([[c.ent, c.src === root ? null : c.src]]), q = [c.ent];
          for (let h = 0; h < q.length; h++) for (const [di, dj] of NB) { const n = idx.get((q[h].i + di) + "," + (q[h].j + dj)); if (n && n.bid === c.ent.bid && !path.has(n)) { path.set(n, path.get(q[h]) + S); pre.set(n, q[h]); q.push(n); } }
          const drive = Math.max(0, c.d - S), att = c.src === root && c.d < S * 1.5;
          let val = -drive * P.dcost * 1e4, t = 0; for (const p of c.blk) { val += p.t * (p.frac * P.price - cost(path.get(p))); t += p.t; }
          c.info = { n: c.blk.length, t, drive, val, paid: false }; c.path = path; c.pre = pre;
          if (!P.econ || (att ? val > 0 : val >= P.minval * 1e8 && c.blk.length >= P.minblk)) { took = c; break; }
        }
        if (!took) { for (const c of cs) for (const p of c.blk) { p.blk = c.info; p.dist = c.path.get(p); p.cost = cost(p.dist); p.why = "econ"; L.rej.push(p); } break; }
        for (const p of took.blk) { p.blk = took.info; p.dist = p.path = took.path.get(p); p.pre = took.pre.get(p); p.cost = cost(p.dist); out.push(p); conn.push(p); }
        if (took.d > S * 0.6) L.drives.push([{ x: took.src.x, y: took.src.y }, { x: took.ent.x, y: took.ent.y }]);   // 연결 갱도(진입점·다른 블록 → 이 블록)
        rest = rest.filter(b => b !== took.blk);
      }
      L.panels = out;
    } else L.panels = [];
    L.panels.sort((a, b) => a.dist - b.dist);
    // 편 주 운반 갱도 = 진입점에서 가장 먼 판넬까지 판넬을 따라 이어진 경로(광체 안)
    L.trunk = []; if (L.panels.length) { let p = L.panels[L.panels.length - 1]; const pts = []; for (let g = 0; p && g < 5000; g++) { pts.push({ x: p.x, y: p.y }); p = p.pre; } L.trunk = pts.reverse(); }
    for (const p of [...L.panels, ...L.rej]) L.map.set(p.i + "," + p.j, p);
    L.tot = L.panels.reduce((a, p) => a + p.t, 0); L.ore = L.panels.reduce((a, p) => a + p.t * p.frac, 0);
    L.minSF = L.panels.reduce((a, p) => Math.min(a, p.sf), Infinity);
  }
  if (P.dip0 < 0.25) for (let t = 0.15; t <= 1; t += 0.05) { const x = PORTAL.x + (E1.x - PORTAL.x) * t, y = PORTAL.y + (E1.y - PORTAL.y) * t; if (terrainZ(x, y) < zP) { warn.push("진입 수평갱이 지표 밖으로 드러나는 구간이 있음 (계곡 횡단)"); break; } }
  return { S, H, Pw, all, levels: all.filter(L => L.panels.length), INC, PORTAL, warn, R, aboveT: aboveV * P.rho };
}

// ── 7. 일정: 월 단위, 작업장 배정 ──
const jobProg = (j, t) => j.start === null ? 0 : clamp((t - j.start) * P.rate / j.len, 0, 1);
function schedule(D, P) {
  const seq = D.levels, I = D.INC, trig = P.trig / 100, years = [], rate = P.frate * 1e3;
  const yr = y => years[y] || (years[y] = { y, cal: P.y0 + y, t: 0, ore: 0, lv: new Float64Array(seq.length), dev: 0, cf: 0, target: 0, opened: [], faces: 0, months: 0 });
  for (const L of D.all) L.no = null;
  seq.forEach((L, k) => {
    L.seq = k; L.no = k + 1; L.name = `${k + 1}편(EL.${Math.round(L.zf)})`; L.rem = L.tot; L.ptr = 0; L.access = null; L.ready = Infinity; L.first = null; L.last = null; L.opened = null;
    for (const p of L.panels) { p.s0 = null; p.s1 = null; p.done = 0; if (p.blk) p.blk.paid = false; }
  });
  const jobs = seq.map((L, k) => k ? { kind: "incline", k, a: seq[k - 1].J, b: L.J, len: Math.hypot(Math.hypot(L.J.x - seq[k - 1].J.x, L.J.y - seq[k - 1].J.y), seq[k - 1].zf - L.zf) + L.xc, start: null }
                                   : { kind: I.dip0 > 0.25 ? "incline" : "adit", k, a: I.PORTAL, b: L.J, len: I.len0 + Math.hypot(Math.hypot(L.J.x - I.J0.x, L.J.y - I.J0.y), I.J0.z - L.zf), start: null });
  const open = (k, m) => { const j = jobs[k]; j.start = m; seq[k].opened = m; seq[k].access = m + j.len / P.rate; seq[k].ready = seq[k].access + P.lead; if (k) yr(Math.floor(m / 12)).opened.push(k + 1); };
  if (seq.length) open(0, 0);
  const devTot = jobs.reduce((a, j) => a + j.len, 0), start = seq.length ? Math.ceil(seq[0].ready) : 0, r = P.disc / 100;
  let npv = -P.capex * 1e8, left = seq.reduce((a, L) => a + L.tot, 0), idle = 0;
  for (let m = 0; m < 12 * 100; m++) {
    const Y = yr(Math.floor(m / 12));
    let devM = 0; for (const j of jobs) if (j.start !== null) devM += Math.max(0, Math.min(m + 1, j.start + j.len / P.rate) - Math.max(m, j.start)) * P.rate;
    Y.dev += devM; let cf = -devM * P.devc * 1e4, got = 0;
    if (m >= start && left > 1) {
      let target = P.ann * 1e4 / 12; Y.target += target;
      const openL = seq.filter(L => L.ready <= m && L.rem > 1), busy = new Set();
      for (const L of openL) while (L.ptr < L.panels.length && L.panels[L.ptr].s1 !== null) L.ptr++;
      // 작업장 하나 = 판넬 하나. 캐던 판넬은 그 작업장이 이어서 캐고, 끝나면 위 편부터 진입점 쪽 옆 판넬이 끝난 새 판넬로 옮긴다
      const partial = []; for (const L of openL) for (let q = L.ptr; q < L.panels.length; q++) { const p = L.panels[q]; if (p.s1 === null && p.done > 0) partial.push(p); }
      // 지금 열려 있는 판넬이 없으면, 이번 달 안에 옆 판넬이 끝나는 가장 이른 판넬을 그 시각부터 캔다
      const next = tn => { let late = null; for (const L of openL) for (let q = L.ptr; q < L.panels.length; q++) { const p = L.panels[q]; if (p.s1 !== null || p.done > 0 || busy.has(p) || (p.pre && p.pre.s1 === null)) continue; const ta = p.pre ? p.pre.s1 : 0; if (ta <= tn + 1e-9) return p; if (!late || ta < late.pre.s1) late = p; } return late; };
      let nf = 0;
      for (let f = 0; f < P.nface && target > 1; f++) {
        let cap = rate, worked = false, cur = partial[f] || null;
        while (cap > 1 && target > 1) {
          const p = cur || next(m + (rate - cap) / rate); cur = null; if (!p) break; busy.add(p);
          if (p.done === 0 && p.pre && p.pre.s1 > m + (rate - cap) / rate) cap = rate * (m + 1 - p.pre.s1);
          if (cap <= 1) break; const L = p.L, d = Math.min(cap, p.t - p.done, target);
          if (p.s0 === null) { p.s0 = m + (rate - cap) / rate; if (L.first === null) L.first = p.s0; if (p.blk && !p.blk.paid) { p.blk.paid = true; cf -= p.blk.drive * P.dcost * 1e4; Y.dev += p.blk.drive; } }
          p.done += d; cap -= d; target -= d; got += d; worked = true;
          Y.t += d; Y.ore += d * p.frac; Y.lv[L.seq] += d; L.rem -= d; left -= d; cf += d * (p.frac * P.price - p.cost);
          if (p.done >= p.t - 1e-6) { p.s1 = m + (rate - cap) / rate; L.last = p.s1; } else break;
        }
        if (worked) nf++;
      }
      if (got > 0) { Y.faces += nf; Y.months++; }
    }
    idle = got > 0 ? 0 : idle + 1;
    Y.cf += cf; npv += cf / Math.pow(1 + r, (m + 0.5) / 12);
    const kl = jobs.reduce((a, j) => j.start !== null ? j.k : a, -1), Lk = seq[kl];
    if (Lk && kl + 1 < seq.length && Lk.access <= m + 1 && Lk.tot - Lk.rem >= trig * Lk.tot - 1) open(kl + 1, m + 1);
    if (left <= 1 && jobs.every(j => j.start !== null && j.start + j.len / P.rate <= m + 1)) break;
    if (idle > 240 && m > start) break;
  }
  let lastP = start; for (const L of seq) for (const p of L.panels) if (p.s1 !== null) lastP = Math.max(lastP, p.s1);
  const ys = []; for (let i = 0; i <= Math.floor((lastP - 1e-6) / 12); i++) ys.push(yr(i));
  if (ys.length) ys[0].cf -= P.capex * 1e8;
  let c = 0, pay = null; ys.forEach(Y => { const prev = c; c += Y.cf; Y.cum = c; if (pay === null && prev < 0 && c >= 0) pay = Y.cal; });
  return { seq, years: ys, start, end: lastP, devTot, npv, pay, jobs, mined: seq.reduce((a, L) => a + L.tot - Math.max(0, L.rem), 0) };
}
