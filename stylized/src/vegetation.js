import * as THREE from 'three';
import { Rng, compose, hash12, smoothstep, tube } from './utils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE, groundY, onStairs, inPlanter, stepInfo, slabTop, bayX } from './layout.js';
import { inMainBuilding, inWing, fromWingLocal, WING } from './banyan.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _m = new THREE.Matrix4();

// ====================================================================== 实例化工具
export function instanced(geo, mat, items, { cast = true, receive = true, atlas = false } = {}) {
  const g = geo.clone();
  const n = items.length;
  const nrm = new Float32Array(n * 3);
  const atl = atlas ? new Float32Array(n * 2) : null;
  const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, n));
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const it = items[i];
    compose([it.p.x, it.p.y, it.p.z], it.r || [0, 0, 0], it.s ?? 1, _m);
    mesh.setMatrixAt(i, _m);
    const nn = it.n || UP;
    nrm[i * 3] = nn.x;
    nrm[i * 3 + 1] = nn.y;
    nrm[i * 3 + 2] = nn.z;
    mesh.setColorAt(i, it.c || col.setRGB(1, 1, 1));
    if (atl) {
      atl[i * 2] = it.a[0];
      atl[i * 2 + 1] = it.a[1];
    }
  }
  mesh.count = n;
  g.setAttribute('aNormalW', new THREE.InstancedBufferAttribute(nrm, 3));
  if (atl) g.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atl, 2));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (mat.userData.depth) mesh.customDepthMaterial = mat.userData.depth;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox?.();
  return mesh;
}

