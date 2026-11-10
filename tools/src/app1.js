"use strict";
// ── 0. 공통 ──
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v, d = 0) => v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
const cssv = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const ROLES = [["none", "안 씀"], ["terrain", "지형"], ["ore", "광체"], ["claim", "광구 경계"], ["cad", "지적 경계"]];

// ── 1. DXF 읽기 ──
function decodeBuf(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { try { return new TextDecoder("euc-kr").decode(buf); } catch (e2) { return new TextDecoder().decode(buf); } }
}
function parseDXF(text, file) {
  if (text.startsWith("AutoCAD Binary DXF")) throw new Error("바이너리 DXF는 읽을 수 없습니다. 글자(ASCII) DXF로 다시 저장해 주세요.");
  const L = text.split(/\r\n|\r|\n/), layers = new Map(), skipped = {};
  const lay = n => { n = (n || "0").trim(); let o = layers.get(n); if (!o) { o = { name: n, file, faces: [], lines: [], points: [] }; layers.set(n, o); } return o; };
  let sec = null, sawSec = false, ent = null, poly = null, nEnt = 0;
  const fin = () => {
    const e = ent; ent = null; if (!e) return; const c = e.c, g = k => c[k] || 0; nEnt++;
    switch (e.t) {
      case "3DFACE": {
        const F = lay(e.l).faces, p = [0, 1, 2, 3].map(k => [g(10 + k), g(20 + k), g(30 + k)]);
        const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        F.push(...p[0], ...p[1], ...p[2]);
        if (c[13] !== undefined && !same(p[3], p[2]) && !same(p[3], p[0])) F.push(...p[0], ...p[2], ...p[3]);
        break;
      }
      case "LINE": lay(e.l).lines.push({ pts: [[g(10), g(20), g(30)], [g(11), g(21), g(31)]], closed: false }); break;
      case "POINT": lay(e.l).points.push([g(10), g(20), g(30)]); break;
      case "LWPOLYLINE": { const z = g(38), pts = e.xs.map((x, k) => [x, e.ys[k] || 0, z]); if (pts.length > 1) lay(e.l).lines.push({ pts, closed: !!(g(70) & 1) }); break; }
      case "POLYLINE": poly = { l: e.l, f: g(70), z: g(30), m: g(71), n: g(72), v: [], fc: [] }; break;
      case "VERTEX": if (poly) { const f = g(70); if ((f & 128) && !(f & 64)) poly.fc.push([g(71), g(72), g(73), g(74)]); else poly.v.push([g(10), g(20), (poly.f & 88) ? g(30) : poly.z]); } break;
      case "SEQEND": if (poly) {
        const o = lay(poly.l), v = poly.v;
        if (poly.f & 64) { for (const f of poly.fc) { const q = f.map(k => v[Math.abs(k) - 1]).filter(Boolean); if (q.length >= 3) { o.faces.push(...q[0], ...q[1], ...q[2]); if (q.length === 4) o.faces.push(...q[0], ...q[2], ...q[3]); } } }
        else if (poly.f & 16) { const Mm = poly.m, Nn = poly.n; for (let a = 0; a < Mm - 1; a++) for (let b = 0; b < Nn - 1; b++) { const p00 = v[a * Nn + b], p01 = v[a * Nn + b + 1], p10 = v[(a + 1) * Nn + b], p11 = v[(a + 1) * Nn + b + 1]; if (p00 && p01 && p10 && p11) o.faces.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01); } }
        else if (v.length > 1) o.lines.push({ pts: v, closed: !!(poly.f & 1) });
        poly = null;
      } break;
      default: nEnt--; skipped[e.t] = (skipped[e.t] || 0) + 1;
    }
  };
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = parseInt(L[i], 10), val = L[i + 1];
    if (code === 0) {
      fin(); const t = val.trim().toUpperCase();
      if (t === "SECTION") { sawSec = true; sec = "?"; continue; }
      if (t === "ENDSEC") { sec = null; continue; }
      if (t === "EOF") break;
      if (sawSec && sec !== "ENTITIES") continue;
      ent = { t, l: "0", c: {}, xs: [], ys: [] };
    } else if (code === 2 && sec === "?") sec = val.trim().toUpperCase();
    else if (ent) {
      if (code === 8) ent.l = val;
      else if (ent.t === "LWPOLYLINE" && code === 10) ent.xs.push(+val);
      else if (ent.t === "LWPOLYLINE" && code === 20) ent.ys.push(+val);
      else if ((code >= 10 && code <= 39) || (code >= 70 && code <= 74) || code === 90) ent.c[code] = +val;
    }
  }
  fin();
  return { layers: [...layers.values()], skipped, nEnt };
}
function layerStats(l) {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  const add = (x, y, z) => { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z; };
  for (let i = 0; i < l.faces.length; i += 3) add(l.faces[i], l.faces[i + 1], l.faces[i + 2]);
  for (const ln of l.lines) for (const p of ln.pts) add(p[0], p[1], p[2]);
  for (const p of l.points) add(p[0], p[1], p[2]);
  l.bbox = b; l.nf = l.faces.length / 9; l.nl = l.lines.length; l.np = l.points.length; l.closed = l.lines.filter(q => q.closed).length;
}
function guessRoles(layers, others = []) {
  const faceL = layers.filter(l => l.nf > 0), area = l => (l.bbox.x1 - l.bbox.x0) * (l.bbox.y1 - l.bbox.y0);
  for (const l of layers) {
    const n = l.name.toUpperCase(), zr = l.bbox.z1 - l.bbox.z0;
    if (/광구|CLAIM|LEASE|TENEMENT|MINING.?RIGHT/.test(n)) l.role = "claim";
    else if (/지적|필지|CADAS|PARCEL|LOT/.test(n)) l.role = "cad";
    else if (/광체|ORE|BODY|LIME|석회|SOLID/.test(n) && l.nf) l.role = "ore";
    else if (/지형|TOPO|DEM|SURF|등고|CONT|TERRAIN|표고/.test(n) && (l.nf || zr > 1)) l.role = "terrain";
    else if (l.nf) l.role = null;
    else if (l.nl >= 5 && zr > 5) l.role = "terrain";
    else if (l.closed >= 3 && zr < 1) l.role = "cad";
    else l.role = "none";
  }
  const und = faceL.filter(l => l.role === null);                       // 이름으로 못 가린 면 레이어: 가장 넓은 것이 지형
  if (und.length) {
    const hasT = [...layers, ...others].some(l => l.role === "terrain"), hasO = others.some(l => l.role === "ore" && l.nf), big = und.reduce((a, l) => area(l) > area(a) ? l : a);
    for (const l of und) l.role = (!hasT && (und.length > 1 || hasO) && l === big) ? "terrain" : "ore";
  }
}

