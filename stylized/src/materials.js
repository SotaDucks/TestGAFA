import * as THREE from 'three';

// 全局共享 uniform
export const shared = {
  uTime: { value: 0 },
  tNoise: { value: null },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, // 视空间太阳方向（每帧更新）
  uSunCol: { value: new THREE.Color(1, 0.85, 0.65) },
  // 风格化环境光：天空一侧偏蓝紫，地面一侧偏暖绿 —— 阴影因此带色相，而不是变黑
  uSkyAmb: { value: new THREE.Color(0.3, 0.34, 0.64) },
  uGroundAmb: { value: new THREE.Color(0.3, 0.27, 0.27) },
};

// sRGB 十六进制 → 线性空间 GLSL 常量
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

// ======================================================================
// 卡通光照：两段式明暗 + 笔触扰动的交界线 + 带色相的环境光 + 边缘光
// 替换 Lambert 的整段光照累积
// ======================================================================
const W_VERT_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
`;

const W_VERT = /* glsl */ `
{
  vec4 wp4 = vec4(transformed, 1.0);
  vec3 wn3 = objectNormal;
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
    wn3 = mat3(instanceMatrix) * wn3;
  #endif
  wp4 = modelMatrix * wp4;
  vWPos = wp4.xyz;
  vWNormal = normalize(mat3(modelMatrix) * wn3);
}
`;

const TOON_PARS = /* glsl */ `
uniform sampler2D tNoise;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec4 uToon; // x 明暗交界位置  y 交界柔和度  z 笔触扰动  w 边缘光
uniform float uSpec;
varying vec3 vWPos;
varying vec3 vWNormal;
`;

const toonLight = (extra = '') => /* glsl */ `
{
  vec3 N = normal;
  vec3 Vd = normalize(vViewPosition);
  vec3 nW = inverseTransformDirection(N, viewMatrix);
  vec3 L = vec3(0.0, 1.0, 0.0);
  vec3 Lc = vec3(0.0);
  float sh = 1.0;
  #if NUM_DIR_LIGHTS > 0
    L = directionalLights[0].direction;
    Lc = directionalLights[0].color;
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow dls = directionalLightShadows[0];
      sh = receiveShadow ? getShadow(directionalShadowMap[0], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
    #endif
  #endif
  float ndl = dot(N, L);
  // 世界空间的低频噪声让明暗交界像笔刷一样起伏
  float brush = texture2D(tNoise, vWPos.xz * 0.23 + vWPos.y * vec2(0.17, -0.13)).g - 0.5;
  float lit = smoothstep(uToon.x - uToon.y, uToon.x + uToon.y, ndl + brush * uToon.z);
  float shT = smoothstep(0.32, 0.68, sh + brush * uToon.z * 0.5);
  lit *= shT;
  // 亮面内保留一点点体积过渡
  float body = 0.8 + 0.2 * smoothstep(0.15, 0.95, ndl);
  vec3 amb = mix(uGroundAmb, uSkyAmb, smoothstep(-0.6, 0.8, nW.y));
  float fres = pow(1.0 - saturate(dot(N, Vd)), 4.0);
  vec3 lightCol = Lc * (lit * body) + amb + Lc * fres * uToon.w * (0.25 + 0.75 * lit);
  vec3 Hh = normalize(L + Vd);
  float sp = smoothstep(0.965, 0.985, dot(N, Hh)) * lit * uSpec;
  ${extra}
  reflectedLight.directDiffuse = diffuseColor.rgb * lightCol + Lc * sp;
}
`;

function patchToon(s, { extraPars = '', extraLight = '', albedo = null } = {}) {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\n' + W_VERT_PARS)
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + W_VERT);
  let fs = s.fragmentShader
    .replace('#include <common>', '#include <common>\n' + TOON_PARS + extraPars)
    .replace('#include <lights_fragment_begin>', toonLight(extraLight))
    .replace('#include <lights_fragment_maps>', '')
    .replace('#include <lights_fragment_end>', '');
  if (albedo) fs = fs.replace('#include <map_fragment>', albedo);
  s.fragmentShader = fs;
}

function toonUniforms({ edge = 0.0, soft = 0.05, brush = 0.35, rim = 0.3, spec = 0 } = {}) {
  return {
    tNoise: shared.tNoise,
    uSkyAmb: shared.uSkyAmb,
    uGroundAmb: shared.uGroundAmb,
    uToon: { value: new THREE.Vector4(edge, soft, brush, rim) },
    uSpec: { value: spec },
  };
}

// 纯色卡通材质（小物件、鸟、蝴蝶、校名字）
export function toon(opts = {}) {
  const { color = '#ffffff', map = null, alphaTest = 0, side = THREE.FrontSide, transparent = false, opacity = 1, depthWrite = true, vertexColors = false, edge, soft, brush, rim, spec, polygonOffset = false } = opts;
  const mat = new THREE.MeshLambertMaterial({ color, map, alphaTest, side, transparent, opacity, depthWrite, vertexColors });
  if (polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
  }
  const u = toonUniforms({ edge, soft, brush, rim, spec });
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchToon(s);
  };
  mat.customProgramCacheKey = () => 'toon';
  return mat;
}

// ======================================================================
// 手绘材质：混凝土 / 油漆 / 铁件 / 树皮 / 石板路 / 草地 / 木头
// 世界空间三平面噪声 → 量化成柔和色块与笔触，而不是写实的风化细节
// ======================================================================
const P_PARS = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uPaint;
uniform float uPaintAmount;
uniform float uMoss;
uniform float uStreaks;
uniform float uDirt;
uniform float uScale;
uniform float uBump;
uniform float uSeed;
uniform vec4 uRect;
uniform float uDecal;
float wHeight = 0.0;
float wMoss = 0.0;
float wPaintM = 0.0;
vec4 triN(vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  return texture2D(tNoise, p.zy * s) * w.x + texture2D(tNoise, p.xz * s + 0.37) * w.y + texture2D(tNoise, p.xy * s + 0.71) * w.z;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float band(float x, float e, float w) { return smoothstep(e - w, e + w, x); }
`;

const P_ALBEDO = /* glsl */ `
vec3 wN = normalize(vWNormal);
vec3 wp = vWPos * uScale + vec3(uSeed);
vec4 nA = triN(wp, wN, 0.11);
vec4 nB = triN(wp, wN, 0.55);
vec4 nC = triN(wp, wN, 2.7);
float upF = smoothstep(0.5, 0.95, wN.y);
float vertF = 1.0 - abs(wN.y);
float hcoord = mix(vWPos.x, vWPos.z, abs(wN.x)) * uScale;
// 笔触：水平拉长 + 竖向拉长的噪声
float strokeH = texture2D(tNoise, vec2(hcoord * 0.45 + uSeed, vWPos.y * 2.6 * uScale)).a;
float strokeV = texture2D(tNoise, vec2(hcoord * 2.2, vWPos.y * 0.35 + uSeed)).a;
float stroke = mix(strokeH, strokeV, 0.35) - 0.5;
float patchA = band(nA.r, 0.5, 0.05);
float patchB = band(nB.g, 0.53, 0.04);
float stA = texture2D(tNoise, vec2(hcoord * 0.31 + uSeed, vWPos.y * 0.021)).g;
float stB = texture2D(tNoise, vec2(hcoord * 1.17, vWPos.y * 0.05 + uSeed)).r;
float streak = band(stA * 0.75 + stB * 0.45, 0.74, 0.05) * vertF * uStreaks;
float gl1 = 1.0 - smoothstep(0.0, 0.8, vWPos.y);
float gl2 = (1.0 - smoothstep(2.4, 2.9, vWPos.y)) * step(2.36, vWPos.y);
float grime = max(gl1, gl2) * uDirt;
float mossGate = max(upF, max(grime, streak * 0.5));
float mossBias = 0.0;
float mossH = 0.4;
vec3 wCol = uBase;

#if defined(KIND_CONCRETE)
  wCol = uBase * (0.94 + 0.08 * patchA - 0.06 * patchB + stroke * 0.1);
  wCol = mix(wCol, wCol * vec3(1.05, 1.0, 0.9), band(nA.a, 0.56, 0.05) * 0.6);
  wCol = mix(wCol, wCol * vec3(0.93, 0.96, 1.07), band(nB.r, 0.6, 0.05) * 0.55);
  float crv = abs(nB.a - 0.5);
  float crack = (1.0 - smoothstep(0.006, 0.013, crv)) * band(nA.g, 0.64, 0.04);
  wCol *= 1.0 - 0.3 * crack;
  wHeight = patchA * 0.3 + nB.g * 0.2 - crack * 0.5;
  #ifdef USE_PAINT
    float pmN = nB.r * 0.55 + nA.g * 0.5 + nC.r * 0.12;
    float thr = 0.86 - 0.62 * uPaintAmount;
    wPaintM = smoothstep(thr, thr + 0.012, pmN);
    float rim = smoothstep(thr - 0.045, thr, pmN) * (1.0 - wPaintM);
    vec3 pc = uPaint * (0.95 + 0.08 * patchA - 0.05 * patchB + stroke * 0.12);
    pc = mix(pc, pc * vec3(1.07, 1.0, 0.9), band(nA.a, 0.5, 0.05) * 0.5);
    wCol = mix(wCol, pc, wPaintM);
    // 剥落边缘一圈浅色（手绘描边感）
    wCol = mix(wCol, ${lin('#fff6e6')}, rim * 0.4);
    wHeight += wPaintM * 0.6;
  #endif
#elif defined(KIND_RUST)
  float rn = nB.r * 0.6 + nC.g * 0.5;
  wCol = mix(${lin('#6a3f2c')}, mix(${lin('#a85a33')}, ${lin('#d48446')}, band(nC.r, 0.56, 0.06)), band(rn, 0.45, 0.08));
  wHeight = nC.g * 0.4;
  #ifdef USE_PAINT
    wPaintM = band(nA.r * 0.6 + nB.g * 0.5 + uPaintAmount * 0.3 - 0.15, 0.6, 0.012);
    wCol = mix(wCol, uPaint * (0.92 + 0.12 * nC.r + stroke * 0.1), wPaintM);
  #endif
  mossGate *= 0.3;
#elif defined(KIND_BARK)
  float b1 = texture2D(tNoise, vec2(vUv.x, vUv.y * 0.03)).r;
  float b2 = texture2D(tNoise, vec2(vUv.x, vUv.y * 0.08)).a;
  float ridge = band(b1, 0.5, 0.07);
  wCol = uBase * (0.82 + 0.24 * ridge) * (0.9 + 0.16 * band(b2, 0.5, 0.08));
  wCol *= 1.0 - 0.2 * (1.0 - band(b2, 0.28, 0.05));
  float lich = band(nB.a * 0.8 + nC.r * 0.35, 0.8, 0.025);
  wCol = mix(wCol, ${lin('#9fb071')}, lich * 0.5);
  wHeight = ridge * 0.6 + b2 * 0.3;
  streak *= 0.2;
  grime *= 0.3;
#elif defined(KIND_PAVERS)
  vec2 pp = vWPos.xz;
  const float TW = 1.2;
  const float TH = 0.6;
  float row = floor(pp.y / TH);
  float px = pp.x + mod(row, 2.0) * TW * 0.5;
  vec2 cell = vec2(floor(px / TW), row);
  vec2 tf = vec2(px - cell.x * TW, pp.y - row * TH);
  // 圆角石块
  const float CR = 0.1;
  vec2 q = abs(tf - vec2(TW, TH) * 0.5) - (vec2(TW, TH) * 0.5 - CR);
  float ed = -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - CR);
  float hc = hash12(cell + 0.5);
  float hc2 = hash12(cell * 1.37 + 11.1);
  float hc3 = hash12(cell * 2.11 + 3.7);
  float edgeD = min(min(pp.x - uRect.x, uRect.y - pp.x), min(pp.y - uRect.z, uRect.w - pp.y));
  float wild = 1.0 - smoothstep(-1.0, 6.0, edgeD + (nA.r - 0.5) * 9.0);
  float damage = smoothstep(0.55, 0.82, texture2D(tNoise, pp * 0.021 + 0.3).r + wild * 0.5);
  float missing = step(hc2, damage * 0.5 + wild * 0.75);
  // 每块石头一点冷暖色差
  vec3 tint = mix(${lin('#e2e8f1')}, ${lin('#f2eadb')}, hc3);
  tint = mix(tint, ${lin('#dfe7e0')}, step(0.9, hc) * 0.6);
  vec3 stone = uBase * tint * (0.9 + 0.16 * hc) * (0.96 + 0.06 * band(nC.g, 0.5, 0.1));
  float dirt = band(nA.r * 0.75 + nB.g * 0.35 + texture2D(tNoise, pp * 0.013 + 0.61).a * 0.35, 0.7, 0.05);
  stone *= 1.0 - 0.12 * dirt;
  // 石块边缘略暗，表现圆润体积
  stone *= mix(0.84, 1.0, smoothstep(0.0, 0.11, ed));
  float seamW = 0.012 + 0.02 * damage;
  float seam = 1.0 - smoothstep(seamW, seamW + 0.008, ed + (nC.r - 0.5) * 0.01);
  vec3 grassC = mix(${lin('#4a8530')}, ${lin('#6f9f3a')}, band(nB.r, 0.5, 0.1));
  vec3 seamCol = mix(${lin('#6d6a66')}, grassC, smoothstep(0.25, 0.55, damage + wild + nB.a * 0.25));
  wCol = mix(stone, seamCol, seam);
  wCol = mix(wCol, grassC * (0.9 + 0.15 * nC.g), missing);
  vec2 tilt = (vec2(hc, hc2) - 0.5) * 0.02 * (0.35 + damage);
  wHeight = smoothstep(0.0, 0.12, ed) * 0.012 * (1.0 - missing) + dot(tf - vec2(TW, TH) * 0.5, tilt) * (1.0 - missing) - missing * 0.02;
  grime = 0.0;
  streak = 0.0;
  mossGate = 1.0;
  mossBias = missing * 0.35 + seam * 0.2 * damage + damage * 0.2 + wild * 0.5 + dirt * 0.1 - 0.5;
  mossH = 0.002;
#elif defined(KIND_SOIL)
  // 草地：大色块 + 小色块 + 偶尔露出的土
  float m1 = band(nA.r, 0.5, 0.06);
  float m2 = band(nB.g, 0.56, 0.05);
  float m3 = band(nC.r, 0.55, 0.08);
  wCol = mix(${lin('#3f7d2b')}, ${lin('#5f9c30')}, m1);
  wCol = mix(wCol, ${lin('#8dbb3e')}, m2 * 0.55);
  wCol *= 0.94 + 0.1 * m3;
  float dp = band(nA.a * 0.8 + nB.r * 0.3, 0.8, 0.025);
  wCol = mix(wCol, ${lin('#9b7a4c')} * (0.92 + 0.16 * nC.g), dp * 0.8);
  wHeight = nC.g * 0.01;
  grime = 0.0;
  streak = 0.0;
  mossGate = 0.0;
  mossH = 0.0;
#elif defined(KIND_WOOD)
  float gr = texture2D(tNoise, vec2(nC.r * 0.3 + hcoord * 0.2, vWPos.y * 0.15 + nB.g * 0.4)).g;
  wCol = uBase * (0.84 + 0.26 * band(gr, 0.5, 0.08)) * (0.92 + 0.1 * nB.r);
  wHeight = gr * 0.3;
#endif

#ifdef USE_MAP
  {
    vec4 dc = texture2D(map, vMapUv);
    vec2 eu = abs(vMapUv - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.86, 0.9, max(eu.x, eu.y) + (nB.r - 0.5) * 0.15);
    float keep = band(nB.r * 0.6 + nC.g * 0.3 + nA.g * 0.4, 0.42, 0.02) * edge * dc.a * uDecal;
    wCol = mix(wCol, dc.rgb, keep);
    wPaintM = max(wPaintM, keep);
  }
#endif

wCol = mix(wCol, wCol * ${lin('#c7d0d6')}, streak * 0.75);
wCol = mix(wCol, wCol * ${lin('#d6cbb4')}, grime * (0.55 + 0.45 * band(nB.r, 0.5, 0.1)));

float mossN = nA.g * 0.6 + nB.r * 0.5;
float mossM = band(mossN + upF * 0.25 + grime * 0.35 + streak * 0.15 + mossBias, 0.8, 0.018) * mossGate * uMoss;
vec3 mossCol = mix(${lin('#4c8a34')}, ${lin('#7aa83e')}, band(nC.r * 0.7 + nB.g * 0.3, 0.5, 0.05));
mossCol = mix(mossCol, ${lin('#98bb58')}, upF * 0.3);
wCol = mix(wCol, mossCol, mossM);
wMoss = mossM;
wHeight += mossM * mossH;
diffuseColor.rgb *= wCol;
`;

const P_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 dpx = dFdx(-vViewPosition);
  vec3 dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal);
  vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1) * faceDirection;
  vec2 dh = vec2(dFdx(wHeight), dFdy(wHeight)) * uBump;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;

