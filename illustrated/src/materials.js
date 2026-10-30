import * as THREE from 'three';

// 全局共享 uniform
export const shared = {
  uTime: { value: 0 },
  tNoise: { value: null },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, // 视空间太阳方向（每帧更新）
  uSunCol: { value: new THREE.Color(1, 0.85, 0.65) },
  // 插画版的环境光接近中性、略暖：阴影是灰褐 / 灰绿，而不是紫
  uSkyAmb: { value: new THREE.Color(0.4, 0.42, 0.47) },
  uGroundAmb: { value: new THREE.Color(0.36, 0.33, 0.28) },
};

// sRGB 十六进制 → 线性空间 GLSL 常量
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

// ======================================================================
// 墨线缓冲：第二个渲染目标里每个像素写 (八面体编码法线.xy, 物体编号, 线型)
//   线型 0 不描线（草、藤、落叶、远景）
//        1 实体（建筑、树干、地面、物件）：轮廓 + 明显折边
//        2 树叶团：只在“不同叶团 / 背景”的交界描线，团内部不描
// 后期据此只描大轮廓
// ======================================================================
export const INK = { none: 0, solid: 1, clump: 2 };
let inkCounter = 0;
const nextInkId = () => 1 + ((inkCounter++ * 37) % 1500);

const INK_OUT_PARS = /* glsl */ `
layout(location = 1) out highp vec4 pc_fragInk;
uniform float uInkId;
uniform float uInkMode;
vec2 octEnc(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return e;
}
`;
const INK_OUT = /* glsl */ `
#include <dithering_fragment>
#ifdef INK_SKIP
  pc_fragInk = vec4(0.0);
#else
  float inkId = uInkId;
  // 片元着色器里没有 USE_INSTANCING，只按 FOLIAGE 判断；非实例化时 aClump 缺省为 0
  #ifdef FOLIAGE
    inkId = mod(uInkId + vClump * 7.0, 2000.0) + 1.0;
  #endif
  pc_fragInk = vec4(octEnc(normalize(normal)), inkId, uInkMode);
#endif
`;

// ======================================================================
// 卡通光照：两段式明暗 + 轻微笔触扰动的交界线 + 中性偏暖的半球环境光
// 树叶（FOLIAGE）用三档：亮面（偏黄绿）/ 中间调 / 暗部
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
#ifdef FOLIAGE
  varying float vClump;
