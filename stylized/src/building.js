import * as THREE from 'three';
import { SITE, stepInfo } from './layout.js';
import { tube } from './utils.js';

const B = SITE.B;

// ---------------------------------------------------------------- 小工具
function rebar(batch, rng, p, dir, len, droop = 0.4) {
  const pts = [new THREE.Vector3(...p)];
  const d = new THREE.Vector3(...dir).normalize();
  const n = 4;
  let cur = pts[0].clone();
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    cur = cur.clone().addScaledVector(d, len / n);
    cur.y -= droop * len * t * t * 0.5;
    cur.x += rng.range(-0.04, 0.04);
    cur.z += rng.range(-0.04, 0.04);
    pts.push(cur);
  }
  batch.add('rust', tube(pts, 0.011, { radial: 4, perMeter: 6, minSeg: 4 }));
}

// 断口：几块随机碎块 + 外露钢筋
function jagged(batch, rng, x, y, z, w, d, { up = true, bars = 4, key = 'concrete' } = {}) {
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const sx = rng.range(0.15, w * 0.6), sy = rng.range(0.1, 0.35), sz = rng.range(0.15, d * 0.7);
    batch.box(key, sx, sy, sz, x + rng.range(-w / 2 + sx / 2, w / 2 - sx / 2), y + (up ? sy * 0.3 : -sy * 0.3), z + rng.range(-d / 2 + sz / 2, d / 2 - sz / 2), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5));
  }
  for (let i = 0; i < bars; i++) {
    rebar(batch, rng, [x + rng.range(-w / 2, w / 2) * 0.8, y, z + rng.range(-d / 2, d / 2) * 0.8], [rng.range(-0.4, 0.4), up ? 1 : -1, rng.range(-0.4, 0.4)], rng.range(0.25, 0.8), rng.range(0.2, 1.2));
  }
}

function shardGeometry(rng, w, h) {
  const a = rng.range(0.25, 0.9), b = rng.range(0.25, 0.9);
  const pts = [[0, 0], [a, 0]];
  const nj = rng.int(2, 4);
  for (let k = 1; k <= nj; k++) {
    const t = k / (nj + 1);
    const bx = a * (1 - t), by = b * t;
    const off = rng.range(-0.18, 0.18);
    pts.push([bx + off * 0.7, by + off * 0.7]);
  }
  pts.push([0, b]);
  const corner = rng.int(0, 3);
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    let X = x, Y = y;
    if (corner === 1 || corner === 2) X = 1 - x;
    if (corner >= 2) Y = 1 - y;
    X = Math.min(1, Math.max(0, X)) * w;
    Y = Math.min(1, Math.max(0, Y)) * h;
    i === 0 ? shape.moveTo(X, Y) : shape.lineTo(X, Y);
  });
  return new THREE.ShapeGeometry(shape);
}