// ── 2. 예시 자료: DXF 글을 만들어 같은 읽기 경로로 넣는다 ──
function demoDXF() {
  const E0 = 215000, N0 = 412000, out = ["0", "SECTION", "2", "ENTITIES"], f = v => v.toFixed(2);
  const tz = (x, y) => { const g = Math.exp(-0.5 * (((x - 640) / 380) ** 2 + ((y - 560) / 300) ** 2)); return 250 + 250 * g + 22 * Math.sin(x / 150 + 0.7) * Math.cos(y / 190 - 0.3) + 12 * Math.sin((x + y) / 95); };
  const face = (lay, a, b, c) => out.push("0", "3DFACE", "8", lay, "10", f(a[0] + E0), "20", f(a[1] + N0), "30", f(a[2]), "11", f(b[0] + E0), "21", f(b[1] + N0), "31", f(b[2]), "12", f(c[0] + E0), "22", f(c[1] + N0), "32", f(c[2]), "13", f(c[0] + E0), "23", f(c[1] + N0), "33", f(c[2]));
  const pl = (lay, pts) => { out.push("0", "LWPOLYLINE", "8", lay, "90", String(pts.length), "70", "1", "38", "0.00"); for (const p of pts) out.push("10", f(p[0] + E0), "20", f(p[1] + N0)); };
  for (let i = 0; i < 60; i++) for (let j = 0; j < 50; j++) {             // 지형 20m 삼각망
    const q = (a, b) => [a * 20, b * 20, tz(a * 20, b * 20)], p00 = q(i, j), p10 = q(i + 1, j), p11 = q(i + 1, j + 1), p01 = q(i, j + 1);
    face("지형_TOPO", p00, p10, p11); face("지형_TOPO", p00, p11, p01);
  }
  // 광체: 남동으로 16° 기운 렌즈 모양 석회석 솔리드(닫힌 삼각망)
  const C = [660, 470], zc = 320, d = [Math.sin(2 * Math.PI / 3), Math.cos(2 * Math.PI / 3)], s = [0.5, Math.sqrt(3) / 2], a = 340, b = 300, nr = 14, nt = 48, td = Math.tan(16 * Math.PI / 180);
  const pt = (k, t, sg) => { const r = k / nr, th = 2 * Math.PI * t / nt, u = a * r * Math.cos(th), v = b * r * Math.sin(th), mid = zc - u * td + 6 * Math.sin(v / 80), tk = 56 * (1 - r ** 4) * (1 + 0.12 * Math.sin(u / 90)); return [C[0] + u * d[0] + v * s[0], C[1] + u * d[1] + v * s[1], mid + sg * tk / 2]; };
  for (const sg of [1, -1]) for (let t = 0; t < nt; t++) {
    const tri = (p, q, r) => sg > 0 ? face("광체_ORE", p, q, r) : face("광체_ORE", p, r, q);
    tri(pt(0, 0, sg), pt(1, t, sg), pt(1, t + 1, sg));
    for (let k = 1; k < nr; k++) { tri(pt(k, t, sg), pt(k + 1, t, sg), pt(k + 1, t + 1, sg)); tri(pt(k, t, sg), pt(k + 1, t + 1, sg), pt(k, t + 1, sg)); }
  }
  pl("광구경계", [[100, 80], [1150, 80], [1150, 940], [100, 940]]);
  let sd = 7; const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const gx = [0, 240, 480, 720, 960, 1200], gy = [0, 250, 500, 750, 1000], cr = gx.map((x, i) => gy.map((y, j) => [x + (i && i < 5 ? (rnd() - 0.5) * 80 : 0), y + (j && j < 4 ? (rnd() - 0.5) * 80 : 0)]));
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) pl("지적경계", [cr[i][j], cr[i + 1][j], cr[i + 1][j + 1], cr[i][j + 1]]);
  out.push("0", "ENDSEC", "0", "EOF"); return out.join("\n");
}