export function painted(opts = {}) {
  const {
    kind = 'concrete',
    color = '#d8d2c6',
    paint = null,
    paintAmount = 0.8,
    moss = 1,
    streaks = 1,
    dirt = 1,
    scale = 1,
    bump = null,
    seed = 0,
    map = null,
    decal = 1,
    rect = [-1e4, 1e4, -1e4, 1e4],
    side = THREE.FrontSide,
    edge = 0.0,
    soft = 0.05,
    brush = 0.35,
    rim = 0.3,
    spec = 0,
  } = opts;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side, map });
  mat.defines = { ['KIND_' + kind.toUpperCase()]: '' };
  if (paint) mat.defines.USE_PAINT = '';
  if (kind === 'bark') mat.defines.USE_UV = '';
  const defBump = { concrete: 0.006, rust: 0.006, bark: 0.018, pavers: 1.0, soil: 1.0, wood: 0.006 }[kind];
  const u = {
    ...toonUniforms({ edge, soft, brush, rim, spec }),
    uBase: { value: new THREE.Color(color) },
    uPaint: { value: new THREE.Color(paint || '#000000') },
    uPaintAmount: { value: paintAmount },
    uMoss: { value: moss },
    uStreaks: { value: streaks },
    uDirt: { value: dirt },
    uScale: { value: scale },
    uBump: { value: bump ?? defBump },
    uSeed: { value: seed },
    uRect: { value: new THREE.Vector4(...rect) },
    uDecal: { value: decal },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchToon(s, { extraPars: P_PARS, albedo: P_ALBEDO });
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', P_NORMAL);
  };
  mat.customProgramCacheKey = () => 'painted';
  return mat;
}