// 带状窗：竖梃 + 横档 + 玻璃（完整 / 残片 / 打开的窗扇）
export function windowBand(batch, rng, xa, xb, ya, yb, z, { n = 4, detail = 1, glassP = 0.14, shardP = 0.3 } = {}) {
  const w = (xb - xa) / n;
  const yt = ya + (yb - ya) * 0.68;
  const fz0 = z - 0.04, fz1 = z + 0.04;
  batch.mm('frame', xa, ya, fz0, xb, ya + 0.06, fz1);
  batch.mm('frame', xa, yb - 0.06, fz0, xb, yb, fz1);
  batch.mm('frame', xa, yt - 0.03, fz0, xb, yt + 0.03, fz1);
  for (let j = 0; j <= n; j++) {
    const x = xa + j * w;
    if (j > 0 && j < n && rng.chance(0.05)) continue;
    batch.mm('frame', x - 0.03, ya, fz0, x + 0.03, yb, fz1);
  }
  for (let j = 0; j < n; j++) {
    const rows = [
      [ya + 0.06, yt - 0.03, true],
      [yt + 0.03, yb - 0.06, false],
    ];
    for (const [py0, py1, lower] of rows) {
      const px0 = xa + j * w + 0.03, px1 = xa + (j + 1) * w - 0.03;
      const pw = px1 - px0, ph = py1 - py0;
      const r = rng.r();
      if (r < glassP) {
        const g = new THREE.PlaneGeometry(pw, ph);
        g.translate(px0 + pw / 2, py0 + ph / 2, z);
        batch.add('glass', g);
      } else if (r < glassP + shardP && detail > 0) {
        const g = shardGeometry(rng, pw, ph);
        g.translate(px0, py0, z + 0.005);
        batch.add('glass', g);
      } else if (lower && detail > 0 && r > 0.93) {
        // 向外推开的窗扇
        const ang = rng.range(0.35, 1.25) * (rng.chance(0.5) ? 1 : -1);
        const hingeX = ang > 0 ? px0 : px1;
        const sgn = ang > 0 ? 1 : -1;
        const pv = [hingeX, py0, z + 0.05];
        const rot = [0, -ang, 0];
        batch.pivotBox('frame', pw, 0.045, 0.04, pv, [(sgn * pw) / 2, 0.02, 0], ...rot);
        batch.pivotBox('frame', pw, 0.045, 0.04, pv, [(sgn * pw) / 2, ph - 0.02, 0], ...rot);
        batch.pivotBox('frame', 0.045, ph, 0.04, pv, [0, ph / 2, 0], ...rot);
        batch.pivotBox('frame', 0.045, ph, 0.04, pv, [sgn * pw, ph / 2, 0], ...rot);
        if (rng.chance(0.5)) {
          const g = new THREE.PlaneGeometry(pw * 0.95, ph * 0.95);
          g.translate((sgn * pw) / 2, ph / 2, 0);
          g.rotateY(-ang);
          g.translate(...pv);
          batch.add('glass', g);
        }
      }
    }
  }
}

function railing(batch, rng, xa, xb, y, z, { postEvery = 1.4, h = 0.95, brokenP = 0.12 } = {}) {
  const len = xb - xa;
  const nPosts = Math.max(1, Math.round(len / postEvery));
  const step = len / nPosts;
  for (let i = 0; i <= nPosts; i++) {
    if (rng.chance(0.08)) continue;
    const x = xa + i * step;
    const lean = rng.chance(0.15) ? rng.range(-0.25, 0.25) : 0;
    batch.pivotBox('rust', 0.04, h, 0.04, [x, y, z], [0, h / 2, 0], lean, 0, rng.range(-0.04, 0.04));
  }
  // 扶手分段，偶有断裂下垂
  for (let i = 0; i < nPosts; i++) {
    const x0 = xa + i * step, x1 = x0 + step;
    for (const hh of [h, h * 0.5]) {
      if (rng.chance(brokenP)) {
        if (rng.chance(0.5)) continue;
        const pts = [new THREE.Vector3(x0, y + hh, z), new THREE.Vector3(x0 + step * 0.45, y + hh - 0.15, z + 0.05), new THREE.Vector3(x0 + step * 0.7, y + hh - rng.range(0.4, 0.8), z + 0.12)];
        batch.add('rust', tube(pts, 0.018, { radial: 5, perMeter: 6 }));
      } else {
        batch.mm('rust', x0, y + hh - 0.025, z - 0.025, x1, y + hh + 0.025, z + 0.025);
      }
    }
  }
}

function subtractGaps(a, b, gaps) {
  let segs = [[a, b]];
  for (const [ga, gb] of gaps) {
    const next = [];
    for (const [s, e] of segs) {
      if (gb <= s || ga >= e) next.push([s, e]);
      else {
        if (ga > s) next.push([s, ga]);
        if (gb < e) next.push([gb, e]);
      }
    }
    segs = next;
  }
  return segs;
}

