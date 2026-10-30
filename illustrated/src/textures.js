import * as THREE from 'three';
import { Rng } from './utils.js';

// ============================================================ 可平铺噪声纹理
function lhash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const a = lhash(x0, y0, seed), b = lhash(x1, y0, seed), c = lhash(x0, y1, seed), d = lhash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pfbm(x, y, period, oct, seed) {
  let s = 0, a = 0.5, n = 0, f = 1, p = period;
  for (let o = 0; o < oct; o++) {
    s += a * pnoise(x * f, y * f, p, seed + o * 31);
    n += a;
    a *= 0.5;
    f *= 2;
    p *= 2;
  }
  return s / n;
}

function stretch(arr) {
  // 按 1%/99% 分位拉伸到 0..1
  const sorted = Float32Array.from(arr).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.floor(sorted.length * 0.99)];
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, Math.max(0, (arr[i] - lo) * k));
}

/**
 * R: 低频 fbm   G: 高频 fbm   B: Worley F1（细胞）   A: 中频 fbm
 */
export function createNoise(size = 512) {
  const n = size * size;
  const R = new Float32Array(n), G = new Float32Array(n), Bc = new Float32Array(n), A = new Float32Array(n);
  const cells = 14;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      R[i] = pfbm(u * 4, v * 4, 4, 5, 1);
      G[i] = pfbm(u * 16, v * 16, 16, 4, 2);
      A[i] = pfbm(u * 8, v * 8, 8, 4, 3);
      const px = u * cells, py = v * cells;
      const cx = Math.floor(px), cy = Math.floor(py);
      let dmin = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox, gy = cy + oy;
          const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
          const fx = gx + lhash(wx, wy, 91), fy = gy + lhash(wx, wy, 92);
          const d = Math.hypot(px - fx, py - fy);
          if (d < dmin) dmin = d;
        }
      }
      Bc[i] = dmin;
    }
  }
  stretch(R);
  stretch(G);
  stretch(A);
  stretch(Bc);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = R[i] * 255;
    data[i * 4 + 1] = G[i] * 255;
    data[i * 4 + 2] = Bc[i] * 255;
    data[i * 4 + 3] = A[i] * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  // CPU 侧双线性采样（与着色器一致的平铺）
  const sample = (u, v, ch) => {
    const fx = (u - Math.floor(u)) * size - 0.5;
    const fy = (v - Math.floor(v)) * size - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const g = (xx, yy) => data[((((yy % size) + size) % size) * size + (((xx % size) + size) % size)) * 4 + ch] / 255;
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return { tex, sample };
}

// ============================================================ 画布工具
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// 把透明像素的颜色向外扩张，避免 mipmap 黑边；并转成 DataTexture
// 保持 alpha 覆盖率的 mipmap（远处叶片不会变稀、变噪）
function coverageMips(data0, w0, h0, thr = 127) {
  const cov = (d) => {
    let c = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > thr) c++;
    return c / (d.length / 4);
  };
  const target = cov(data0);
  const levels = [{ data: data0, width: w0, height: h0 }];
  let src = data0, w = w0, h = h0;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh * 4);
    const alpha = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0, g = 0, b = 0, a = 0, cr = 0, cg = 0, cb = 0;
        for (let oy = 0; oy < 2; oy++) {
          for (let ox = 0; ox < 2; ox++) {
            const sx = Math.min(w - 1, x * 2 + ox), sy = Math.min(h - 1, y * 2 + oy);
            const i = (sy * w + sx) * 4;
            const aa = src[i + 3] / 255;
            r += src[i] * aa;
            g += src[i + 1] * aa;
            b += src[i + 2] * aa;
            cr += src[i];
            cg += src[i + 1];
            cb += src[i + 2];
            a += aa;
          }
        }
        const j = (y * nw + x) * 4;
        if (a > 1e-3) {
          dst[j] = r / a;
          dst[j + 1] = g / a;
          dst[j + 2] = b / a;
        } else {
          dst[j] = cr / 4;
          dst[j + 1] = cg / 4;
          dst[j + 2] = cb / 4;
        }
        alpha[y * nw + x] = (a / 4) * 255;
      }
    }
    // 二分搜索缩放系数，使 alpha>thr 的比例与原图一致
    let lo = 0.5, hi = 8;
    for (let it = 0; it < 14; it++) {
      const s = (lo + hi) / 2;
      let c = 0;
      for (let i = 0; i < alpha.length; i++) if (alpha[i] * s > thr) c++;
      if (c / alpha.length < target) lo = s;
      else hi = s;
    }
    const s = (lo + hi) / 2;
    for (let i = 0; i < alpha.length; i++) dst[i * 4 + 3] = Math.min(255, alpha[i] * s);
    levels.push({ data: dst, width: nw, height: nh });
    src = dst;
    w = nw;
    h = nh;
  }
  return levels;
}