// ====================================================================== 几何
function grassClumpGeometry(rng, blades = 10) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let vi = 0;
  for (let b = 0; b < blades; b++) {
    const ang = rng.r() * Math.PI * 2;
    const lean = rng.range(0.15, 0.65);
    const h = rng.range(0.55, 1.0);
    const w = rng.range(0.028, 0.05);
    const r0 = rng.range(0, 0.09);
    const bx = Math.cos(ang) * r0, bz = Math.sin(ang) * r0;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const twist = rng.range(-0.6, 0.6);
    const segs = 4;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = bx + dx * lean * h * t * t, cy = h * t * (1 - 0.25 * lean * t), cz = bz + dz * lean * h * t * t;
      const sa = ang + Math.PI / 2 + twist * t;
      const sx = Math.cos(sa), sz = Math.sin(sa);
      const ww = w * (1 - t * 0.92);
      pos.push(cx - sx * ww, cy, cz - sz * ww, cx + sx * ww, cy, cz + sz * ww);
      const nx = dx * 0.6, ny = 0.8, nz = dz * 0.6;
      nor.push(nx, ny, nz, nx, ny, nz);
      uv.push(0, t, 1, t);
      const k = Math.pow(t, 0.8);
      const cr = 0.3 + 0.8 * k, cg = 0.42 + 0.66 * k, cb = 0.55 + 0.25 * k;
      col.push(cr, cg, cb, cr, cg, cb);
      if (s < segs) {
        idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      }
      vi += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function fernGeometry(rng, fronds = 9) {
  const parts = [];
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const L = rng.range(0.75, 1.1);
    const lift = rng.range(0.35, 0.6);
    const segs = 6;
    const pos = [], nor = [], uv = [], idx = [];
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const sx = -dz, sz = dx;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = t * L * 0.85;
      const y = Math.sin(t * Math.PI * 0.75) * lift * L - t * t * 0.25 * L;
      const w = 0.17 * L;
      pos.push(dx * r - sx * w, y, dz * r - sz * w, dx * r + sx * w, y, dz * r + sz * w);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(0, t, 1, t);
      if (s < segs) {
        const v = s * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    parts.push(g);
  }
  // 手动合并
  let total = 0;
  parts.forEach((p) => (total += p.attributes.position.count));
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = [];
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    uv.set(p.attributes.uv.array, o * 2);
    for (const i of p.index.array) idx.push(i + o);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}


// ---------------------------------------------------------------- 野花几何（顶点色，uv.y 记录高度供风动加权）
function colored(g, hex, H) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    uv[i * 2 + 1] = Math.max(0, g.attributes.position.getY(i)) / H;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function stem(h, w = 0.016, hex = '#5d9a3a') {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return [colored(a, hex, h), colored(b, hex, h)];
}
// 薰衣草式的紫色花穗
function spikeGeometry(rng) {
  const H = 0.62;
  const parts = [...stem(0.5)];
  const lo = new THREE.Color('#6a3fc0'), hi = new THREE.Color('#c39cff');
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const g = new THREE.OctahedronGeometry(0.034 * (1 - t * 0.45));
    g.scale(1, 1.5, 1);
    g.translate(rng.range(-0.012, 0.012), 0.3 + k * 0.036, rng.range(-0.012, 0.012));
    parts.push(colored(g, '#' + lo.clone().lerp(hi, t).getHexString(), H));
  }
  return mergeGeometries(parts);
}
// 圆盘小花：花瓣盘 + 花心（雏菊 / 黄色小花）
function discFlowerGeometry({ r = 0.085, petals = 11, h = 0.36, petal = '#ffffff', heart = '#ffc93a' } = {}) {
  const H = h + 0.02;
  const disc = new THREE.CircleGeometry(r, petals * 2);
  const p = disc.attributes.position;
  for (let i = 1; i < p.count; i++) {
    const k = (i - 1) % 2 ? 0.55 : 1.0;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  disc.rotateX(-Math.PI / 2);
  disc.rotateZ(0.25);
  disc.translate(0, h, 0);
  const core = new THREE.CircleGeometry(r * 0.36, 10);
  core.rotateX(-Math.PI / 2);
  core.rotateZ(0.25);
  core.translate(0, h + 0.006, 0);
  return mergeGeometries([...stem(h), colored(disc, petal, H), colored(core, heart, H)]);
}

// ====================================================================== 主入口
export function buildVegetation({ noise, mats, banyan, bOut, wingOut, podOut, furn }) {
  const rng = new Rng(4242);
  const group = new THREE.Group();
  const PL = SITE.plaza;
  const B = SITE.B;

  // ---------------------------------------------------------------- 与地砖着色器一致的“荒野/破损”判定
  const paverInfo = (x, z, rect) => {
    const nAr = noise.sample(x * 0.11 + 0.37, z * 0.11 + 0.37, 0);
    const edgeD = Math.min(x - rect[0], rect[1] - x, z - rect[2], rect[3] - z);
    const wild = 1 - smoothstep(-1, 6, edgeD + (nAr - 0.5) * 9);
    const damage = smoothstep(0.55, 0.82, noise.sample(x * 0.021 + 0.3, z * 0.021 + 0.3, 0) + wild * 0.5);
    const TW = 1.2, TH = 0.6;
    const row = Math.floor(z / TH);
    const px = x + (((row % 2) + 2) % 2) * 0.6;
    const ci = Math.floor(px / TW);
    const fx = px - ci * TW, fz = z - row * TH;
    const hc2 = hash12(ci * 1.37 + 11.1, row * 1.37 + 11.1);
    const missing = hc2 < damage * 0.5 + wild * 0.75;
    return { wild, damage, missing, fx, fz, TW, TH };
  };
  const plazaRect = [PL.x0, PL.x1, -10, PL.z1];
  const podRect = [-38, 38, -60, 7];

  // ================================================================ 草
  const grass = [];
  const gcol = (dry = 0) => {
    const c = new THREE.Color();
    if (rng.chance(0.1 + dry)) c.setHSL(rng.range(0.14, 0.18), rng.range(0.6, 0.75), rng.range(0.3, 0.38));
    else c.setHSL(rng.range(0.22, 0.29), rng.range(0.6, 0.78), rng.range(0.22, 0.3));
    return c;
  };
  const addGrass = (x, y, z, s, dry = 0) => grass.push({ p: V(x, y, z), r: [rng.range(-0.15, 0.15), rng.range(0, 6.28), rng.range(-0.15, 0.15)], s: [s * rng.range(0.8, 1.2), s, s * rng.range(0.8, 1.2)], c: gcol(dry) });

  // 1) 广场：沿砖缝、破损处、边缘荒野
  for (let i = 0; i < 34000; i++) {
    let x = rng.range(-50, 50), z = rng.range(6.5, 58);
    if (Math.abs(x) < SITE.stairsHalf + 0.6 && z < SITE.stairsEnd + 0.1) continue;
    if (z < SITE.podiumFront + 0.05) continue;
    const pi = paverInfo(x, z, plazaRect);
    let p;
    if (pi.missing || pi.wild > 0.6) {
      p = 0.35 + pi.wild * 0.2;
    } else {
      const dx = Math.min(pi.fx, pi.TW - pi.fx), dz = Math.min(pi.fz, pi.TH - pi.fz);
      if (dx < dz) x += pi.fx < pi.TW / 2 ? -pi.fx : pi.TW - pi.fx;
      else z += pi.fz < pi.TH / 2 ? -pi.fz : pi.TH - pi.fz;
      p = 0.012 + pi.damage * 0.35 + pi.wild * 0.6;
      if (z < SITE.podiumFront + 0.9) p += 0.35;
    }
    if (!rng.chance(p)) continue;
    const big = pi.wild > 0.5 ? rng.range(0.6, 1.2) : pi.missing ? rng.range(0.4, 0.75) : rng.range(0.2, 0.45);
    addGrass(x, 0, z, big, pi.wild * 0.15);
  }
  // 2) 平台（架空层前、柱脚、楼侧）
  for (let i = 0; i < 18000; i++) {
    let x = rng.range(-46, 46), z = rng.range(-30, SITE.podiumFront - 0.2);
    const p3 = V(x, 3, z);
    if (inWing(p3, 0.05)) continue;
    const under = x > -17.5 && x < 17.5 && z < 0.45;
    if (under && z < B.zG + 0.2) continue;
    const pi = paverInfo(x, z, podRect);
    let p;
    if (pi.missing) p = 0.5;
    else {
      const dx = Math.min(pi.fx, pi.TW - pi.fx), dz = Math.min(pi.fz, pi.TH - pi.fz);
      if (dx < dz) x += pi.fx < pi.TW / 2 ? -pi.fx : pi.TW - pi.fx;
      else z += pi.fz < pi.TH / 2 ? -pi.fz : pi.TH - pi.fz;
      p = 0.02 + pi.damage * 0.3 + pi.wild * 0.6;
    }
    if (under) p *= 0.25;
    if (z > 0.35 && z < 1.3 && Math.abs(x) < 17.5) p += 0.35; // 楼脚
    if (z > SITE.podiumFront - 0.8) p += 0.25; // 挡墙压顶内侧
    if (Math.abs(x) > 17.5 && z < 0) p += 0.25; // 楼侧荒地
    const bd = Math.hypot(x - SITE.banyan.x, z - SITE.banyan.z);
    if (bd < 6) p += 0.25;
    if (bd < 2.4) continue;
    if (!rng.chance(p)) continue;
    addGrass(x, SITE.podiumY, z, pi.missing || Math.abs(x) > 18 ? rng.range(0.35, 0.8) : rng.range(0.18, 0.45));
  }
  // 3) 台阶：踏步后缘与两端
  for (let i = 0; i < SITE.nSteps; i++) {
    const { top, zBack, zFront } = stepInfo(i);
    for (let k = 0; k < 90; k++) {
      const x = rng.range(-SITE.stairsHalf + 0.05, SITE.stairsHalf - 0.05);
      if (Math.abs(x) < SITE.planterHalf + 0.05) continue;
      const edge = Math.min(Math.abs(Math.abs(x) - SITE.stairsHalf), Math.abs(Math.abs(x) - SITE.planterHalf));
      const p = 0.05 + (edge < 0.6 ? 0.55 : 0) + (i < 5 ? 0.06 : 0);
      if (!rng.chance(p)) continue;
      addGrass(x, top, zBack + rng.range(0.01, 0.07), rng.range(0.14, 0.36));
    }
  }
  for (const c of podOut.stepCracks) {
    for (let k = 0; k < 7; k++) addGrass(c.x + rng.range(-0.3, 0.3), c.y - 0.03, c.z + rng.range(-0.1, 0.1), rng.range(0.2, 0.45));
  }
  // 4) 花池
  for (let k = 0; k < 500; k++) {
    const x = rng.range(-1.4, 1.4), z = rng.range(SITE.podiumFront + 0.05, SITE.stairsEnd - 0.05);
    addGrass(x, groundY(x, z) - 0.02, z, rng.range(0.4, 1.0), 0.1);
  }
  // 5) 栏板压顶、缺口楼板边、树池
  for (const L of [...bOut.ledges, ...(wingOut ? [] : [])]) {
    for (let x = L.a + 0.2; x < L.b - 0.2; x += rng.range(0.4, 2.2)) {
      if (!rng.chance(0.4)) continue;
      addGrass(x, L.y, L.z + rng.range(-0.08, 0.08), rng.range(0.1, 0.26));
    }
  }
  for (const G of bOut.gapEdges) {
    for (let x = G.a + 0.2; x < G.b - 0.2; x += rng.range(0.2, 0.5)) addGrass(x, G.y, rng.range(-0.2, 0.15), rng.range(0.2, 0.55));
  }
  for (const t of furn.treePits) {
    for (let k = 0; k < 40; k++) addGrass(t.x + rng.range(-1.05, 1.05), 0.22, t.z + rng.range(-1.05, 1.05), rng.range(0.35, 0.8));
  }
  for (const r of bOut.rubble) {
    for (let k = 0; k < 18; k++) addGrass(r.x + rng.range(-r.r, r.r), r.y, r.z + rng.range(-r.r, r.r) * 0.6, rng.range(0.2, 0.5));
  }

  const grassMesh = instanced(grassClumpGeometry(new Rng(77), 9), mats.grass, grass, { cast: false });
  grassMesh.name = 'grass';
  group.add(grassMesh);

  // ================================================================ 蕨类
  const ferns = [];
  const addFern = (x, y, z, s) => {
    const c = new THREE.Color().setHSL(rng.range(0.24, 0.31), rng.range(0.6, 0.75), rng.range(0.26, 0.34));
    ferns.push({ p: V(x, y, z), r: [rng.range(-0.1, 0.1), rng.range(0, 6.28), rng.range(-0.1, 0.1)], s, c, n: UP });
  };
  for (let k = 0; k < 14; k++) {
    const a = rng.range(0, 6.28), r = rng.range(2.5, 5.5);
    const x = SITE.banyan.x + Math.cos(a) * r, z = SITE.banyan.z + Math.sin(a) * r;
    if (inMainBuilding(V(x, 3, z)) || z > SITE.podiumFront - 0.3) continue;
    addFern(x, SITE.podiumY, z, rng.range(0.7, 1.3));
  }
  for (let k = 0; k < 26; k++) {
    const x = rng.range(-30, 30);
    if (Math.abs(x) < SITE.stairsHalf + 0.8) continue;
    addFern(x, 0, SITE.podiumFront + rng.range(0.25, 0.7), rng.range(0.6, 1.2));
  }
  for (let i = 0; i <= B.bays; i++) {
    if (rng.chance(0.5)) addFern(bayX(i) + rng.range(-0.6, 0.6), SITE.podiumY, rng.range(0.6, 1.1), rng.range(0.5, 0.9));
  }
  for (let k = 0; k < 5; k++) {
    const z = rng.range(7, 11.4), x = rng.range(-1.0, 1.0);
    addFern(x, groundY(x, z) - 0.02, z, rng.range(0.8, 1.2));
  }
  for (const t of furn.treePits) for (let k = 0; k < 3; k++) addFern(t.x + rng.range(-0.8, 0.8), 0.22, t.z + rng.range(-0.8, 0.8), rng.range(0.6, 1.0));
  for (let k = 0; k < 40; k++) {
    const x = rng.sign() * rng.range(33, 46), z = rng.range(6, 50);
    addFern(x, 0, z, rng.range(0.8, 1.5));
  }
  const fernMesh = instanced(fernGeometry(new Rng(5)), mats.fern, ferns, { cast: true });
  group.add(fernMesh);

  // ================================================================ 灌木（叶片卡）
  const shrubCards = [];
  const shrub = (x, y, z, R, n, hue = null) => {
    const hb = hue ?? rng.range(0.21, 0.3);
    const sb = rng.range(0.58, 0.74), lb = rng.range(0.28, 0.36);
    const bloom = rng.chance(0.2) ? rng.range(0.25, 0.45) : 0;
    for (let i = 0; i < n; i++) {
      const u = rng.r() * Math.PI * 2, v = Math.acos(rng.range(-0.25, 1));
      const rr = R * Math.cbrt(rng.range(0.25, 1));
      const d = V(Math.sin(v) * Math.cos(u), Math.cos(v) * 0.75, Math.sin(v) * Math.sin(u));
      const p = V(x, y + R * 0.45, z).addScaledVector(d, rr);
      if (p.y < y + 0.05) p.y = y + 0.05 + rng.r() * 0.1;
      const lift = (0.72 + 0.4 * (rr / R)) * (0.85 + 0.25 * Math.max(0, d.y));
      const c = rng.chance(bloom) ? new THREE.Color().setHSL(rng.range(0.92, 0.95), 0.66, 0.46 * lift) : new THREE.Color().setHSL(hb + rng.range(-0.012, 0.012), sb, lb * lift);
      shrubCards.push({ p, n: d.clone().add(V(0, 0.4, 0)).normalize(), s: rng.range(0.55, 0.95) * Math.min(1.4, R * 0.7 + 0.4), r: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], c });
    }
  };
  for (let z = 7.2; z < 11.6; z += rng.range(0.9, 1.5)) shrub(rng.range(-0.4, 0.4), groundY(0, z), z, rng.range(0.7, 1.1), 26);
  for (const [x, z, R] of [[-19, 5.2, 1.4], [-24, 4.6, 1.8], [22, 5.0, 1.6], [27, 4.4, 1.3], [19.2, 2.2, 1.3], [-17.5, 1.8, 1.0], [11.2, 5.4, 0.9]]) shrub(x, SITE.podiumY, z, R, Math.round(R * 34));
  for (const [x, z, R] of [[-11.6, 7.4, 1.0], [-25, 7.3, 1.4], [14, 7.2, 1.1], [24, 7.6, 1.6], [-30, 9, 1.8], [30, 10, 2.0]]) shrub(x, 0, z, R, Math.round(R * 34));
  for (let k = 0; k < 36; k++) {
    const x = rng.sign() * rng.range(31, 48), z = rng.range(6.8, 55);
    shrub(x, 0, z, rng.range(1.0, 2.4), 42);
  }
  for (let k = 0; k < 12; k++) {
    const x = rng.range(-30, 30), z = rng.range(42, 56);
    shrub(x, 0, z, rng.range(1.2, 2.4), 42);
  }
  for (let k = 0; k < 10; k++) {
    const x = rng.sign() * rng.range(19, 40), z = rng.range(-28, -2);
    if (inWing(V(x, 3, z), 0.5)) continue;
    shrub(x, SITE.podiumY, z, rng.range(1.0, 2.0), 40);
  }
  // 塌落处的灌木
  shrub(16.2, slabTop(B.floors), -2.0, 0.9, 22);
  shrub(18.6, SITE.podiumY, 3.0, 1.2, 30);
  const shrubMesh = instanced(new THREE.PlaneGeometry(1, 1), mats.shrub, shrubCards);
  group.add(shrubMesh);

  // ================================================================ 藤蔓（栏板垂挂 / 柱攀爬 / 挡墙垂挂）
  const ivy = [];
  const ivyLeaf = (x, y, z, nrm, s, tilt = 0.4) => {
    const c = new THREE.Color().setHSL(rng.range(0.23, 0.31), rng.range(0.6, 0.75), rng.range(0.26, 0.34));
    if (rng.chance(0.08)) c.setHSL(rng.range(0.01, 0.05), 0.75, 0.32); // 零星红叶
    const yaw = Math.atan2(nrm.x, nrm.z);
    ivy.push({ p: V(x, y, z), n: nrm.clone().add(V(-0.35, 0.6, 0)).normalize(), s: s * rng.range(0.75, 1.2), r: [-tilt + rng.range(-0.35, 0.35), yaw + rng.range(-0.4, 0.4), rng.range(-0.6, 0.6), 'YXZ'], c });
  };
  const curtain = (xa, xb, yTop, zFace, maxLen, density = 1, normal = V(0, 0, 1)) => {
    const strands = Math.max(1, Math.round((xb - xa) * 5 * density));
    for (let s = 0; s < strands; s++) {
      const x0 = rng.range(xa, xb);
      const L = rng.range(0.4, maxLen) * (0.5 + 0.5 * Math.sin(((x0 - xa) / (xb - xa)) * Math.PI));
      // 压顶上方的几片
      for (let k = 0; k < 2; k++) ivyLeaf(x0 + rng.range(-0.15, 0.15), yTop + 0.05, zFace - rng.range(0, 0.25), V(0, 1, 0.3), 0.32, 1.2);
      const ph = rng.range(0, 6);
      for (let d = 0; d < L; d += rng.range(0.06, 0.11)) {
        const x = x0 + Math.sin(d * 1.3 + ph) * 0.12 + rng.range(-0.06, 0.06);
        ivyLeaf(x, yTop - d, zFace + 0.03 + rng.range(0, 0.1) + d * 0.015, normal, rng.range(0.32, 0.5));
      }
    }
  };
  for (let k = 1; k <= B.floors + 1; k++) {
    const yTop = slabTop(k) + B.parH + 0.07;
    for (let i = 0; i < B.bays; i++) {
      const xa = bayX(i) + 0.4, xb = bayX(i + 1) - 0.4;
      if (bOut.ledges.every((L) => !(Math.abs(L.y - yTop) < 0.01 && L.a <= xa && L.b >= xb))) continue;
      const nearTree = xa < -8;
      const p = nearTree ? 0.85 : i === B.bays - 1 ? 0.8 : 0.4;
      if (!rng.chance(p)) continue;
      const w = rng.range(1.0, xb - xa);
      const a = rng.range(xa, xb - w);
      curtain(a, a + w, yTop, 0.27, nearTree ? 4.2 : 2.8, nearTree ? 1.3 : 1);
    }
  }
  // 挡土墙垂挂
  for (let x = -44; x < 44; x += rng.range(1.5, 4.5)) {
    if (Math.abs(x) < SITE.stairsHalf + 0.6) continue;
    if (!rng.chance(0.55)) continue;
    const w = rng.range(0.8, 3.0);
    curtain(x, Math.min(x + w, x < 0 ? -SITE.stairsHalf - 0.6 : 44), SITE.podiumY + 0.1, SITE.podiumFront + 0.12, 2.3, 1.2);
  }
  // 柱身攀爬（爬山虎）
  for (let i = 0; i <= B.bays; i++) {
    if (!rng.chance(i < 3 ? 0.9 : 0.4)) continue;
    const x = bayX(i);
    const top = SITE.podiumY + rng.range(1.5, 4.2);
    for (let y = SITE.podiumY + 0.05; y < top; y += 0.07) {
      const face = rng.int(0, 2);
      const fade = 1 - (y - SITE.podiumY) / (top - SITE.podiumY);
      if (!rng.chance(0.35 + 0.65 * fade)) continue;
      if (face === 0) ivyLeaf(x + rng.range(-0.32, 0.32), y, 0.38, V(0, 0, 1), 0.28, 0.1);
      else if (face === 1) ivyLeaf(x - 0.38, y, rng.range(-0.32, 0.32), V(-1, 0, 0), 0.28, 0.1);
      else ivyLeaf(x + 0.38, y, rng.range(-0.32, 0.32), V(1, 0, 0), 0.28, 0.1);
    }
  }
  // 右侧山墙上的薜荔斑块
  for (let k = 0; k < 900; k++) {
    const z = rng.range(-12.8, -2.8), y = rng.range(SITE.podiumY + 4.5, 14.5);
    const m = noise.sample(z * 0.06 + 0.2, y * 0.06, 0) - (y - 7) * 0.035;
    if (m < 0.45) continue;
    ivyLeaf(B.x1 + 0.15 + rng.range(0, 0.06), y, z, V(1, 0, 0), 0.3, 0.1);
  }
  // 侧翼立面藤蔓
  if (wingOut) {
    for (const L of wingOut.ledges) {
      for (let x = L.a; x < L.b - 1; x += rng.range(2, 5)) {
        if (!rng.chance(0.45)) continue;
        const w = rng.range(0.8, 2.5);
        const loc = [];
        const L2 = rng.range(0.6, 3.2);
        for (let s = 0; s < w * 3; s++) {
          const lx = x + rng.range(0, w);
          for (let d = 0; d < L2 * rng.range(0.4, 1); d += 0.14) loc.push([lx + rng.range(-0.08, 0.08), L.y - d, 0.32 + rng.range(0, 0.1)]);
        }
        const nW = V(Math.sin(WING.rot), 0, Math.cos(WING.rot));
        for (const [lx, y, lz] of loc) {
          const w2 = fromWingLocal(lx, lz);
          ivyLeaf(w2.x, y, w2.z, nW, 0.34);
        }
      }
    }
  }
  const ivyMesh = instanced(new THREE.PlaneGeometry(1, 1), mats.ivy, ivy);
  group.add(ivyMesh);

  // ================================================================ 榕树叶
  const bl = banyan.leaves.map((l) => {
    const c = new THREE.Color().setHSL(rng.range(0.27, 0.31), rng.range(0.55, 0.68), rng.range(0.27, 0.33) * l.shade);
    return { p: l.p, n: l.n, s: l.s, r: l.r, c };
  });
  const banyanLeafMesh = instanced(new THREE.PlaneGeometry(1, 1), mats.banyanLeaf, bl);
  banyanLeafMesh.name = 'banyanLeaves';
  group.add(banyanLeafMesh);

  // ================================================================ 背景树 + 树池树 + 屋顶小树
  const trees = { bark: [], cardsA: [], cardsB: [] };
  const treeColor = (type) => {
    if (type === 'R') return [rng.range(0.015, 0.035), rng.range(0.8, 0.9), rng.range(0.42, 0.48)];
    if (type === 'A') return [rng.range(0.26, 0.31), rng.range(0.55, 0.7), rng.range(0.24, 0.31)];
    return [rng.range(0.19, 0.25), rng.range(0.6, 0.75), rng.range(0.3, 0.38)];
  };
  const tree = (x, y, z, H, R, type = 'A', dead = false) => {
    const [th, ts, tl] = treeColor(type);
    const trunkTop = y + H * 0.45;
    const lean = V(rng.range(-0.6, 0.6), 0, rng.range(-0.6, 0.6));
    trees.bark.push(tube([V(x, y - 0.3, z), V(x + lean.x * 0.3, y + H * 0.2, z + lean.z * 0.3), V(x + lean.x, trunkTop, z + lean.z)], (t) => (0.12 + H * 0.022) * (1 - t * 0.4), { radial: 8, perMeter: 1.5, flare: 0.6, bark: 0.1 }));
    const blobs = Math.round(3 + R * 1.2);
    const top = V(x + lean.x, trunkTop, z + lean.z);
    for (let b = 0; b < blobs; b++) {
      const a = rng.r() * Math.PI * 2;
      const rr = rng.range(0.3, 1) * R * 0.7;
      const bc = V(top.x + Math.cos(a) * rr, trunkTop + rng.range(0.25, 1) * H * 0.5, top.z + Math.sin(a) * rr);
      trees.bark.push(tube([top.clone(), top.clone().lerp(bc, 0.5).add(V(0, 0.4, 0)), bc], [0.1 + H * 0.01, 0.04], { radial: 5, perMeter: 1.2 }));
      if (dead) {
        for (let t = 0; t < 3; t++) {
          const tip = bc.clone().add(V(rng.range(-1.5, 1.5), rng.range(0.3, 1.8), rng.range(-1.5, 1.5)));
          trees.bark.push(tube([bc.clone(), bc.clone().lerp(tip, 0.5).add(V(0, 0.2, 0)), tip], [0.05, 0.015], { radial: 4, perMeter: 2 }));
        }
        continue;
      }
      const br = R * rng.range(0.45, 0.7);
      const n = Math.round(br * br * 7 + 8);
      for (let i = 0; i < n; i++) {
        const d = V(rng.gauss(), rng.gauss() * 0.7, rng.gauss()).normalize();
        const p = bc.clone().addScaledVector(d, br * Math.cbrt(rng.range(0.15, 1)));
        if (inMainBuilding(p, 0.3)) continue;
        const shade = 0.65 + 0.35 * Math.max(0, d.y);
        const c = new THREE.Color().setHSL(th + rng.range(-0.012, 0.012), ts, tl * shade * rng.range(0.92, 1.08));
        const card = { p, n: d.add(V(0, 0.4, 0)).normalize(), s: rng.range(1.6, 2.6) * Math.min(1.3, 0.6 + R * 0.15), r: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], c };
        (type === 'A' ? trees.cardsA : trees.cardsB).push(card);
      }
    }
  };
  // 楼后天际线
  for (let k = 0; k < 18; k++) {
    const x = rng.range(-44, 48), z = rng.range(-20, -42);
    if (inWing(V(x, 5, z), 2) || (x > 22 && z < -16)) continue;
    tree(x, SITE.podiumY, z, rng.range(14, 22), rng.range(4, 6.5), rng.chance(0.12) ? 'R' : rng.chance(0.5) ? 'A' : 'B');
  }
  // 两侧
  for (let k = 0; k < 26; k++) {
    const side = rng.sign();
    const x = side * rng.range(33, 55), z = rng.range(-12, 58);
    tree(x, z < SITE.podiumFront ? SITE.podiumY : 0, z, rng.range(10, 19), rng.range(3.5, 6), rng.chance(0.14) ? 'R' : rng.chance(0.55) ? 'A' : 'B');
  }
  // 前方（镜头背后与侧后方）
  for (let k = 0; k < 14; k++) {
    const x = rng.range(-40, 40), z = rng.range(50, 68);
    tree(x, 0, z, rng.range(10, 17), rng.range(3.5, 5.5), rng.chance(0.15) ? 'R' : rng.chance(0.5) ? 'A' : 'B');
  }
  // 侧翼后方
  for (let k = 0; k < 8; k++) {
    const w = fromWingLocal(rng.range(-30, 0), rng.range(-26, -16));
    tree(w.x, SITE.podiumY, w.z, rng.range(13, 20), rng.range(4, 6), 'A');
  }
  // 远景树墙（封住地平线）
  const farTree = (x, y, z, H, R) => {
    const fh = rng.range(0.25, 0.32), fs = rng.range(0.45, 0.6), fl = rng.range(0.22, 0.29);
    trees.bark.push(tube([V(x, y - 0.5, z), V(x, y + H * 0.5, z)], [0.5, 0.3], { radial: 6, perMeter: 0.5 }));
    for (let b = 0; b < 6; b++) {
      const bc = V(x + rng.range(-R, R) * 0.6, y + H * rng.range(0.45, 0.85), z + rng.range(-R, R) * 0.6);
      for (let i = 0; i < 26; i++) {
        const d = V(rng.gauss(), rng.gauss() * 0.6, rng.gauss()).normalize();
        const p = bc.clone().addScaledVector(d, R * 0.55 * Math.cbrt(rng.range(0.2, 1)));
        const c = new THREE.Color().setHSL(fh + rng.range(-0.01, 0.01), fs, fl * (0.75 + 0.3 * Math.max(0, d.y)));
        trees.cardsA.push({ p, n: d.add(V(0, 0.5, 0)).normalize(), s: rng.range(4, 6.5), r: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], c });
      }
    }
  };
  for (let k = 0; k < 120; k++) {
    const a = rng.range(-Math.PI, Math.PI);
    const r = rng.range(56, 100);
    const x = Math.cos(a) * r, z = 10 + Math.sin(a) * r;
    farTree(x, z < SITE.podiumFront ? SITE.podiumY : 0, z, rng.range(16, 26), rng.range(7, 11));
  }
  // 广场树池
  furn.treePits.forEach((t, i) => tree(t.x, 0.2, t.z, i === 2 ? 7 : rng.range(8, 11), i === 2 ? 2.4 : rng.range(3, 4), i === 0 ? 'R' : 'B', i === 2));
  // 楼上的小树苗
  for (const s of bOut.saplings) tree(s.x, s.y, s.z, 3.2 * s.s, 1.2 * s.s, 'B');
  // 平台楼侧几棵中等树
  tree(22, SITE.podiumY, -3, 11, 3.8, 'B');
  tree(-24.5, SITE.podiumY, 3.2, 9, 3.2, 'B');

  const treeBark = new THREE.Mesh(mergeTubes(trees.bark), mats.bark);
  treeBark.castShadow = treeBark.receiveShadow = true;
  group.add(treeBark);
  group.add(instanced(new THREE.PlaneGeometry(1, 1), mats.banyanLeaf, trees.cardsA));
  group.add(instanced(new THREE.PlaneGeometry(1, 1), mats.broadLeaf, trees.cardsB));

  // ================================================================ 落叶
  const fallen = [];
  const addLeaf = (x, y, z) => {
    const cell = rng.int(0, 15);
    fallen.push({ p: V(x, y + 0.006, z), r: [-Math.PI / 2 + rng.range(-0.2, 0.2), 0, rng.range(0, 6.28), 'XYZ'], s: rng.range(0.09, 0.16), a: [(cell % 4) * 0.25, Math.floor(cell / 4) * 0.25], n: UP, c: new THREE.Color().setScalar(rng.range(0.75, 1.1)) });
  };
  for (let k = 0; k < 9000; k++) {
    const a = rng.r() * Math.PI * 2, r = Math.sqrt(rng.r()) * 15;
    const x = SITE.banyan.x + 2 + Math.cos(a) * r * 1.2, z = SITE.banyan.z + 3 + Math.sin(a) * r;
    if (inMainBuilding(V(x, 3, z), -0.1) && z > B.zG) {
      if (!rng.chance(0.3)) continue;
    } else if (inMainBuilding(V(x, 3, z)) || inWing(V(x, 3, z))) continue;
    if (inPlanter(x, z)) continue;
    addLeaf(x, groundY(x, z), z);
  }
  for (let k = 0; k < 1600; k++) {
    const x = rng.range(-30, 30), z = rng.range(SITE.podiumFront, 34);
    if (onStairs(x, z)) {
      const kk = Math.floor((z - SITE.podiumFront) / SITE.stepD);
      const zb = SITE.podiumFront + kk * SITE.stepD;
      if (inPlanter(x, z)) continue;
      addLeaf(x, groundY(x, z), zb + rng.range(0, 0.1));
    } else if (rng.chance(z < SITE.podiumFront + 1.2 ? 1 : 0.15)) addLeaf(x, 0, z < SITE.podiumFront + 1.2 ? SITE.podiumFront + rng.range(0.05, 0.6) : z);
  }
  for (let k = 0; k < 1500; k++) {
    const x = rng.range(-17, 17), z = rng.range(0.4, 6.2);
    addLeaf(x, SITE.podiumY, rng.chance(0.5) ? rng.range(0.4, 1.4) : z);
  }
  const fallenMesh = instanced(new THREE.PlaneGeometry(1, 1), mats.fallen, fallen, { cast: false, atlas: true });
  group.add(fallenMesh);

  // ================================================================ 野花：紫色花穗 / 白色雏菊 / 黄色小花，成片出现
  const fl = { spike: [], daisy: [], yellow: [] };
  const addFlower = (kind, x, y, z, s) => {
    const c = new THREE.Color().setScalar(rng.range(0.88, 1.08));
    fl[kind].push({ p: V(x, y, z), r: [rng.range(-0.18, 0.18), rng.range(0, 6.28), rng.range(-0.18, 0.18)], s: s * rng.range(0.8, 1.25), c, n: UP });
  };
  const okGround = (x, z) => !inMainBuilding(V(x, 3, z), 0.2) && !inWing(V(x, 3, z), 0.2) && !(onStairs(x, z) && !inPlanter(x, z)) && Math.hypot(x - SITE.banyan.x, z - SITE.banyan.z) > 2.4;
  const flowerPatch = (cx, cz, r, n, kinds, scale = 1) => {
    for (let k = 0; k < n; k++) {
      const a = rng.r() * Math.PI * 2, d = Math.sqrt(rng.r()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.8;
      if (!okGround(x, z)) continue;
      const y = groundY(x, z) - (inPlanter(x, z) ? 0.02 : 0);
      addFlower(rng.pick(kinds), x, y, z, scale);
    }
  };
  // 广场外围的草地
  for (let k = 0; k < 46; k++) {
    let x, z;
    if (rng.chance(0.6)) {
      x = rng.sign() * rng.range(30, 47);
      z = rng.range(8, 52);
    } else {
      x = rng.range(-30, 30);
      z = rng.range(38, 54);
    }
    const mix = rng.r();
    const kinds = mix < 0.4 ? ['spike'] : mix < 0.7 ? ['daisy', 'daisy', 'yellow'] : ['spike', 'daisy', 'yellow'];
    flowerPatch(x, z, rng.range(1.0, 2.6), rng.int(14, 40), kinds, rng.range(0.9, 1.3));
  }
  // 挡土墙脚下一排
  for (let x = -44; x < 44; x += rng.range(1.2, 3.5)) {
    if (Math.abs(x) < SITE.stairsHalf + 1) continue;
    flowerPatch(x, SITE.podiumFront + 0.6, 0.6, rng.int(3, 9), rng.chance(0.5) ? ['spike'] : ['daisy', 'yellow']);
  }
  // 台阶中央花池、树池、榕树脚下、平台两侧
  for (let k = 0; k < 6; k++) flowerPatch(rng.range(-1.0, 1.0), rng.range(6.8, 11.5), 0.5, 6, ['daisy', 'yellow', 'spike']);
  for (const t of furn.treePits) flowerPatch(t.x, t.z, 0.9, 10, ['daisy', 'yellow']);
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, 6.28), r = rng.range(3, 7);
    flowerPatch(SITE.banyan.x + Math.cos(a) * r, Math.min(SITE.podiumFront - 0.5, SITE.banyan.z + Math.sin(a) * r), 0.8, 10, ['daisy', 'spike', 'yellow']);
  }
  for (let k = 0; k < 14; k++) flowerPatch(rng.sign() * rng.range(19, 40), rng.range(-24, 4), rng.range(1, 2), rng.int(10, 24), rng.chance(0.5) ? ['spike'] : ['daisy', 'yellow']);
  const fRng = new Rng(19);
  const flowerMeshes = [
    [spikeGeometry(fRng), fl.spike],
    [discFlowerGeometry(), fl.daisy],
    [discFlowerGeometry({ r: 0.065, petals: 6, h: 0.28, petal: '#ffd43b', heart: '#e5821c' }), fl.yellow],
  ];
  for (const [g, list] of flowerMeshes) group.add(instanced(g, mats.flower, list, { cast: false }));

  return group;
}

export function mergeTubes(list) {
  let total = 0, idxTotal = 0;
  for (const g of list) {
    total += g.attributes.position.count;
    idxTotal += g.index.count;
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = new Uint32Array(idxTotal);
  let o = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + o;
    io += ia.length;
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