// ── 3. 자료 → 지형 격자 · 광체 · 경계 ──
let LAYERS = [], G = null, ORE = null, CLAIM = [], CAD = [], VB = null, DATAVER = 0, DATAMSG = [];
const bbU = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
function buildTerrain(src, R) {
  const ext = Math.max(R.x1 - R.x0, R.y1 - R.y0), d = Math.max(2, Math.ceil(ext / 260)), nx = Math.ceil((R.x1 - R.x0) / d) + 1, ny = Math.ceil((R.y1 - R.y0) / d) + 1;
  const z = new Float32Array(nx * ny).fill(NaN), sum = new Float64Array(nx * ny), cnt = new Uint32Array(nx * ny);
  for (const l of src) {
    const F = l.faces;
    for (let t = 0; t < F.length; t += 9) {
      const ax = F[t], ay = F[t + 1], az = F[t + 2], bx = F[t + 3], by = F[t + 4], bz = F[t + 5], cx = F[t + 6], cy = F[t + 7], cz = F[t + 8];
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - R.x0) / d)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - R.x0) / d));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - R.y0) / d)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - R.y0) / d));
      if (i0 > i1 || j0 > j1) continue; const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-12) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = R.x0 + i * d, py = R.y0 + j * d, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue; const zz = l1 * az + l2 * bz + l3 * cz, k = j * nx + i; if (isNaN(z[k]) || zz > z[k]) z[k] = zz;
      }
    }
    const add = (x, y, zz) => { const i = Math.round((x - R.x0) / d), j = Math.round((y - R.y0) / d); if (i < 0 || j < 0 || i >= nx || j >= ny) return; sum[j * nx + i] += zz; cnt[j * nx + i]++; };
    if (l.bbox.z1 - l.bbox.z0 > 0.5 || l.np) {
      for (const ln of l.lines) for (let q = 0; q < ln.pts.length - (ln.closed ? 0 : 1); q++) {
        const p = ln.pts[q], r = ln.pts[(q + 1) % ln.pts.length], n = Math.max(1, Math.ceil(Math.hypot(r[0] - p[0], r[1] - p[1]) / d));
        for (let s = 0; s <= n; s++) add(p[0] + (r[0] - p[0]) * s / n, p[1] + (r[1] - p[1]) * s / n, p[2] + (r[2] - p[2]) * s / n);
      }
      for (const p of l.points) add(p[0], p[1], p[2]);
    }
  }
  let have = 0; for (let k = 0; k < z.length; k++) { if (isNaN(z[k]) && cnt[k]) z[k] = sum[k] / cnt[k]; if (!isNaN(z[k])) have++; }
  if (!have) return null;
  const out = z.slice(), D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {                 // 빈 칸: 8방향 가장 가까운 값을 거리 역제곱으로
    if (!isNaN(z[j * nx + i])) continue; let w = 0, s = 0;
    for (const [di, dj] of D8) for (let r = 1; r <= 80; r++) { const a = i + di * r, b = j + dj * r; if (a < 0 || b < 0 || a >= nx || b >= ny) break; const v = z[b * nx + a]; if (!isNaN(v)) { const dd = r * r * (di && dj ? 2 : 1); w += 1 / dd; s += v / dd; break; } }
    if (w) out[j * nx + i] = s / w;
  }
  for (let pass = 0; pass < nx + ny; pass++) {                                // 그래도 빈 칸: 옆 칸 평균으로 번짐
    let left = 0; const prev = out.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { if (!isNaN(prev[j * nx + i])) continue; let s = 0, n = 0; for (const [di, dj] of D8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const v = prev[b * nx + a]; if (!isNaN(v)) { s += v; n++; } } if (n) out[j * nx + i] = s / n; else left++; }
    if (!left) break;
  }
  let zmin = Infinity, zmax = -Infinity; for (const v of out) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  return { x0: R.x0, y0: R.y0, d, nx, ny, z: out, zmin, zmax, cover: have / z.length };
}
function terrainZ(x, y) {
  const g = G, fi = clamp((x - g.x0) / g.d, 0, g.nx - 1.001), fj = clamp((y - g.y0) / g.d, 0, g.ny - 1.001), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, Z = (ii, jj) => g.z[jj * g.nx + ii];
  return Z(i, j) * (1 - a) * (1 - b) + Z(i + 1, j) * a * (1 - b) + Z(i, j + 1) * (1 - a) * b + Z(i + 1, j + 1) * a * b;
}
function applyData() {
  DATAMSG = [];
  const by = r => LAYERS.filter(l => l.role === r), oreL = by("ore").filter(l => l.nf), terL = by("terrain");
  const poly = r => { const o = []; for (const l of by(r)) for (const ln of l.lines) if (ln.pts.length > 2) o.push({ pts: ln.pts.map(p => [p[0], p[1]]), closed: ln.closed }); return o; };
  CLAIM = poly("claim").map(p => p.pts); CAD = poly("cad"); DATAVER++;
  if (!oreL.length) {                                                         // 광체가 아직 없으면 지형·경계만 보여 준다
    ORE = null; DATAMSG.push("광체로 쓸 면(3DFACE·폴리페이스) 레이어가 없습니다. 광체 DXF를 더 올리거나, 레이어의 쓰임을 「광체」로 골라 주세요.");
    let R0 = null; for (const l of [...terL, ...by("claim"), ...by("cad")]) R0 = R0 ? bbU(R0, l.bbox) : { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 };
    if (!R0) { VB = null; G = null; return false; }
    VB = R0; G = terL.length ? buildTerrain(terL, R0) : null; return false;
  }
  // 광체 레이어 하나 = 솔리드 하나. 솔리드마다 따로 구간을 구해 합치므로, 서로 맞닿거나 겹친 솔리드도 한 광체로 이어진다
  const ob = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity }, solids = []; let n = 0;
  for (const l of oreL) {
    const sd = solidOf(l.faces); if (!sd.tris.length) continue; sd.name = l.name; solids.push(sd); n += sd.tris.length;
    ob.x0 = Math.min(ob.x0, sd.bbox.x0); ob.x1 = Math.max(ob.x1, sd.bbox.x1); ob.y0 = Math.min(ob.y0, sd.bbox.y0); ob.y1 = Math.max(ob.y1, sd.bbox.y1); ob.z0 = Math.min(ob.z0, sd.bbox.z0); ob.z1 = Math.max(ob.z1, sd.bbox.z1);
  }
  const tris = new Float64Array(n); n = 0; for (const sd of solids) { tris.set(sd.tris, n); n += sd.tris.length; }
  ORE = { tris, solids, bbox: ob, volSigned: solids.reduce((a, sd) => a + sd.vol, 0), n: tris.length / 9, open: solids.reduce((a, sd) => a + sd.open, 0) };
  let R = { x0: ob.x0, y0: ob.y0, x1: ob.x1, y1: ob.y1 }; for (const pg of CLAIM) for (const p of pg) R = bbU(R, { x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  const mg = Math.max(60, 0.12 * Math.max(R.x1 - R.x0, R.y1 - R.y0)); VB = { x0: R.x0 - mg, y0: R.y0 - mg, x1: R.x1 + mg, y1: R.y1 + mg };
  const TR = { x0: VB.x0 - mg, y0: VB.y0 - mg, x1: VB.x1 + mg, y1: VB.y1 + mg };
  G = terL.length ? buildTerrain(terL, TR) : null;
  if (!G) {
    DATAMSG.push(terL.length ? "지형 레이어에 표고(Z)가 있는 면·등고선·점이 광체 주변에 없습니다. 광체 꼭대기 위 50m 평지로 대신했습니다." : "지형 레이어가 없어 광체 꼭대기 위 50m 평지로 대신했습니다.");
    G = { x0: TR.x0, y0: TR.y0, d: (TR.x1 - TR.x0), nx: 2, ny: 2, z: new Float32Array(4).fill(ob.z1 + 50), zmin: ob.z1 + 50, zmax: ob.z1 + 50, cover: 0, flat: true }; G.d = Math.max(TR.x1 - TR.x0, TR.y1 - TR.y0);
  } else { let tb = null; for (const l of terL) tb = tb ? bbU(tb, l.bbox) : { ...l.bbox }; if (ob.x0 < tb.x0 || ob.x1 > tb.x1 || ob.y0 < tb.y0 || ob.y1 > tb.y1) DATAMSG.push("광체 일부가 지형 자료 범위 밖에 있습니다. 그 부분의 지표는 가장 가까운 값으로 메웠습니다. 좌표계가 같은지 확인하세요."); }
  // 광체 평면 분포의 긴 축(주향 근사)
  let mx = 0, my = 0, nv = 0; for (let t = 0; t < tris.length; t += 3) { mx += tris[t]; my += tris[t + 1]; nv++; } mx /= nv; my /= nv;
  let cxx = 0, cyy = 0, cxy = 0; for (let t = 0; t < tris.length; t += 3) { cxx += (tris[t] - mx) ** 2; cyy += (tris[t + 1] - my) ** 2; cxy += (tris[t] - mx) * (tris[t + 1] - my); }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); ORE.axisAz = Math.atan2(Math.cos(th), Math.sin(th)); ORE.cx = mx; ORE.cy = my;
  return true;
}
// 솔리드 하나 준비: 찌그러진 면 버리기, 면 방향을 이웃끼리 맞춰 체적 구하기, 수직선 조회용 칸 나눔
function solidOf(F) {
  const keep = [], b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  const vid = new Map(); let nv = 0; const idOf = (x, y, z) => { const k = Math.round(x * 1000) + "," + Math.round(y * 1000) + "," + Math.round(z * 1000); let v = vid.get(k); if (v === undefined) { v = nv++; vid.set(k, v); } return v; };
  const V = [];
  for (let t = 0; t < F.length; t += 9) {
    const a = idOf(F[t], F[t + 1], F[t + 2]), c = idOf(F[t + 3], F[t + 4], F[t + 5]), d = idOf(F[t + 6], F[t + 7], F[t + 8]); if (a === c || c === d || a === d) continue;
    keep.push(t); V.push(a, c, d);
    for (let k = 0; k < 9; k += 3) { const x = F[t + k], y = F[t + k + 1], z = F[t + k + 2]; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z; }
  }
  const nt = keep.length, tris = new Float64Array(nt * 9); keep.forEach((t, k) => { for (let q = 0; q < 9; q++) tris[k * 9 + q] = F[t + q]; });
  // 모서리 → 그 모서리를 쓰는 면들
  const E = new Map(); for (let k = 0; k < nt; k++) for (let e = 0; e < 3; e++) { const p = V[k * 3 + e], q = V[k * 3 + (e + 1) % 3], key = p < q ? p * nv + q : q * nv + p; let a = E.get(key); if (!a) E.set(key, a = []); a.push(k * 3 + e); }
  let open = 0; for (const a of E.values()) if (a.length === 1) open++;
  // 이웃 면과 모서리 방향이 반대가 되도록 뒤집어 가며 번짐(면 방향 통일). 덩어리마다 부호 체적을 구해 절댓값을 더한다
  const flip = new Uint8Array(nt), seen = new Uint8Array(nt), ox = (b.x0 + b.x1) / 2, oy = (b.y0 + b.y1) / 2, oz = (b.z0 + b.z1) / 2; let vol = 0;
  const dir = (k, e) => { const p = V[k * 3 + e], q = V[k * 3 + (e + 1) % 3]; return flip[k] ? [q, p] : [p, q]; };
  for (let s0 = 0; s0 < nt; s0++) {
    if (seen[s0]) continue; const st = [s0]; seen[s0] = 1; let v6 = 0;
    while (st.length) {
      const k = st.pop(), o = k * 9, sg = flip[k] ? -1 : 1;
      const ax = tris[o] - ox, ay = tris[o + 1] - oy, az = tris[o + 2] - oz, bx = tris[o + 3] - ox, by = tris[o + 4] - oy, bz = tris[o + 5] - oz, cx = tris[o + 6] - ox, cy = tris[o + 7] - oy, cz = tris[o + 8] - oz;
      v6 += sg * (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx));
      for (let e = 0; e < 3; e++) {
        const p = V[k * 3 + e], q = V[k * 3 + (e + 1) % 3], a = E.get(p < q ? p * nv + q : q * nv + p); if (a.length !== 2) continue;
        const other = a[0] === k * 3 + e ? a[1] : a[0], k2 = Math.floor(other / 3), e2 = other % 3; if (seen[k2]) continue;
        const d1 = dir(k, e), p2 = V[k2 * 3 + e2]; if (p2 === d1[0]) flip[k2] = 1; seen[k2] = 1; st.push(k2);
      }
    }
    vol += Math.abs(v6) / 6;
  }
  const nb = 48, bw = Math.max(1e-6, (b.x1 - b.x0) / nb), bh = Math.max(1e-6, (b.y1 - b.y0) / nb), bins = new Array(nb * nb);
  for (let t = 0; t < tris.length; t += 9) {
    const i0 = clamp(Math.floor((Math.min(tris[t], tris[t + 3], tris[t + 6]) - b.x0) / bw), 0, nb - 1), i1 = clamp(Math.floor((Math.max(tris[t], tris[t + 3], tris[t + 6]) - b.x0) / bw), 0, nb - 1);
    const j0 = clamp(Math.floor((Math.min(tris[t + 1], tris[t + 4], tris[t + 7]) - b.y0) / bh), 0, nb - 1), j1 = clamp(Math.floor((Math.max(tris[t + 1], tris[t + 4], tris[t + 7]) - b.y0) / bh), 0, nb - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (bins[j * nb + i] || (bins[j * nb + i] = [])).push(t);
  }
  return { tris, bbox: b, vol, open, bins, nb, bw, bh };
}
// 구간 목록 [아래, 위] 여러 개를 합친다(맞닿거나 겹치면 하나로)
function mergeIv(pairs) {
  if (pairs.length < 2) return pairs.length ? [pairs[0][0], pairs[0][1]] : []; pairs.sort((p, q) => p[0] - q[0]); const out = [pairs[0][0], pairs[0][1]];
  for (let k = 1; k < pairs.length; k++) { const [lo, hi] = pairs[k]; if (lo <= out[out.length - 1] + 0.05) { if (hi > out[out.length - 1]) out[out.length - 1] = hi; } else out.push(lo, hi); }
  return out;
}
// 한 지점의 수직선이 광체와 만나는 구간 [아래, 위, 아래, 위 …] (솔리드별로 구해 합치고, 지표 위는 잘라 냄)
function oreAt(x, y) {
  const pairs = [];
  for (const o of ORE.solids) {
    const i = Math.floor((x - o.bbox.x0) / o.bw), j = Math.floor((y - o.bbox.y0) / o.bh); if (i < 0 || j < 0 || i >= o.nb || j >= o.nb) continue;
    const b = o.bins[j * o.nb + i]; if (!b) continue; const T = o.tris, zs = [];
    for (const t of b) {
      const ax = T[t], ay = T[t + 1], bx = T[t + 3], by = T[t + 4], cx = T[t + 6], cy = T[t + 7], det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-12) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det, l3 = 1 - l1 - l2; if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      zs.push(l1 * T[t + 2] + l2 * T[t + 5] + l3 * T[t + 8]);
    }
    zs.sort((p, q) => p - q); const u = []; for (const z of zs) if (!u.length || z - u[u.length - 1] > 1e-6) u.push(z); if (u.length % 2) u.pop();
    for (let q = 0; q < u.length; q += 2) pairs.push([u[q], u[q + 1]]);
  }
  const m = mergeIv(pairs), tz = terrainZ(x, y), out = []; for (let q = 0; q < m.length; q += 2) { const hi = Math.min(m[q + 1], tz); if (hi > m[q]) out.push(m[q], hi); } return out;
}
