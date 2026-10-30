import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- RNG
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.f = mulberry32(seed);
  }
  r() {
    return this.f();
  }
  range(a, b) {
    return a + (b - a) * this.f();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.f() * arr.length) % arr.length];
  }
  chance(p) {
    return this.f() < p;
  }
  sign() {
    return this.f() < 0.5 ? -1 : 1;
  }
  gauss() {
    return (this.f() + this.f() + this.f() + this.f() - 2) * 0.87;
  }
}

// ---------------------------------------------------------------- CPU value noise
function ihash(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, y, z = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c000 = ihash(xi, yi, zi), c100 = ihash(xi + 1, yi, zi);
  const c010 = ihash(xi, yi + 1, zi), c110 = ihash(xi + 1, yi + 1, zi);
  const c001 = ihash(xi, yi, zi + 1), c101 = ihash(xi + 1, yi, zi + 1);
  const c011 = ihash(xi, yi + 1, zi + 1), c111 = ihash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

export function fbm(x, y, z = 0, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(x * f + o * 7.1, y * f, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// GLSL 同款 hash12（Dave Hoskins），用于 CPU 侧复现地砖随机
export function hash12(x, y) {
  const fr = (v) => v - Math.floor(v);
  let p3x = fr(x * 0.1031), p3y = fr(y * 0.1031), p3z = fr(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return fr((p3x + p3y) * p3z);
}

// ---------------------------------------------------------------- tapered tube
const _P = new THREE.Vector3();

/**
 * 沿样条生成变径管（树干、树枝、气根、钢筋）
 * radius: number | [r0, r1] | (t)=>r
 */
export function tube(points, radius, opts = {}) {
  const {
    radial = 8,
    perMeter = 2.5,
    minSeg = 3,
    bark = 0,
    barkFreq = 1.6,
    flare = 0,
    flute = 0,
    fluteN = 5,
    uvPeriod = 0.45,
    tension = 0.5,
  } = opts;
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
  const len = curve.getLength();
  const segs = Math.max(minSeg, Math.ceil(len * perMeter));
  const frames = curve.computeFrenetFrames(segs, false);
  const rfn =
    typeof radius === 'function'
      ? radius
      : Array.isArray(radius)
        ? (t) => radius[0] + (radius[1] - radius[0]) * t
        : () => radius;
  const rAvg = rfn(0.3);
  const uRep = Math.max(1, Math.round((2 * Math.PI * rAvg) / uvPeriod));
  const vc = (segs + 1) * (radial + 1);
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  let pi = 0, ui = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, _P);
    let r = rfn(t);
    if (flare) r *= 1 + flare * Math.pow(1 - t, 5);
    const N = frames.normals[i], Bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a), c = -Math.cos(a);
      const nx = c * N.x + s * Bn.x, ny = c * N.y + s * Bn.y, nz = c * N.z + s * Bn.z;
      let rr = r;
      if (flute) rr *= 1 + flute * (Math.sin(a * fluteN + vnoise(_P.y * 0.7, 3.3) * 4) * 0.5 + 0.5) * (1 - t * 0.6);
      if (bark) rr *= 1 + bark * (vnoise(_P.x * barkFreq + nx * 0.8, _P.y * barkFreq + ny * 0.8, _P.z * barkFreq + nz * 0.8) - 0.5) * 2;
      pos[pi] = _P.x + nx * rr;
      pos[pi + 1] = _P.y + ny * rr;
      pos[pi + 2] = _P.z + nz * rr;
      nor[pi] = nx;
      nor[pi + 1] = ny;
      nor[pi + 2] = nz;
      pi += 3;
      uv[ui++] = (j / radial) * uRep;
      uv[ui++] = (t * len) / uvPeriod;
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- geometry batch (merge per material)
// 插画版：盒子保持直角，折边才有清楚的轮廓线
function boxGeometry(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Batch {
  constructor() {
    this.groups = new Map();
    this.xf = null; // 可选整体变换（侧翼）
  }
  add(key, geo) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (this.xf) g.applyMatrix4(this.xf);
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
    return g;
  }
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = boxGeometry(w, h, d);
    _m.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z);
    g.applyMatrix4(_m);
    return this.add(key, g);
  }
  // 以 min/max 定义的轴对齐盒子
  mm(key, x0, y0, z0, x1, y1, z1) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return null;
    return this.box(key, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  // 绕铰点旋转的盒子：local 为盒心相对铰点的偏移
  pivotBox(key, w, h, d, pivot, local, rx, ry, rz) {
    const g = boxGeometry(w, h, d);
    g.translate(local[0], local[1], local[2]);
    _m.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(pivot[0], pivot[1], pivot[2]);
    g.applyMatrix4(_m);
    return this.add(key, g);
  }
  geo(key, g, matrix) {
    if (matrix) g.applyMatrix4(matrix);
    return this.add(key, g);
  }
  build(materials, { castShadow = true, receiveShadow = true, shadowless = [] } = {}) {
    const out = [];
    for (const [key, list] of this.groups) {
      if (!materials[key]) {
        console.warn('missing material', key);
        continue;
      }
      const geo = mergeGeometries(list, false);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.castShadow = castShadow && !shadowless.includes(key);
      mesh.receiveShadow = receiveShadow;
      mesh.name = key;
      out.push(mesh);
    }
    return out;
  }
}

// 写入 instanced 变换
export function compose(pos, rot, scl, out = new THREE.Matrix4()) {
  _e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
  _q.setFromEuler(_e);
  _t.set(pos[0], pos[1], pos[2]);
  if (typeof scl === 'number') _s.set(scl, scl, scl);
  else _s.set(scl[0], scl[1], scl[2]);
  return out.compose(_t, _q, _s);
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