function finalize(cv, { srgb = true, dilate = 8, flip = true, mip = true, coverage = true } = {}) {
  const w = cv.width, h = cv.height;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < dilate; pass++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= h) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (filled[j]) {
              r += d[j * 4];
              g += d[j * 4 + 1];
              b += d[j * 4 + 2];
              c++;
            }
          }
        }
        if (c) {
          d[i * 4] = r / c;
          d[i * 4 + 1] = g / c;
          d[i * 4 + 2] = b / c;
          next[i] = 1;
        }
      }
    }
    filled = next;
  }
  // 剩余像素填平均色
  let ar = 0, ag = 0, ab = 0, ac = 0;
  for (let i = 0; i < w * h; i++)
    if (d[i * 4 + 3] > 8) {
      ar += d[i * 4];
      ag += d[i * 4 + 1];
      ab += d[i * 4 + 2];
      ac++;
    }
  if (ac) {
    ar /= ac;
    ag /= ac;
    ab /= ac;
    for (let i = 0; i < w * h; i++)
      if (!filled[i]) {
        d[i * 4] = ar;
        d[i * 4 + 1] = ag;
        d[i * 4 + 2] = ab;
      }
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = flip ? h - 1 - y : y;
    out.set(d.subarray(sy * w * 4, (sy + 1) * w * 4), y * w * 4);
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (mip && coverage) {
    tex.mipmaps = coverageMips(out, w, h);
    tex.generateMipmaps = false;
  } else tex.generateMipmaps = mip;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function leafShape(ctx, len, wid, tipBend = 0) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid * 0.95, -len * 0.18, wid * 1.0 + tipBend, -len * 0.72, tipBend, -len);
  ctx.bezierCurveTo(-wid * 1.0 + tipBend, -len * 0.72, -wid * 0.95, -len * 0.18, 0, 0);
  ctx.closePath();
}