#endif
float aaStep(float x, float t) {
  float fw = max(fwidth(x), 1e-5);
  return smoothstep(t - fw, t + fw, x);
}
// 等值线：f 穿过 t 的地方画一条约 wpx 像素宽的细线
float isoLine(float f, float t, float wpx) {
  float fw = max(fwidth(f), 1e-5);
  return 1.0 - smoothstep(0.5 * wpx, 1.5 * wpx, abs(f - t) / fw);
}
` + INK_OUT_PARS;

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
  float brush = texture2D(tNoise, vWPos.xz * 0.23 + vWPos.y * vec2(0.17, -0.13)).g - 0.5;
  float shT = smoothstep(0.35, 0.65, sh + brush * uToon.z * 0.5);
  vec3 amb = mix(uGroundAmb, uSkyAmb, smoothstep(-0.6, 0.8, nW.y));
  float fres = pow(1.0 - saturate(dot(N, Vd)), 4.0);
  #ifdef FOLIAGE
    // 三档：暗部 / 中间调 / 亮面；亮面偏暖黄绿
    float e = ndl + brush * uToon.z;
    float mid = smoothstep(uToon.x - uToon.y, uToon.x + uToon.y, e) * shT;
    float top = smoothstep(0.5 - uToon.y, 0.5 + uToon.y, e) * shT;
    vec3 lightCol = amb + Lc * (0.55 * mid + 0.4 * top);
    lightCol *= mix(vec3(1.0), vec3(1.07, 1.05, 0.8), top);
    float lit = mid;
  #else
    float lit = smoothstep(uToon.x - uToon.y, uToon.x + uToon.y, ndl + brush * uToon.z) * shT;
    float body = 0.84 + 0.16 * smoothstep(0.15, 0.95, ndl);
    vec3 lightCol = Lc * (lit * body) + amb;
  #endif
  lightCol += Lc * fres * uToon.w * (0.25 + 0.75 * lit);
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
    .replace('#include <lights_fragment_end>', '')
    .replace('#include <dithering_fragment>', INK_OUT);
  if (albedo) fs = fs.replace('#include <map_fragment>', albedo);
  s.fragmentShader = fs;
}

function toonUniforms({ edge = 0.0, soft = 0.04, brush = 0.2, rim = 0.12, spec = 0, ink = INK.solid } = {}) {
  return {
    tNoise: shared.tNoise,
    uSkyAmb: shared.uSkyAmb,
    uGroundAmb: shared.uGroundAmb,
    uToon: { value: new THREE.Vector4(edge, soft, brush, rim) },
    uSpec: { value: spec },
    uInkId: { value: nextInkId() },
    uInkMode: { value: ink },
  };
}

// 纯色卡通材质（小物件、鸟、蝴蝶、校名字）
export function toon(opts = {}) {
  const { color = '#ffffff', map = null, alphaTest = 0, side = THREE.FrontSide, transparent = false, opacity = 1, depthWrite = true, vertexColors = false, edge, soft, brush, rim, spec, ink, polygonOffset = false } = opts;
  const mat = new THREE.MeshLambertMaterial({ color, map, alphaTest, side, transparent, opacity, depthWrite, vertexColors });
  if (polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
  }
  if (transparent) mat.defines = { INK_SKIP: '' };
  const u = toonUniforms({ edge, soft, brush, rim, spec, ink });
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchToon(s);
  };
  mat.customProgramCacheKey = () => 'illToon';
  return mat;
}

// ======================================================================
// 手绘材质：混凝土 / 油漆 / 铁件 / 树皮 / 石板 / 泥地 / 木头
// 低饱和、低对比的色块；细节靠极少量的细线（石板缝、裂缝）
// ======================================================================
const P_PARS = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uPaint;
uniform vec3 uMossCol;
uniform float uPaintAmount;
uniform float uMoss;
uniform float uStreaks;
uniform float uDirt;
uniform float uScale;
uniform float uSeed;
uniform vec4 uRect;
uniform float uDecal;
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
float strokeH = texture2D(tNoise, vec2(hcoord * 0.45 + uSeed, vWPos.y * 2.6 * uScale)).a;
float strokeV = texture2D(tNoise, vec2(hcoord * 2.2, vWPos.y * 0.35 + uSeed)).a;
float stroke = mix(strokeH, strokeV, 0.35) - 0.5;
float patchA = band(nA.r, 0.5, 0.05);
float patchB = band(nB.g, 0.53, 0.04);
float stA = texture2D(tNoise, vec2(hcoord * 0.31 + uSeed, vWPos.y * 0.021)).g;
float stB = texture2D(tNoise, vec2(hcoord * 1.17, vWPos.y * 0.05 + uSeed)).r;
float streak = band(stA * 0.75 + stB * 0.45, 0.72, 0.06) * vertF * uStreaks;
float gl1 = 1.0 - smoothstep(0.0, 0.8, vWPos.y);
float gl2 = (1.0 - smoothstep(2.4, 2.9, vWPos.y)) * step(2.36, vWPos.y);
float grime = max(gl1, gl2) * uDirt;
float mossGate = max(upF, max(grime, streak * 0.5));
float mossBias = 0.0;
vec3 wCol = uBase;
float pxW = length(fwidth(vWPos));

#if defined(KIND_CONCRETE)
  wCol = uBase * (0.95 + 0.07 * patchA - 0.05 * patchB + stroke * 0.08);
  wCol = mix(wCol, wCol * vec3(1.04, 1.0, 0.93), band(nA.a, 0.56, 0.05) * 0.5);
  #ifdef USE_PAINT
    float pmN = nB.r * 0.55 + nA.g * 0.5 + nC.r * 0.12;
    float thr = 0.86 - 0.62 * uPaintAmount;
    wPaintM = smoothstep(thr, thr + 0.012, pmN);
    float rim = smoothstep(thr - 0.04, thr, pmN) * (1.0 - wPaintM);
    vec3 pc = uPaint * (0.95 + 0.07 * patchA - 0.05 * patchB + stroke * 0.1);
    wCol = mix(wCol, pc, wPaintM);
    wCol = mix(wCol, wCol * 1.1, rim * 0.5);
  #endif
#elif defined(KIND_RUST)
  float rn = nB.r * 0.6 + nC.g * 0.5;
  wCol = uBase * (0.88 + 0.2 * band(rn, 0.5, 0.08));
  #ifdef USE_PAINT
    wPaintM = band(nA.r * 0.6 + nB.g * 0.5 + uPaintAmount * 0.3 - 0.15, 0.6, 0.012);
    wCol = mix(wCol, uPaint * (0.94 + 0.1 * nC.r), wPaintM);
  #endif
  mossGate *= 0.3;
#elif defined(KIND_BARK)
  float b1 = texture2D(tNoise, vec2(vUv.x, vUv.y * 0.03)).r;
  float b2 = texture2D(tNoise, vec2(vUv.x, vUv.y * 0.08)).a;
  wCol = uBase * (0.86 + 0.2 * band(b1, 0.5, 0.07)) * (0.93 + 0.12 * band(b2, 0.5, 0.08));
  // 树干下部长满苔藓（参考图里的绿色树根）
  mossGate = max(upF, 1.0 - smoothstep(2.6, 6.0, vWPos.y));
  mossBias = (1.0 - smoothstep(2.5, 5.0, vWPos.y)) * 0.2;
  streak *= 0.2;
  grime *= 0.3;
#elif defined(KIND_PAVERS)
  // 大块石板，接缝是一条细线
  vec2 pp = vWPos.xz;
  const float TW = 1.5;
  const float TH = 0.75;
  float row = floor(pp.y / TH);
  float px = pp.x + mod(row, 2.0) * TW * 0.5;
  vec2 cell = vec2(floor(px / TW), row);
  vec2 tf = vec2(px - cell.x * TW, pp.y - row * TH);
  float ed = min(min(tf.x, TW - tf.x), min(tf.y, TH - tf.y));
  float hc = hash12(cell + 0.5);
  float hc2 = hash12(cell * 1.37 + 11.1);
  float edgeD = min(min(pp.x - uRect.x, uRect.y - pp.x), min(pp.y - uRect.z, uRect.w - pp.y));
  float wild = 1.0 - smoothstep(-1.0, 6.0, edgeD + (nA.r - 0.5) * 9.0);
  float damage = smoothstep(0.55, 0.82, texture2D(tNoise, pp * 0.021 + 0.3).r + wild * 0.5);
  float missing = step(hc2, damage * 0.5 + wild * 0.75);
  vec3 stone = uBase * (0.95 + 0.07 * hc) * (0.97 + 0.04 * band(nB.g, 0.5, 0.1));
  float dirt = band(nA.r * 0.75 + nB.g * 0.35 + texture2D(tNoise, pp * 0.013 + 0.61).a * 0.35, 0.72, 0.06);
  stone *= 1.0 - 0.08 * dirt;
  float tileFade = 1.0 - smoothstep(0.06, 0.14, pxW);
  float seam = (1.0 - smoothstep(0.4, 1.3, ed / max(fwidth(ed), 1e-5))) * (0.5 + 0.3 * damage) * tileFade;
  float crv = texture2D(tNoise, pp * 0.23 + hc * 3.0).a;
  float crack = isoLine(crv, 0.5, 0.9) * step(0.85, hc * 0.8 + damage * 0.45 + hc2 * 0.2) * 0.5 * tileFade;
  wCol = mix(stone, ${lin('#5f5649')}, max(seam, crack));
  wCol = mix(wCol, uMossCol * (0.9 + 0.15 * nC.g), missing);
  grime = 0.0;
  streak = 0.0;
  mossGate = 1.0;
  mossBias = missing * 0.35 + damage * 0.2 + wild * 0.5 + dirt * 0.1 - 0.48;
#elif defined(KIND_SOIL)
  // 远处的地：低饱和的草地 / 泥土色块
  float m1 = band(nA.r, 0.5, 0.06);
  float m2 = band(nB.g, 0.56, 0.05);
  wCol = mix(uBase * vec3(0.92, 0.95, 0.9), uBase, m1);
  wCol = mix(wCol, uBase * vec3(1.08, 1.06, 0.95), m2 * 0.5);
  float dp = band(nA.a * 0.8 + nB.r * 0.3, 0.8, 0.025);
  wCol = mix(wCol, ${lin('#b49a74')}, dp * 0.6);
  grime = 0.0;
  streak = 0.0;
  mossGate = 0.0;
#elif defined(KIND_WOOD)
  float gr = texture2D(tNoise, vec2(nC.r * 0.3 + hcoord * 0.2, vWPos.y * 0.15 + nB.g * 0.4)).g;
  wCol = uBase * (0.88 + 0.2 * band(gr, 0.5, 0.08));
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

wCol = mix(wCol, wCol * ${lin('#cfd0c8')}, streak * 0.7);
wCol = mix(wCol, wCol * ${lin('#d6cbb4')}, grime * (0.5 + 0.5 * band(nB.r, 0.5, 0.1)));

float mossN = nA.g * 0.6 + nB.r * 0.5;
float mossM = band(mossN + upF * 0.25 + grime * 0.35 + streak * 0.15 + mossBias, 0.8, 0.02) * mossGate * uMoss;
vec3 mossCol = uMossCol * (0.9 + 0.18 * band(nC.r * 0.7 + nB.g * 0.3, 0.5, 0.05));
mossCol = mix(mossCol, mossCol * vec3(1.1, 1.08, 0.9), upF * 0.4);
wCol = mix(wCol, mossCol, mossM);
diffuseColor.rgb *= wCol;
`;

