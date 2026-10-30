import * as THREE from 'three';
import { tube, Rng, lerp } from './utils.js';
import { SITE, groundY, bayX } from './layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 侧翼变换（与 main.js 中一致）
export const WING = { ox: -17.6, oz: -13.0, rot: -0.75, x0: -25, x1: 0, floors: 2 };
const cW = Math.cos(WING.rot), sW = Math.sin(WING.rot);
export function toWingLocal(p) {
  const dx = p.x - WING.ox, dz = p.z - WING.oz;
  return { x: dx * cW - dz * sW, z: dx * sW + dz * cW };
}
export function fromWingLocal(x, z) {
  return { x: WING.ox + x * cW + z * sW, z: WING.oz - x * sW + z * cW };
}

export function inMainBuilding(p, pad = 0) {
  return p.x > -17.6 - pad && p.x < 17.6 + pad && p.z < 0.6 + pad && p.z > -13.6 - pad && p.y < 19.2 + pad && p.y > 2.0;
}
export function inWing(p, pad = 0) {
  const l = toWingLocal(p);
  return l.x > WING.x0 - 0.6 - pad && l.x < WING.x1 + 0.6 + pad && l.z < 0.6 + pad && l.z > -13.6 - pad && p.y < 15.6 + pad && p.y > 2.0;
}

function avoid(p) {
  if (inMainBuilding(p, 0.4)) {
    if (p.y > 17.2) p.y = 19.6;
    else p.z = 1.0;
  }
  if (inWing(p, 0.4)) {
    const l = toWingLocal(p);
    if (p.y > 13.6) p.y = 16.0;
    else {
      const w = fromWingLocal(l.x, 1.0);
      p.x = w.x;
      p.z = w.z;
    }
  }
}