// ======================================================================
// 教学楼主体
// ======================================================================
export function buildBlock(batch, rng, cfg) {
  const {
    x0,
    x1,
    bays,
    floors = B.floors,
    collapse = false,
    detail = 1,
    gaps = [],
    paintedCols = [],
    mural = false,
    leftEnd = true,
    rightEnd = true,
  } = cfg;
  const y0 = SITE.podiumY;
  const bw = (x1 - x0) / bays;
  const cx = (i) => x0 + i * bw;
  const T = (k) => y0 + B.gH + (k - 1) * B.fH;
  const roofK = floors + 1;
  const roofTop = T(roofK);
  const parTop = (k) => T(k) + B.parH;
  const cb = bays - 1;
  const xc = cx(cb);
  const sx0 = x0 - 0.35, sx1 = x1 + 0.35;
  const out = { rubble: [], ledges: [], gapEdges: [], roofTop, saplings: [] };
  const cornerTop = T(floors) + 1.25;

  // ---------- 前排柱
  for (let i = 0; i <= bays; i++) {
    const x = cx(i);
    let top = parTop(roofK) + 0.07;
    if (collapse && i === bays) top = cornerTop;
    if (paintedCols.includes(i)) {
      batch.mm('paint', x - 0.35, y0, -0.35, x + 0.35, T(1) - B.slabT - 0.32, 0.35);
      batch.mm('concrete', x - 0.35, T(1) - B.slabT - 0.32, -0.35, x + 0.35, top, 0.35);
    } else {
      batch.mm('concrete', x - 0.35, y0, -0.35, x + 0.35, top, 0.35);
    }
    if (collapse && i === bays) jagged(batch, rng, x, top, 0, 0.7, 0.7, { bars: 6 });
    // 架空层内部柱
    batch.mm('concrete', x - 0.3, y0, B.zW - 0.3, x + 0.3, T(1) - B.slabT, B.zW + 0.3);
    // 上层窗墙内柱
    for (let k = 1; k <= floors; k++) {
      if (collapse && k === floors && i === bays) {
        batch.mm('concrete', x - 0.3, T(k), B.zW - 0.3, x + 0.3, T(k) + 1.0, B.zW + 0.3);
        continue;
      }
      batch.mm('concrete', x - 0.3, T(k), B.zW - 0.3, x + 0.3, T(k + 1) - B.slabT, B.zW + 0.3);
    }
  }

  // ---------- 楼板与梁
  for (let k = 1; k <= roofK; k++) {
    const yb = T(k) - B.slabT, yt = T(k);
    if (collapse && k === roofK) {
      batch.mm('concrete', sx0 + 0.03, yb, B.zB - 0.3, xc + 0.25, yt, 0.15);
      batch.mm('concrete', xc + 0.25, yb, B.zB - 0.3, sx1, yt, -7.4);
      // 后段悬挂残片
      batch.pivotBox('concrete', sx1 - xc - 0.9, B.slabT, 2.2, [xc + 0.25 + (sx1 - xc - 0.25) / 2, yt - B.slabT / 2, -7.4], [0, 0, 1.05], 0.5, 0.03, 0.04);
      // 主塌落板：以左缘为铰，斜搭在断柱上
      const w = sx1 - xc - 0.4;
      batch.pivotBox('concrete', w, B.slabT, 6.6, [xc + 0.25, yt - B.slabT / 2, -3.3], [w / 2, 0, 0], 0.05, 0.03, -0.5);
      // 铰缘外露钢筋
      for (let z = -6.4; z < 0.2; z += rng.range(0.18, 0.45)) {
        rebar(batch, rng, [xc + 0.25, yt - 0.1, z], [rng.range(0.4, 1.0), rng.range(-0.6, 0.1), rng.range(-0.2, 0.2)], rng.range(0.3, 1.1), rng.range(0.3, 1.5));
      }
      for (let x = xc + 0.5; x < sx1 - 0.2; x += rng.range(0.25, 0.5)) {
        rebar(batch, rng, [x, yt - 0.12, -7.4], [rng.range(-0.2, 0.2), -0.6, 1], rng.range(0.3, 0.9), 1.2);
      }
      out.rubble.push({ x: xc + 2.2, y: T(floors), z: -3, r: 2.2, n: 70 });
    } else {
      batch.mm('concrete', sx0 + 0.03, yb, B.zB - 0.3, sx1 - 0.03, yt, 0.15);
    }
  }
  // 架空层顶梁（从下方可见）
  for (let i = 0; i <= bays; i++) {
    const x = cx(i);
    batch.mm('concrete', x - 0.22, T(1) - B.slabT - 0.6, B.zB, x + 0.22, T(1) - B.slabT, 0);
  }
  batch.mm('concrete', x0, T(1) - B.slabT - 0.6, B.zW - 0.22, x1, T(1) - B.slabT, B.zW + 0.22);
  batch.mm('concrete', x0, T(1) - B.slabT - 0.6, B.zG - 0.22, x1, T(1) - B.slabT, B.zG + 0.22);

  // ---------- 外廊栏板（橙色涂装带）+ 压顶 + 栏杆
  for (let k = 1; k <= roofK; k++) {
    const by0 = T(k) - B.slabT - 0.32, by1 = parTop(k);
    const g = gaps.filter((q) => q.k === k).map((q) => [q.a, q.b]);
    if (collapse && k === roofK) g.push([xc - 0.05, sx1 + 1]);
    if (collapse && k === floors) g.push([xc + 2.1, sx1 + 1]);
    const segs = subtractGaps(sx0, sx1, g);
    for (const [a, b] of segs) {
      batch.mm('paint', a, by0, 0.07, b, by1, 0.25);
      batch.mm('concrete', a - 0.02, by1, 0.0, b + 0.02, by1 + 0.07, 0.3);
      out.ledges.push({ a, b, y: by1 + 0.07, z: 0.15 });
      if (detail > 0 || k === roofK) railing(batch, rng, a + 0.1, b - 0.1, by1 + 0.07, 0.16, { brokenP: 0.14 });
    }
    // 缺口：露出楼板边 + 断口
    for (const [ga, gb0] of g) {
      const gb = Math.min(gb0, sx1);
      if (gb <= ga) continue;
      const isCollapse = collapse && (k === roofK || k === floors) && gb0 > sx1;
      if (!(collapse && k === roofK && isCollapse)) batch.mm('concrete', ga, by0, 0.0, gb, T(k), 0.2);
      if (ga > sx0 + 0.1) jagged(batch, rng, ga, by1 - 0.4, 0.16, 0.3, 0.25, { up: true, bars: 3, key: 'paint' });
      if (gb < sx1 - 0.1) jagged(batch, rng, gb, by1 - 0.4, 0.16, 0.3, 0.25, { up: true, bars: 3, key: 'paint' });
      if (!(collapse && k === roofK && isCollapse)) for (let x = ga + 0.2; x < gb - 0.1; x += rng.range(0.3, 0.6)) rebar(batch, rng, [x, T(k), 0.15], [rng.range(-0.3, 0.3), 1, rng.range(0, 0.4)], rng.range(0.15, 0.6), 0.6);
      out.gapEdges.push({ a: ga, b: gb, y: T(k), k });
    }
    // 屋面断裂处悬挂的栏板
    if (collapse && k === roofK) {
      batch.pivotBox('paint', 2.6, by1 - by0, 0.18, [xc + 0.05, by1, 0.16], [1.3, -(by1 - by0) / 2, 0], 0.08, 0.0, -1.05);
      for (let i = 0; i < 5; i++) rebar(batch, rng, [xc + 0.05, by1 - 0.2 - i * 0.25, 0.16], [1, -0.3, 0], rng.range(0.4, 0.9), 1.4);
    }
    // 走廊两端回头栏板
    if (rightEnd && !(collapse && k >= floors)) {
      batch.mm('paint', x1 + 0.07, by0, B.zW, x1 + 0.25, by1, 0.07);
      batch.mm('concrete', x1 + 0.02, by1, B.zW, x1 + 0.3, by1 + 0.07, 0.0);
    }
    if (leftEnd) {
      batch.mm('paint', x0 - 0.25, by0, B.zW, x0 - 0.07, by1, 0.07);
      batch.mm('concrete', x0 - 0.3, by1, B.zW, x0 - 0.02, by1 + 0.07, 0.0);
    }
  }

  // ---------- 教室窗墙 + 室内
  for (let k = 1; k <= floors; k++) {
    const yF = T(k), yC = T(k + 1) - B.slabT;
    for (let i = 0; i < bays; i++) {
      const xa = cx(i) + 0.3, xb = cx(i + 1) - 0.3;
      if (collapse && k === floors && i === cb) {
        batch.mm('wall', xa, yF, B.zW - 0.12, xa + 1.5, yF + 0.7, B.zW + 0.12);
        jagged(batch, rng, xa + 1.5, yF + 0.6, B.zW, 0.4, 0.24, { bars: 3, key: 'wall' });
        out.rubble.push({ x: xa + 2.2, y: yF, z: -1.2, r: 1.8, n: 45 });
        continue;
      }
      batch.mm('wall', xa, yF, B.zW - 0.12, xb, yF + 0.9, B.zW + 0.12);
      batch.mm('wall', xa, yF + 2.95, B.zW - 0.12, xb, yC, B.zW + 0.12);
      windowBand(batch, rng, xa, xb, yF + 0.9, yF + 2.95, B.zW, { detail });
      if (detail > 0) {
        // 课桌、吊灯
        const nd = rng.int(2, 4);
        for (let d = 0; d < nd; d++) {
          const dx = rng.range(xa + 0.6, xb - 0.6), dz = rng.range(-9.5, -4);
          const tip = rng.chance(0.3);
          const ry = rng.range(-0.3, 0.3);
          if (tip) {
            batch.box('interior', 1.2, 0.05, 0.6, dx, yF + 0.32, dz, 1.2, ry, 0.2);
          } else {
            batch.box('interior', 1.2, 0.05, 0.6, dx, yF + 0.75, dz, 0, ry, 0);
            batch.box('frame', 1.1, 0.72, 0.04, dx, yF + 0.37, dz, 0, ry, 0);
          }
        }
        if (rng.chance(0.6)) {
          const lx = rng.range(xa + 1, xb - 1);
          batch.pivotBox('frame', 1.2, 0.07, 0.22, [lx, yC - 0.05, -4.5], [0.6, 0, 0], 0, 0, -rng.range(0.4, 1.2));
        }
      }
    }
    // 隔墙
    for (let i = 2; i < bays; i += 2) {
      batch.mm('interior', cx(i) - 0.1, yF, B.zB, cx(i) + 0.1, yC, B.zW - 0.12);
    }
    // 端墙
    if (rightEnd) {
      const xw0 = x1 - 0.12, xw1 = x1 + 0.12;
      if (collapse && k === floors) {
        batch.mm('wall', xw0, yF, B.zB, xw1, yF + 1.2, B.zW);
        jagged(batch, rng, x1, yF + 1.2, -7.5, 0.24, 6, { bars: 6, key: 'wall' });
      } else {
        batch.mm('wall', xw0, yF, B.zB, xw1, yF + 0.9, B.zW);
        batch.mm('wall', xw0, yF + 2.9, B.zB, xw1, yC, B.zW);
        batch.mm('wall', xw0, yF + 0.9, B.zB, xw1, yF + 2.9, -10.2);
        batch.mm('wall', xw0, yF + 0.9, -4.8, xw1, yF + 2.9, B.zW);
        const wz = [-10.2, -8.4, -6.6, -4.8];
        for (const z of wz) batch.mm('frame', x1 - 0.04, yF + 0.9, z - 0.03, x1 + 0.04, yF + 2.9, z + 0.03);
        batch.mm('frame', x1 - 0.04, yF + 2.25, -10.2, x1 + 0.04, yF + 2.31, -4.8);
        if (rng.chance(0.7)) {
          const g = shardGeometry(rng, 1.7, 1.3);
          g.rotateY(Math.PI / 2);
          g.translate(x1 + 0.01, yF + 0.93, -8.45);
          batch.add('glass', g);
        }
      }
    }
    if (leftEnd) batch.mm('wall', x0 - 0.12, yF, B.zB, x0 + 0.12, yC, B.zW);
  }
  // 背立面
  batch.mm('interior', sx0 + 0.03, y0, B.zB - 0.22, sx1 - 0.03, collapse ? T(floors) + 2.4 : roofTop - B.slabT, B.zB);
  if (collapse) batch.mm('interior', sx0 + 0.03, T(floors) + 2.4, B.zB - 0.22, xc, roofTop - B.slabT, B.zB);

  // ---------- 架空层围合墙（壁画 / 门洞 / 展厅）
  const yG1 = T(1) - B.slabT;
  for (let i = 0; i < bays; i++) {
    const xa = cx(i) + 0.3, xb = cx(i + 1) - 0.3;
    const z0 = B.zG - 0.15, z1 = B.zG + 0.15;
    const type = cfg.groundTypes ? cfg.groundTypes[i] : 'wall';
    if (type === 'door' || type === 'shutter') {
      const dm = (xa + xb) / 2;
      batch.mm('wall', xa, y0, z0, dm - 1.0, yG1, z1);
      batch.mm('wall', dm + 1.0, y0, z0, xb, yG1, z1);
      batch.mm('wall', dm - 1.0, y0 + 2.8, z0, dm + 1.0, yG1, z1);
      batch.mm('frame', dm - 1.05, y0, z1 - 0.02, dm - 0.98, y0 + 2.85, z1 + 0.04);
      batch.mm('frame', dm + 0.98, y0, z1 - 0.02, dm + 1.05, y0 + 2.85, z1 + 0.04);
      if (type === 'shutter') {
        batch.box('frame', 1.98, 1.5, 0.05, dm, y0 + 2.05, z1 - 0.05, 0.04, 0, 0.03);
      } else {
        // 半开的门扇
        batch.pivotBox('frame', 0.95, 2.6, 0.05, [dm - 0.98, y0 + 0.02, z1 - 0.05], [0.47, 1.3, 0], 0, -rng.range(0.6, 1.4), 0);
      }
    } else if (type === 'gallery') {
      batch.mm('wall', xa, y0, z0, xb, y0 + 0.5, z1);
      batch.mm('wall', xa, y0 + 3.6, z0, xb, yG1, z1);
      windowBand(batch, rng, xa, xb, y0 + 0.5, y0 + 3.6, B.zG, { n: 3, detail, glassP: 0.25, shardP: 0.35 });
    } else {
      batch.mm('wall', xa, y0, z0, xb, yG1, z1);
    }
  }
  batch.mm('concrete', sx0, y0, B.zG - 0.3, sx0 + 0.4, yG1, B.zG + 0.3);
  // 室内地面以下已有平台；室内隔墙
  for (let i = 2; i < bays; i += 3) batch.mm('interior', cx(i) - 0.1, y0, B.zB, cx(i) + 0.1, yG1, B.zG - 0.15);
  if (mural) {
    const g = new THREE.PlaneGeometry(cx(4) - cx(1) - 0.8, 3.3);
    g.translate((cx(1) + cx(4)) / 2, y0 + 0.45 + 1.65, B.zG + 0.16);
    batch.add('mural', g);
  }

  // ---------- 屋面
  batch.mm('concrete', sx0, roofTop, B.zB - 0.3, collapse ? xc : sx1, roofTop + 0.9, B.zB - 0.1);
  if (leftEnd) batch.mm('concrete', sx0, roofTop, B.zB, sx0 + 0.2, roofTop + 0.9, 0.0);
  if (detail > 0) {
    const tx = cfg.towerX ?? -5;
    batch.mm('wall', tx - 2.5, roofTop, -12.6, tx + 2.5, roofTop + 3.1, -8.6);
    batch.mm('concrete', tx - 2.7, roofTop + 3.1, -12.8, tx + 2.7, roofTop + 3.3, -8.4);
    batch.mm('interior', tx - 0.5, roofTop, -8.62, tx + 0.5, roofTop + 2.15, -8.55);
    // 水箱
    const tank = new THREE.CylinderGeometry(1.05, 1.05, 1.7, 20, 1);
    tank.rotateZ(Math.PI / 2);
    tank.translate(tx + 6.5, roofTop + 1.5, -10.5);
    batch.add('rust', tank);
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) batch.mm('rust', tx + 6.5 + ox - 0.04, roofTop, -10.5 + oz - 0.04, tx + 6.5 + ox + 0.04, roofTop + 0.6, -10.5 + oz + 0.04);
    // 弯折的天线
    batch.add('rust', tube([new THREE.Vector3(tx + 1.5, roofTop + 3.3, -10), new THREE.Vector3(tx + 1.6, roofTop + 5.0, -10.1), new THREE.Vector3(tx + 2.3, roofTop + 5.9, -9.9), new THREE.Vector3(tx + 3.1, roofTop + 5.6, -9.6)], [0.035, 0.02], { radial: 5 }));
    out.saplings.push({ x: tx + 2.3, y: roofTop + 3.3, z: -9.2, s: 0.8 }, { x: x0 + 3, y: roofTop, z: -1.0, s: 1.1 }, { x: xc - 2.0, y: roofTop, z: -0.8, s: 1.3 }, { x: xc + 2.4, y: T(floors), z: -1.5, s: 1.0 });
  }
  return out;
}