export function painted(opts = {}) {
  const {
    kind = 'concrete',
    color = '#c4bdad',
    paint = null,
    paintAmount = 0.8,
    moss = 1,
    mossColor = '#8f9c5a',
    streaks = 1,
    dirt = 1,
    scale = 1,
    seed = 0,
    map = null,
    decal = 1,
    rect = [-1e4, 1e4, -1e4, 1e4],
    side = THREE.FrontSide,
    edge,
    soft,
    brush,
    rim,
    spec,
    ink,
  } = opts;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side, map });
  mat.defines = { ['KIND_' + kind.toUpperCase()]: '' };
  if (paint) mat.defines.USE_PAINT = '';
  if (kind === 'bark') mat.defines.USE_UV = '';
  const u = {
    ...toonUniforms({ edge, soft, brush, rim, spec, ink }),
    uBase: { value: new THREE.Color(color) },
    uPaint: { value: new THREE.Color(paint || '#000000') },
    uMossCol: { value: new THREE.Color(mossColor) },
    uPaintAmount: { value: paintAmount },
    uMoss: { value: moss },
    uStreaks: { value: streaks },
    uDirt: { value: dirt },
    uScale: { value: scale },
    uSeed: { value: seed },
    uRect: { value: new THREE.Vector4(...rect) },
    uDecal: { value: decal },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchToon(s, { extraPars: P_PARS, albedo: P_ALBEDO });
  };
  mat.customProgramCacheKey = () => 'illPainted';
  return mat;
}