// 风格化叶片：平涂 + 半边暗面 + 一笔亮色叶脉，不做写实渐变
function drawLeaf(ctx, x, y, ang, len, wid, h, s, l, opts = {}) {
  const { vein = 0.45, petiole = 0.12, bend = 0, split = 0.12 } = opts;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (petiole > 0) {
    ctx.strokeStyle = hsl(h, s * 0.8, l * 0.72);
    ctx.lineWidth = Math.max(1.5, wid * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * petiole);
    ctx.stroke();
    ctx.translate(0, -len * petiole);
  }
  ctx.fillStyle = hsl(h, s, l);
  leafShape(ctx, len, wid, bend);
  ctx.fill();
  ctx.save();
  leafShape(ctx, len, wid, bend);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${split})`;
  ctx.fillRect(0, -len, wid * 1.3, len);
  ctx.fillStyle = 'rgba(255,255,235,0.14)';
  ctx.beginPath();
  ctx.ellipse(-wid * 0.3, -len * 0.62, wid * 0.32, len * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (vein > 0) {
    ctx.strokeStyle = hsl(h, s * 0.5, Math.min(97, l * 1.16), vein);
    ctx.lineWidth = Math.max(1, wid * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(bend * 0.4, -len * 0.5, bend, -len * 0.88);
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================================ 叶簇贴图
// 插画版：概括的叶团。一整块实心的团，边缘一圈朝外的小叶片形成锯齿状轮廓，
// 团内只有几块很淡的叶簇色斑；色相交给实例颜色，明暗交给光照
export function leafClusterTexture({ size = 512, seed = 1, lobes = 6, light = 86, leafLen = [20, 32] } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  const C = size * 0.5, R = size * 0.49;
  const S = size / 512;
  const fill = (l) => hsl(rng.range(76, 88), rng.range(10, 14), l);
  const lobeList = [];
  for (let i = 0; i < lobes; i++) {
    const a = rng.r() * Math.PI * 2, d = Math.sqrt(rng.r()) * size * 0.15;
    const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d * 0.9;
    const r = Math.min(rng.range(0.15, 0.21) * size, R - Math.hypot(x - C, y - C) - leafLen[1] * S * 1.1);
    if (r > size * 0.06) lobeList.push({ x, y, r });
  }
  const inside = (x, y, skip) => lobeList.some((L, j) => j !== skip && Math.hypot(x - L.x, y - L.y) < L.r * 0.97);
  // 实心团
  for (const L of lobeList) {
    ctx.fillStyle = fill(light);
    ctx.beginPath();
    ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 边缘一圈朝外的小叶片
  const leaf = (x, y, ang, len, wid, l) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = fill(l);
    ctx.beginPath();
    ctx.ellipse(0, -len * 0.5, wid, len * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  lobeList.forEach((L, j) => {
    const n = Math.round((L.r / size) * 260);
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const bx = L.x + Math.cos(t) * L.r * 0.92, by = L.y + Math.sin(t) * L.r * 0.92;
      if (inside(bx, by, j)) continue;
      const len = rng.range(leafLen[0], leafLen[1]) * S;
      leaf(bx, by, t + Math.PI / 2 + rng.range(-0.3, 0.3), len, len * rng.range(0.42, 0.55), light + rng.range(-2, 3));
    }
  });
  // 团内几块很淡的叶簇色斑：上方略亮，下方略暗
  for (let k = 0; k < 7; k++) {
    const L = rng.pick(lobeList);
    const a = rng.r() * Math.PI * 2, d = Math.sqrt(rng.r()) * L.r * 0.6;
    const cx = L.x + Math.cos(a) * d, cy = L.y + Math.sin(a) * d;
    const up = cy < C;
    const l = light + (up ? rng.range(4, 7) : -rng.range(4, 7));
    for (let m = 0; m < 5; m++) {
      const len = rng.range(leafLen[0], leafLen[1]) * S * 0.9;
      leaf(cx + rng.range(-14, 14) * S, cy + rng.range(-10, 10) * S, rng.range(-1.2, 1.2) + (up ? 0 : Math.PI), len, len * 0.5, l);
    }
  }
  return finalize(cv);
}

// 常春藤 / 爬山虎叶
export function ivyTexture({ size = 256, seed = 3 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#7c6a55';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size);
  const pts = [];
  let x = size * 0.5, y = size;
  for (let i = 0; i < 6; i++) {
    x += rng.range(-18, 18);
    y -= size * 0.15;
    ctx.lineTo(x, y);
    pts.push([x, y]);
  }
  ctx.stroke();
  const lv = [];
  for (let i = 0; i < 9; i++) {
    const p = pts[Math.min(pts.length - 1, Math.floor(rng.r() * pts.length))];
    lv.push({ x: p[0], y: p[1], a: rng.range(-1.4, 1.4), d: rng.r() });
  }
  lv.sort((a, b) => a.d - b.d);
  for (const l of lv) {
    const L = rng.range(48, 70);
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.a);
    const li = 60 + 30 * l.d;
    ctx.strokeStyle = '#7c6a55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -L * 0.22);
    ctx.stroke();
    ctx.translate(0, -L * 0.22);
    const shape = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(L * 0.55, L * 0.12, L * 0.62, -L * 0.42, L * 0.2, -L * 0.5);
      ctx.quadraticCurveTo(L * 0.2, -L * 0.75, 0, -L * 0.95);
      ctx.quadraticCurveTo(-L * 0.2, -L * 0.75, -L * 0.2, -L * 0.5);
      ctx.bezierCurveTo(-L * 0.62, -L * 0.42, -L * 0.55, L * 0.12, 0, 0);
    };
    ctx.fillStyle = hsl(rng.range(80, 95), 22, li);
    shape();
    ctx.fill();
    ctx.save();
    shape();
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, -L, L, L * 1.2);
    ctx.restore();
    ctx.strokeStyle = hsl(85, 20, Math.min(97, li * 1.15), 0.5);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -L * 0.85);
    ctx.stroke();
    ctx.restore();
  }
  return finalize(cv);
}

// 蕨类叶片
export function fernTexture({ w = 128, h = 512, seed = 5 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#8c9a6a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 6);
  ctx.stroke();
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y = h - 20 - t * (h - 30);
    const L = w * 0.47 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - t * 0.35);
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.rotate(sgn * (1.05 - t * 0.3));
      ctx.fillStyle = hsl(rng.range(82, 92), 24, sgn > 0 ? rng.range(64, 72) : rng.range(74, 84));
      ctx.beginPath();
      ctx.moveTo(-L * 0.12, 0);
      ctx.quadraticCurveTo(-L * 0.2, -L * 0.6, 0, -L);
      ctx.quadraticCurveTo(L * 0.2, -L * 0.6, L * 0.12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  return finalize(cv);
}

// 落叶图集 4x4：橙、黄、红、绿，平涂
export function fallenLeafAtlas({ size = 256, seed = 9 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  const c = size / 4;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const k = j * 4 + i;
      let h, s, l;
      if (k < 5) [h, s, l] = [rng.range(20, 30), rng.range(70, 82), rng.range(50, 58)];
      else if (k < 10) [h, s, l] = [rng.range(40, 50), rng.range(75, 88), rng.range(55, 62)];
      else if (k < 12) [h, s, l] = [rng.range(4, 12), rng.range(62, 72), rng.range(46, 52)];
      else [h, s, l] = [rng.range(78, 96), rng.range(40, 55), rng.range(42, 50)];
      const L = c * rng.range(0.62, 0.8);
      const W = L * (k % 3 === 0 ? 0.5 : 0.38);
      drawLeaf(ctx, i * c + c / 2, j * c + c * 0.9, rng.range(-0.3, 0.3), L, W, h, s, l, { petiole: 0.1, vein: 0.55, bend: rng.range(-3, 3), split: 0.12 });
    }
  }
  return finalize(cv, { dilate: 4 });
}

// ============================================================ 校名字
export function charTexture(ch, { size = 256, font = '"KaiTi","STKaiti","楷体","Kaiti SC","SimSun",serif' } = {}) {
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size * 0.86}px ${font}`;
  ctx.fillText(ch, size / 2, size * 0.53);
  return finalize(cv, { srgb: true, dilate: 2 });
}