// ======================================================================
// 平台、挡土墙、大台阶、花池
// ======================================================================
export function buildPodium(batch, rng) {
  const Y = SITE.podiumY, F = SITE.podiumFront, H = SITE.stairsHalf, PH = SITE.planterHalf;
  const out = { stepCracks: [], rails: [] };
  batch.mm('concrete', -46, -0.5, -45, 46, Y, F);
  // 挡土墙涂装带 + 压顶
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -46 : H + 0.45, xb = s < 0 ? -H - 0.45 : 46;
    batch.mm('paint', xa, 1.45, F, xb, Y, F + 0.06);
    batch.mm('concrete', xa, Y, F - 0.3, xb, Y + 0.1, F + 0.12);
    // 排水孔
    for (let x = xa + 2; x < xb - 1; x += 4.2) batch.mm('interior', x - 0.08, 0.35, F + 0.0, x + 0.08, 0.5, F + 0.065);
    railing(batch, rng, xa + 0.3, xb - 0.3, Y + 0.1, F - 0.12, { postEvery: 1.6, brokenP: 0.18 });
  }
  // 台阶
  for (let i = 0; i < SITE.nSteps; i++) {
    const { top, zFront } = stepInfo(i);
    const yb = i * SITE.stepH;
    for (const s of [-1, 1]) {
      const xa = s < 0 ? -H : PH, xb = s < 0 ? -PH : H;
      // 破损：缺角 / 断裂下沉
      if (rng.chance(0.22)) {
        const cxp = rng.range(xa + 0.6, xb - 0.6);
        const cw = rng.range(0.25, 0.8);
        batch.mm('stone', xa, yb, F, cxp - cw / 2, top, zFront);
        batch.mm('stone', cxp + cw / 2, yb, F, xb, top, zFront);
        batch.mm('stone', cxp - cw / 2, yb, F, cxp + cw / 2, top - rng.range(0.03, 0.08), zFront - rng.range(0.05, 0.14));
        out.stepCracks.push({ x: cxp, y: top, z: zFront - 0.15 });
      } else if (rng.chance(0.15)) {
        const cxp = rng.range(xa + 1, xb - 1);
        batch.mm('stone', xa, yb, F, cxp - 0.01, top, zFront);
        batch.box('stone', xb - cxp - 0.01, SITE.stepH, zFront - F, (cxp + 0.01 + xb) / 2, (yb + top) / 2 - 0.02, (F + zFront) / 2, rng.range(-0.006, 0.006), 0, rng.range(-0.01, 0.01));
        out.stepCracks.push({ x: cxp, y: top, z: zFront - 0.2, line: true });
      } else {
        batch.box('stone', xb - xa, SITE.stepH, zFront - F, (xa + xb) / 2, (yb + top) / 2 + rng.range(-0.006, 0.004), (F + zFront) / 2, rng.range(-0.003, 0.003), 0, rng.range(-0.003, 0.003));
      }
    }
    // 中央花池（阶梯状）
    batch.mm('concrete', -PH, yb, F, -PH + 0.18, top + 0.45, zFront);
    batch.mm('concrete', PH - 0.18, yb, F, PH, top + 0.45, zFront);
    batch.mm('soil', -PH + 0.18, yb, F, PH - 0.18, top + 0.36, zFront);
    // 两侧挡墙
    batch.mm('concrete', -H - 0.45, yb, F, -H, top + 0.7, zFront);
    batch.mm('concrete', H, yb, F, H + 0.45, top + 0.7, zFront);
  }
  batch.mm('concrete', -PH, 0, stepInfo(0).zFront - 0.18, PH, 0.6, stepInfo(0).zFront);
  // 扶手
  const railX = [-5.8, 5.8, -PH - 0.25, PH + 0.25];
  const zb = stepInfo(0).zFront + 0.35, zt = F - 0.3;
  for (const [ri, x] of railX.entries()) {
    const yAt = (z) => Math.min(Y, Math.max(0, (SITE.stairsEnd - z) / SITE.stepD) * SITE.stepH);
    const broken = ri === 0;
    const pts = [];
    const n = 8;
    for (let j = 0; j <= n; j++) {
      const z = zb + (zt - zb) * (j / n);
      let y = yAt(z) + 0.95;
      if (broken && j >= 3 && j <= 5) y -= [0.25, 0.55, 0.3][j - 3];
      pts.push(new THREE.Vector3(x + (broken && j === 4 ? 0.15 : 0), y, z));
    }
    // 端部下弯
    pts.unshift(new THREE.Vector3(x, 0.35, zb + 0.2));
    pts.push(new THREE.Vector3(x, Y + 0.35, zt - 0.25));
    batch.add('rust', tube(pts, 0.026, { radial: 6, perMeter: 4 }));
    for (const t of [0.12, 0.5, 0.88]) {
      const z = zb + (zt - zb) * t;
      const y = yAt(z);
      batch.mm('rust', x - 0.025, y, z - 0.025, x + 0.025, y + 0.95 - (broken && t === 0.5 ? 0.5 : 0), z + 0.025);
    }
  }
  return out;
}