// ======================================================================
// 植被材质：风动 + 按叶团的球面法线（每团上亮下暗）+ 三档明暗 + 逆光微透
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
    normalBlend = 0.92,
    transl = 0.25,
    atlas = false,
    grass = false,
    alphaTest = 0.5,
    vertexColors = false,
    edge = -0.12,
    soft = 0.04,
    brush = 0.35,
    rim = 0.06,
    ink = INK.clump,
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
    ...toonUniforms({ edge, soft, brush, rim, ink }),
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
        attribute float aClump;
        varying float vClump;
        #ifdef ATLAS
        attribute vec2 aAtlas;
        #endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vClump = aClump;
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
      extraLight: `
        float bl = pow(max(dot(-Vd, L), 0.0), 3.0);
        lightCol += Lc * uTransl * bl * shT * vec3(1.0, 1.04, 0.6);
      `,
    });
    s.fragmentShader = s.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      vec3 normal = normalize(vNormal);
      vec3 nonPerturbedNormal = normal;`
    );
  };
  mat.customProgramCacheKey = () => 'illFoliage';

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

// 玻璃：暗青灰，半透明，一块硬高光；不写墨线缓冲
export function glassMaterial() {
  return toon({ color: '#6f8a8a', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, rim: 0.6, spec: 1.0, brush: 0.05 });
}

// ShaderMaterial（天空、树线）也要写墨线缓冲，否则第二个渲染目标内容未定义
export const INK_SHADER_PARS = INK_OUT_PARS;