export function buildBanyan(seed = 7) {
  const rng = new Rng(seed);
  const bark = [];
  const leaves = [];
  const base = V(SITE.banyan.x, SITE.podiumY, SITE.banyan.z);
  const crown = base.clone().add(V(0.3, 8.0, -0.3));
  const canopyC = crown.clone().add(V(0.5, 4.0, 1.5));

  // ---------------- 1. 绞合主干
  const stems = 9;
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const rb = rng.range(1.4, 2.3);
    const twist = rng.range(-0.7, 0.7);
    const pts = [V(Math.cos(a) * rb, -0.35, Math.sin(a) * rb).add(base), V(Math.cos(a) * rb * 0.62, 0.45, Math.sin(a) * rb * 0.62).add(base)];
    for (const h of [2.0, 3.8, 5.6, 7.0]) {
      const ang = a + (twist * h) / 7;
      const r = lerp(0.95, 0.32, h / 7) * rng.range(0.8, 1.1);
      pts.push(V(Math.cos(ang) * r, h, Math.sin(ang) * r).add(base));
    }
    pts.push(crown.clone().add(V(rng.range(-0.4, 0.4), rng.range(-0.3, 0.6), rng.range(-0.4, 0.4))));
    const r0 = rng.range(0.38, 0.56);
    bark.push(tube(pts, (t) => r0 * (1 - t * 0.38), { radial: 12, perMeter: 3, bark: 0.16, barkFreq: 1.3, flare: 0.7 }));
  }

  // ---------------- 2. 树枝（递归）
  const terminals = [];
  function branch(p0, dir, len, r, depth, maxDepth, free = false) {
    const pts = [p0.clone()];
    let p = p0.clone();
    const d = dir.clone().normalize();
    const n = depth === 0 ? 6 : 4;
    for (let i = 1; i <= n; i++) {
      d.y += depth === 0 ? -0.06 : depth === 1 ? -0.01 : 0.05;
      d.x += rng.range(-0.18, 0.18);
      d.z += rng.range(-0.18, 0.18);
      d.normalize();
      p = p.clone().addScaledVector(d, len / n);
      if (!free) avoid(p);
      pts.push(p);
    }
    bark.push(tube(pts, [r, r * 0.5], { radial: depth === 0 ? 10 : depth === 1 ? 7 : 5, perMeter: 2.2, bark: depth < 2 ? 0.1 : 0 }));
    // 气根
    if (depth <= 2) {
      for (let i = 1; i < pts.length; i++) {
        if (rng.chance(depth === 0 ? 0.55 : depth === 1 ? 0.35 : 0.12)) aerialRoots(pts[i], r, depth);
      }
    }
    if (depth < maxDepth) {
      const nc = depth === 0 ? 3 : rng.int(2, 3);
      for (let c = 0; c < nc; c++) {
        const t = c === 0 ? 1 : rng.range(0.4, 0.95);
        const idx = Math.min(pts.length - 1, Math.max(1, Math.round(t * (pts.length - 1))));
        const yaw = rng.range(0.45, 1.1) * (c % 2 ? 1 : -1);
        const cd = d.clone().applyAxisAngle(V(0, 1, 0), yaw);
        cd.y += rng.range(0.1, 0.45);
        branch(pts[idx], cd, len * rng.range(0.55, 0.7), r * 0.58, depth + 1, maxDepth, free && depth < 1);
      }
    } else {
      terminals.push({ p: p.clone(), d: d.clone(), free });
    }
    // 末端枝的叶
    if (depth >= maxDepth - 2) {
      for (let i = depth >= maxDepth - 1 ? 1 : Math.floor(pts.length / 2); i < pts.length; i++) terminals.push({ p: pts[i].clone(), d: d.clone(), small: true, free });
    }
  }

  // ---------------- 3. 气根
  function aerialRoots(P, r, depth) {
    if (inMainBuilding(V(P.x, P.y - 1, P.z), 0.6) || inWing(V(P.x, P.y - 1, P.z), 0.6)) return;
    // 正下方是否被楼板遮挡
    for (let y = P.y - 0.5; y > 2.5; y -= 1.5) if (inMainBuilding(V(P.x, y, P.z), 0.3) || inWing(V(P.x, y, P.z), 0.3)) return;
    const gy = groundY(P.x, P.z);
    const hang = P.y - gy;
    if (hang < 1.2) return;
    const nb = rng.int(2, depth === 0 ? 9 : 5);
    for (let k = 0; k < nb; k++) {
      const prop = rng.chance(depth === 0 ? 0.09 : 0.025) && hang < 13;
      const len = prop ? hang + 0.3 : rng.range(0.6, Math.min(hang * 0.75, 7));
      const sx = P.x + rng.range(-0.25, 0.25), sz = P.z + rng.range(-0.25, 0.25);
      const pts = [];
      const segs = Math.max(3, Math.ceil(len / 1.2));
      const wob = rng.range(0.05, 0.25), ph = rng.range(0, 6);
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        pts.push(V(sx + Math.sin(t * 5 + ph) * wob * t, P.y - r * 0.5 - t * len, sz + Math.cos(t * 4 + ph) * wob * t));
      }
      if (prop) {
        const last = pts[pts.length - 1];
        last.y = gy - 0.25;
        const rr = rng.range(0.035, 0.085);
        for (let q = 1; q < pts.length - 1; q++) {
          pts[q].x += Math.sin(q * 1.9 + ph) * 0.12;
          pts[q].z += Math.cos(q * 1.4 + ph) * 0.12;
        }
        bark.push(tube(pts, (t) => rr * (0.65 + 0.35 * t), { radial: 7, perMeter: 2, flare: 1.4, bark: 0.18 }));
      } else {
        const rr = rng.range(0.008, 0.026);
        bark.push(tube(pts, [rr, rr * 0.45], { radial: 4, perMeter: 1.2, minSeg: 3 }));
      }
    }
  }

  // 主枝：精心安排方向以形成构图
  const limbs = [
    { d: V(-0.8, 0.36, 0.45), len: 9.5, r: 0.5, depth: 3 },
    { d: V(0.75, 0.38, 0.45), len: 8.5, r: 0.5, depth: 3 },
    { d: V(-1, 0.38, -0.05), len: 10, r: 0.45, depth: 3 },
    { d: V(0.1, 1, -0.04), len: 9.5, r: 0.55, depth: 3 },
    { d: V(1, 0.42, 0.05), len: 11.5, r: 0.46, depth: 3 },
    { d: V(0.15, 0.75, 0.62), len: 7, r: 0.45, depth: 3 },
    { d: V(-0.35, 0.95, 0.3), len: 8, r: 0.42, depth: 3 },
  ];
  for (const L of limbs) branch(crown.clone().add(V(rng.range(-0.3, 0.3), rng.range(-0.4, 0.4), rng.range(-0.3, 0.3))), L.d, L.len, L.r, 0, L.depth);
  // 伸进二层走廊、顶破栏板的一根粗枝
  const intoP = [crown.clone().add(V(-0.3, 0.6, -0.4)), V(-12.8, 11.9, 1.6), V(-13.4, 12.25, 0.2), V(-14.0, 12.15, -1.2), V(-14.5, 12.4, -2.2)];
  bark.push(tube(intoP, [0.34, 0.2], { radial: 9, perMeter: 2.5, bark: 0.1 }));
  bark.push(tube([V(-13.4, 12.25, 0.2), V(-12.4, 12.6, -0.6), V(-11.2, 12.4, -1.4), V(-10.5, 12.9, -2.0)], [0.14, 0.06], { radial: 6, perMeter: 3 }));
  terminals.push({ p: V(-11.0, 13.0, -1.4), d: V(1, 0.2, 0), free: true, inside: true });
  terminals.push({ p: V(-13.2, 12.9, 0.6), d: V(0, 0.3, 1), free: true });

  // ---------------- 4. 地表板根
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + rng.range(-0.2, 0.2);
    let x = base.x + Math.cos(a) * 1.6, z = base.z + Math.sin(a) * 1.6;
    let h = a;
    const len = rng.range(3, 9);
    const pts = [V(base.x + Math.cos(a) * 0.9, base.y + 0.5, base.z + Math.sin(a) * 0.9)];
    let prevY = groundY(x, z);
    for (let s = 0; s < len / 0.6; s++) {
      h += rng.range(-0.3, 0.3);
      const nx = x + Math.cos(h) * 0.6, nz = z + Math.sin(h) * 0.6;
      if (inMainBuilding(V(nx, 3, nz), 0.1) || inWing(V(nx, 3, nz), 0.1)) break;
      if (Math.abs(nx) < SITE.stairsHalf + 0.6 && nz > SITE.podiumFront - 0.4) break;
      const gy = groundY(nx, nz);
      if (prevY - gy > 0.4) {
        pts.push(V(nx, prevY + 0.05, SITE.podiumFront + 0.08));
        pts.push(V(nx + Math.cos(h) * 0.05, gy + 0.8, SITE.podiumFront + 0.16));
        pts.push(V(nx + Math.cos(h) * 0.1, gy + 0.05, SITE.podiumFront + 0.55));
      }
      x = nx;
      z = nz;
      prevY = gy;
      pts.push(V(x, gy + 0.03 + Math.sin(s * 1.7) * 0.04, z));
    }
    if (pts.length < 3) continue;
    const r0 = rng.range(0.13, 0.24);
    bark.push(tube(pts, (t) => r0 * (1 - t * 0.8), { radial: 7, perMeter: 2, bark: 0.18 }));
  }

  // ---------------- 5. 沿立面垂下并攀附的绞杀根
  // 先长出两根贴着屋檐的粗枝，根从这里垂下
  const boughL = [crown.clone().add(V(-0.3, 0.5, -0.2)), V(-14.4, 15.8, 2.5), V(-16.6, 19.4, 1.9)];
  const boughR = [crown.clone().add(V(0.3, 0.5, -0.2)), V(-10.8, 16.2, 2.6), V(-9.2, 19.3, 2.1)];
  const boughT = [V(-16.6, 19.4, 1.9), V(-14.8, 20.0, 2.0), V(-12.6, 20.3, 2.3), V(-10.6, 19.9, 2.2), V(-9.2, 19.3, 2.1)];
  bark.push(tube(boughL, [0.3, 0.2], { radial: 8, perMeter: 2, bark: 0.1 }));
  bark.push(tube(boughR, [0.3, 0.2], { radial: 8, perMeter: 2, bark: 0.1 }));
  bark.push(tube(boughT, [0.2, 0.16], { radial: 7, perMeter: 2, bark: 0.1 }));
  const boughCurve = new THREE.CatmullRomCurve3(boughT);
  for (let i = 0; i <= 8; i++) terminals.push({ p: boughCurve.getPointAt(i / 8).add(V(0, 0.8, 0.6)), d: V(0, 0.4, 1) });
  const yRoof = 19.0;
  for (let i = 0; i < 9; i++) {
    const tp = boughCurve.getPointAt(rng.range(0.02, 0.98));
    const sx = tp.x;
    const pts = [tp.clone(), V(sx, yRoof + 0.15, 0.66)];
    const ph = rng.range(0, 6), amp = rng.range(0.15, 0.6);
    for (let y = yRoof - 1.2; y > SITE.podiumY + 0.2; y -= rng.range(1.0, 1.8)) {
      pts.push(V(sx + Math.sin(y * 0.45 + ph) * amp, y, 0.5 + Math.abs(Math.sin(y * 0.8 + ph)) * 0.12));
    }
    pts.push(V(sx + rng.range(-0.3, 0.3), SITE.podiumY - 0.1, 0.9 + rng.range(0, 0.6)));
    const r0 = rng.range(0.03, 0.11);
    bark.push(tube(pts, (t) => r0 * (0.6 + 0.4 * t), { radial: 6, perMeter: 1.5, flare: 1.4, bark: 0.12 }));
  }
  // 攀附柱子的根
  for (const ci of [0, 1]) {
    const cx = bayX(ci);
    for (let j = 0; j < 3; j++) {
      const ox = rng.range(-0.25, 0.25);
      const pts = [V(base.x + rng.range(-0.5, 0.5), base.y + 0.3, base.z - 1.2), V(cx + ox, SITE.podiumY + 0.05, 1.2), V(cx + ox, SITE.podiumY + 0.4, 0.46)];
      const top = rng.range(4, 9);
      for (let y = SITE.podiumY + 1.2; y < SITE.podiumY + top; y += 0.9) pts.push(V(cx + ox + Math.sin(y * 1.3 + j) * 0.22, y, 0.42 + rng.range(0, 0.04)));
      bark.push(tube(pts, (t) => rng.range(0.05, 0.09) * (1 - t * 0.7), { radial: 6, perMeter: 2 }));
    }
  }

  // ---------------- 6. 叶簇
  for (const T of terminals) {
    const n = T.small ? 9 : 32;
    const rad = T.small ? 1.1 : 2.2;
    for (let i = 0; i < n; i++) {
      const o = V(rng.gauss(), rng.gauss() * 0.7 + 0.25, rng.gauss()).multiplyScalar(rad * 0.55);
      o.addScaledVector(T.d, rad * 0.35);
      const p = T.p.clone().add(o);
      if (!T.free && (inMainBuilding(p, 0.2) || inWing(p, 0.2))) continue;
      if (T.inside && p.z > -0.3) continue;
      const nrm = p.clone().sub(canopyC).multiply(V(1, 0.8, 1)).normalize();
      nrm.y += 0.35;
      nrm.normalize();
      const depthIn = Math.min(1, p.distanceTo(canopyC) / 13);
      leaves.push({ p, n: nrm, s: rng.range(1.3, 2.1) * (T.small ? 0.8 : 1), r: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], shade: 0.55 + 0.45 * depthIn });
    }
  }
  return { bark, leaves, base, canopyC };
}