// 广场小品：树池、坐凳、校名墙
export function buildPlazaFurniture(batch, rng) {
  const out = { treePits: [], benches: [] };
  const pits = [
    [-21, 21.5],
    [20.5, 26],
    [-6.5, 30],
  ];
  for (const [x, z] of pits) {
    const s = 1.3;
    batch.mm('stone', x - s, 0, z - s, x + s, 0.32, z - s + 0.2);
    batch.mm('stone', x - s, 0, z + s - 0.2, x + s, 0.32, z + s);
    batch.mm('stone', x - s, 0, z - s + 0.2, x - s + 0.2, 0.32, z + s - 0.2);
    batch.mm('stone', x + s - 0.2, 0, z - s + 0.2, x + s, 0.32, z + s - 0.2);
    batch.mm('soil', x - s + 0.2, 0, z - s + 0.2, x + s - 0.2, 0.22, z + s - 0.2);
    out.treePits.push({ x, z });
  }
  const benches = [
    [-9, 18.5, 0.1],
    [8.5, 17.5, -0.05],
    [-15, 27, 0.4],
  ];
  for (const [x, z, r] of benches) {
    batch.box('stone', 2.4, 0.12, 0.55, x, 0.45, z, 0, r, 0);
    batch.box('stone', 0.3, 0.4, 0.5, x - Math.cos(r) * 0.95, 0.2, z + Math.sin(r) * 0.95, 0, r, 0);
    batch.box('stone', 0.3, 0.4, 0.5, x + Math.cos(r) * 0.95, 0.2, z - Math.sin(r) * 0.95, 0, r, 0);
    out.benches.push({ x, z });
  }
  return out;
}