export function textStripTexture(text, { w = 2048, h = 128, font = '"Times New Roman",serif' } = {}) {
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fs = h * 0.62;
  ctx.font = `600 ${fs}px ${font}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${h * 0.12}px`;
  while (ctx.measureText(text).width > w * 0.94 && fs > 8) {
    fs -= 2;
    ctx.font = `600 ${fs}px ${font}`;
  }
  ctx.fillText(text, w / 2, h * 0.54);
  return finalize(cv, { dilate: 2 });
}

// ============================================================ 首层壁画（学生作品）
export function muralTexture({ w = 1024, h = 384, seed = 21 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#e9dcc0';
  ctx.fillRect(0, 0, w, h);
  // 色块构成
  const cols = ['#c8372d', '#1f4e8c', '#e8b923', '#2a8c6a', '#e86a2b', '#18202a', '#7a3f8c', '#f2efe6'];
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = cols[1];
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.fillStyle = cols[0];
  ctx.beginPath();
  ctx.arc(w * 0.22, h * 0.42, h * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cols[2];
  ctx.beginPath();
  ctx.moveTo(w * 0.38, h);
  ctx.lineTo(w * 0.55, h * 0.12);
  ctx.lineTo(w * 0.72, h);
  ctx.fill();
  ctx.fillStyle = cols[3];
  ctx.fillRect(w * 0.74, h * 0.1, w * 0.18, h * 0.62);
  // 波浪条纹
  ctx.strokeStyle = cols[7];
  ctx.lineWidth = 10;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = h * (0.66 + k * 0.08) + Math.sin(x * 0.018 + k) * 12;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 眼睛
  ctx.fillStyle = cols[7];
  ctx.beginPath();
  ctx.ellipse(w * 0.83, h * 0.36, 70, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cols[5];
  ctx.beginPath();
  ctx.arc(w * 0.83, h * 0.36, 24, 0, Math.PI * 2);
  ctx.fill();
  // 书法笔触
  ctx.strokeStyle = cols[5];
  ctx.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    ctx.lineWidth = rng.range(4, 16);
    ctx.beginPath();
    let x = rng.range(0, w), y = rng.range(0, h);
    ctx.moveTo(x, y);
    for (let i = 0; i < 4; i++) {
      x += rng.range(-90, 90);
      y += rng.range(-50, 50);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = cols[5];
  ctx.font = 'bold 150px "KaiTi","STKaiti",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('美', w * 0.22, h * 0.44);
  ctx.font = '600 34px "Arial Black",sans-serif';
  ctx.fillStyle = cols[7];
  ctx.fillText('GAFA · 毕业展', w * 0.55, h * 0.9);
  return finalize(cv, { dilate: 0 });
}

// 画架上的油画
export function paintingTexture({ w = 256, h = 320, seed = 4 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#6f97c4');
  sky.addColorStop(1, '#e9cf9a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#56708a';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.55);
  for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * 0.5 - Math.sin(x * 0.03) * 30 - rng.range(0, 14));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.fillStyle = '#3d5a2a';
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = hsl(rng.range(70, 110), 40, rng.range(15, 35), 0.9);
    ctx.beginPath();
    ctx.arc(rng.range(0, w), rng.range(h * 0.55, h * 0.8), rng.range(6, 22), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#b54a2a';
  ctx.fillRect(w * 0.6, h * 0.5, 40, 30);
  ctx.fillStyle = '#7c2f1e';
  ctx.beginPath();
  ctx.moveTo(w * 0.6 - 6, h * 0.5);
  ctx.lineTo(w * 0.6 + 20, h * 0.44);
  ctx.lineTo(w * 0.6 + 46, h * 0.5);
  ctx.fill();
  // 霉斑
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${rng.range(40, 90)},${rng.range(50, 80)},${rng.range(30, 50)},${rng.range(0.1, 0.4)})`;
    ctx.beginPath();
    ctx.arc(rng.range(0, w), rng.range(0, h), rng.range(2, 14), 0, Math.PI * 2);
    ctx.fill();
  }
  return finalize(cv, { dilate: 0 });
}

// 粒子柔光点
export function dotTexture(size = 64) {
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// 远景树线：两层平涂剪影（尖顶树 + 圆冠树），亮面 / 暗面各一色
export function treelineTexture({ w = 4096, h = 512, seed = 12 } = {}) {
  const rng = new Rng(seed);
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  const conifer = (x, yBase, H, W, lit, dark) => {
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const ty = yBase - H * (t / tiers) * 0.62;
      const tw = W * (1 - (t / tiers) * 0.62);
      const th = H * 0.42;
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(x - tw / 2, ty);
      ctx.lineTo(x, ty - th);
      ctx.lineTo(x + tw / 2, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(x + tw * 0.04, ty);
      ctx.lineTo(x, ty - th);
      ctx.lineTo(x + tw / 2, ty);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = lit;
    ctx.fillRect(x - W * 0.3, yBase - 1, W * 0.6, h - yBase + 1);
  };
  const blob = (x, y, r, lit, dark) => {
    const k = 14;
    const pts = [];
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2;
      const rr = r * (0.86 + 0.2 * rng.r());
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86]);
    }
    const path = () => {
      ctx.beginPath();
      for (let j = 0; j <= k; j++) {
        const p = pts[j % k], q = pts[(j + 1) % k];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        j ? ctx.quadraticCurveTo(p[0], p[1], mx, my) : ctx.moveTo(mx, my);
      }
      ctx.closePath();
    };
    ctx.fillStyle = lit;
    path();
    ctx.fill();
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x + r * 0.45, y + r * 0.35, r * 0.95, r * 0.8, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = dark;
    ctx.fillRect(x - r * 0.8, y + r * 0.3, r * 1.6, h - y);
  };
  const layer = (n, yBase, sMin, sMax, lit, dark) => {
    for (let i = 0; i < n; i++) {
      const x = rng.range(-sMax, w + sMax);
      const s = rng.range(sMin, sMax);
      const y = yBase - rng.range(0, h * 0.22) * rng.r();
      if (rng.chance(0.45)) conifer(x, y + s * 0.3, s * 2.4, s * 1.25, lit, dark);
      else blob(x, y, s * 0.75, lit, dark);
    }
  };
  layer(150, h * 0.6, 45, 95, '#bccbc6', '#a8bcbd');
  layer(170, h * 0.74, 38, 80, '#a3b49b', '#8ea49c');
  const t = finalize(cv, { dilate: 4 });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