// ======================================================================
// 植被材质：风动 + 球面法线（团块状明暗）+ 逆光透色
// ======================================================================
const WIND = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uFlutter;
vec3 windOffset(vec3 p) {
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
  ip = (modelMatrix * vec4(ip, 1.0)).xyz;
  float ph = dot(ip, vec3(0.37, 0.11, 0.53));
  float gust = 0.55 + 0.45 * sin(uTime * 0.43 + ip.x * 0.05 + ip.z * 0.035) * sin(uTime * 0.21 + 1.3);
  vec3 o = vec3(sin(uTime * 1.3 + ph), 0.3 * sin(uTime * 1.9 + ph * 1.7), cos(uTime * 1.1 + ph * 0.8)) * uWind * gust;
  o += vec3(sin(uTime * 6.1 + p.x * 5.0 + ph * 3.1), sin(uTime * 7.3 + p.y * 5.0 + ph), cos(uTime * 5.7 + p.z * 5.0 + ph * 2.3)) * uFlutter * (0.5 + gust);
  return o;
}
`;

export function foliage(opts = {}) {
  const {
    map = null,
    color = 0xffffff,
    wind = 0.05,
    flutter = 0.015,
    normalBlend = 0.9,
    transl = 0.45,
    atlas = false,
    grass = false,
    alphaTest = 0.5,
    vertexColors = false,
    edge = -0.05,
    soft = 0.22,
    brush = 0.55,
    rim = 0.12,
  } = opts;
  const mat = new THREE.MeshLambertMaterial({ map, color, side: THREE.DoubleSide, vertexColors });
  if (map) {
    mat.alphaTest = alphaTest;
    mat.alphaToCoverage = true;
  }
  mat.defines = { FOLIAGE: '' };
  if (atlas) mat.defines.ATLAS = '';
  if (grass) mat.defines.GRASS = '';
  const u = {
    ...toonUniforms({ edge, soft, brush, rim }),
    uTime: shared.uTime,
    uWind: { value: wind },
    uFlutter: { value: flutter },
    uNBlend: { value: normalBlend },
    uTransl: { value: transl },
  };
  mat.userData.u = u;
  const vertPatch = (s, depthOnly) => {
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${WIND}
        uniform float uNBlend;
        attribute vec3 aNormalW;
        #ifdef ATLAS
        attribute vec2 aAtlas;
        #endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef GRASS
          transformed += windOffset(position) * pow(uv.y, 1.6);
        #else
          transformed += windOffset(position);
        #endif`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #if defined(ATLAS) && defined(USE_MAP)
          vMapUv = vMapUv * 0.25 + aAtlas;
        #endif`
      );
    if (!depthOnly) {
      s.vertexShader = s.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        #ifdef GRASS
          transformedNormal = normalize(mix(transformedNormal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), uNBlend));
        #elif defined(USE_INSTANCING)
          transformedNormal = normalize(mix(transformedNormal, normalize((viewMatrix * vec4(aNormalW, 0.0)).xyz), uNBlend));
        #endif`
      );
    }
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    vertPatch(s, false);
    patchToon(s, {
      extraPars: 'uniform float uTransl;\n',
      // 逆光时叶片透出暖黄绿
      extraLight: `
        float bl = pow(max(dot(-Vd, L), 0.0), 3.0);
        lightCol += Lc * uTransl * (bl * 0.8 + 0.1) * shT * vec3(1.0, 1.05, 0.55);
      `,
    });
    s.fragmentShader = s.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      vec3 normal = normalize(vNormal);
      vec3 nonPerturbedNormal = normal;`
    );
  };
  mat.customProgramCacheKey = () => 'foliage';

  // 阴影深度材质：同样的风动
  const depth = new THREE.MeshDepthMaterial({ map, alphaTest: map ? alphaTest : 0 });
  depth.defines = { ...mat.defines };
  depth.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    vertPatch(s, true);
  };
  depth.customProgramCacheKey = () => 'foliageDepth';
  mat.userData.depth = depth;
  return mat;
}

// 卡通玻璃：浅天蓝，菲涅尔边缘更亮，带一块硬高光
export function glassMaterial() {
  return toon({ color: '#9cc9e8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, rim: 1.4, spec: 1.6, brush: 0.1 });
}
