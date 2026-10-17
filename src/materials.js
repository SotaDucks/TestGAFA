import * as THREE from 'three';

// 全局共享 uniform
export const shared = {
  uTime: { value: 0 },
  tNoise: { value: null },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, // 视空间太阳方向（每帧更新）
  uSunCol: { value: new THREE.Color(1, 0.85, 0.65) },
};

// ======================================================================
// 风化材质：混凝土 / 油漆 / 锈铁 / 树皮 / 地砖 / 泥土 / 木头
// 世界空间三平面采样 + 苔藓 + 水渍 + 底部污垢 + 程序化凹凸
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

const W_FRAG_PARS = /* glsl */ `
uniform sampler2D tNoise;
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
varying vec3 vWPos;
varying vec3 vWNormal;
float wHeight = 0.0;
float wMoss = 0.0;
float wPaintM = 0.0;
float wRoughAdd = 0.0;
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
`;

const W_ALBEDO = /* glsl */ `
vec3 wN = normalize(vWNormal);
vec3 wp = vWPos * uScale + vec3(uSeed);
vec4 nA = triN(wp, wN, 0.11);
vec4 nB = triN(wp, wN, 0.55);
vec4 nC = triN(wp, wN, 2.7);
float upF = smoothstep(0.5, 0.95, wN.y);
float vertF = 1.0 - abs(wN.y);
float hcoord = mix(vWPos.x, vWPos.z, abs(wN.x)) * uScale;
float stA = texture2D(tNoise, vec2(hcoord * 0.31 + uSeed, vWPos.y * 0.021)).g;
float stB = texture2D(tNoise, vec2(hcoord * 1.17, vWPos.y * 0.05 + uSeed)).r;
float streak = smoothstep(0.52, 0.86, stA * 0.75 + stB * 0.45) * vertF * uStreaks;
float gl1 = 1.0 - smoothstep(0.0, 1.1, vWPos.y);
float gl2 = (1.0 - smoothstep(2.4, 3.3, vWPos.y)) * step(2.36, vWPos.y);
float grime = max(gl1, gl2) * (0.55 + 0.45 * nB.r) * uDirt;
float mossGate = max(upF, max(grime * 0.9, streak * 0.45));
float mossBias = 0.0;
float mossH = 0.4;
vec3 wCol = uBase;

#if defined(KIND_CONCRETE)
  wCol = uBase * (0.8 + 0.32 * nA.r + 0.2 * (nB.g - 0.5));
  float pits = 1.0 - smoothstep(0.03, 0.11, nC.b);
  wCol *= 1.0 - 0.28 * pits;
  wCol = mix(wCol, wCol * vec3(1.05, 0.99, 0.86), smoothstep(0.35, 0.85, nA.a) * 0.8);
  wHeight = nB.g * 0.45 + nC.g * 0.35 - pits * 0.5;
  #ifdef USE_PAINT
    float pmN = nB.r * 0.55 + nA.g * 0.5 + nC.r * 0.14 + nB.a * 0.1;
    float thr = 0.86 - 0.62 * uPaintAmount;
    wPaintM = smoothstep(thr, thr + 0.025, pmN);
    float rim = smoothstep(thr - 0.05, thr, pmN) * (1.0 - wPaintM);
    vec3 pc = uPaint * (0.84 + 0.26 * nA.r + 0.1 * nC.g);
    pc = mix(pc, vec3(dot(pc, vec3(0.3, 0.5, 0.2))) * 1.15, 0.32 * smoothstep(0.3, 0.8, nB.a));
    wCol = mix(wCol * (1.0 - 0.3 * rim), pc, wPaintM);
    wHeight += wPaintM * 0.5;
  #endif
#elif defined(KIND_RUST)
  float rn = nB.r * 0.6 + nC.g * 0.5;
  vec3 rA = vec3(0.20, 0.085, 0.035), rB = vec3(0.46, 0.21, 0.075), rD = vec3(0.075, 0.045, 0.03);
  wCol = mix(rD, mix(rA, rB, smoothstep(0.35, 0.75, nC.r)), smoothstep(0.25, 0.62, rn));
  wHeight = nC.g * 0.6 + nB.g * 0.3;
  #ifdef USE_PAINT
    wPaintM = smoothstep(0.6, 0.64, nA.r * 0.6 + nB.g * 0.5 + uPaintAmount * 0.3 - 0.15);
    wCol = mix(wCol, uPaint * (0.8 + 0.3 * nC.r), wPaintM);
    wHeight += wPaintM * 0.3;
  #endif
  mossGate *= 0.4;
#elif defined(KIND_BARK)
  float b1 = texture2D(tNoise, vec2(vUv.x, vUv.y * 0.09)).g;
  float b2 = texture2D(tNoise, vec2(vUv.x * 0.25, vUv.y * 0.035)).r;
  float b3 = texture2D(tNoise, vec2(vUv.x * 2.0, vUv.y * 0.6)).b;
  wCol = uBase * (0.6 + 0.55 * b2) * (0.78 + 0.38 * b1);
  wCol *= 1.0 - 0.25 * (1.0 - smoothstep(0.05, 0.16, b3));
  float lich = smoothstep(0.6, 0.8, nB.a * 0.8 + nC.r * 0.35);
  wCol = mix(wCol, vec3(0.42, 0.45, 0.36), lich * 0.5);
  wHeight = b1 * 0.7 + b2 * 0.3 - (1.0 - smoothstep(0.05, 0.16, b3)) * 0.3;
  streak *= 0.25;
  grime *= 0.3;
#elif defined(KIND_PAVERS)
  vec2 pp = vWPos.xz;
  const float TW = 1.2;
  const float TH = 0.6;
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
  vec3 granite = uBase * (0.8 + 0.3 * hc) * (0.88 + 0.24 * nC.g);
  granite = mix(granite, granite * 0.42, smoothstep(0.8, 0.95, texture2D(tNoise, pp * 3.1).g));
  granite = mix(granite, granite * 1.3, smoothstep(0.86, 0.97, texture2D(tNoise, pp * 2.3 + 0.5).a));
  float dirt = smoothstep(0.38, 0.85, nA.r * 0.75 + nB.g * 0.35 + texture2D(tNoise, pp * 0.013 + 0.61).a * 0.35);
  granite *= 1.0 - 0.38 * dirt;
  granite = mix(granite, granite * vec3(0.92, 0.9, 0.8), smoothstep(0.3, 0.7, texture2D(tNoise, pp * 0.03 + 0.2).g));
  float seamW = 0.007 + 0.022 * damage;
  float seam = 1.0 - smoothstep(seamW, seamW + 0.012, ed + (nC.r - 0.5) * 0.012);
  float crv = abs(texture2D(tNoise, pp * 0.23 + hc * 3.0).a - 0.5);
  float crack = (1.0 - smoothstep(0.003, 0.012, crv)) * step(0.78, hc * 0.8 + damage * 0.45 + hc2 * 0.2);
  vec3 soil = mix(vec3(0.05, 0.04, 0.025), vec3(0.11, 0.09, 0.05), nB.r);
  vec3 seamCol = mix(soil, vec3(0.06, 0.075, 0.03), smoothstep(0.55, 0.8, nB.a) * damage);
  wCol = mix(granite, seamCol, max(seam, crack * 0.85));
  wCol = mix(wCol, soil, missing);
  vec2 tilt = (vec2(hc, hc2) - 0.5) * 0.02 * (0.35 + damage);
  wHeight = (1.0 - seam) * 0.004 + dot(tf - vec2(TW, TH) * 0.5, tilt) * (1.0 - missing) - missing * 0.03 - crack * 0.003 + nC.g * 0.0012;
  grime = 0.0;
  streak = 0.0;
  mossGate = 1.0;
  mossBias = missing * 0.35 + seam * 0.2 * damage + damage * 0.2 + wild * 0.5 + dirt * 0.15 - 0.42;
  wRoughAdd = missing * 0.1 - (1.0 - dirt) * 0.05;
  mossH = 0.002;
#elif defined(KIND_SOIL)
  vec3 soil = mix(vec3(0.05, 0.04, 0.026), vec3(0.11, 0.088, 0.055), nB.r);
  float cov = smoothstep(0.32, 0.62, nA.r * 0.7 + nB.g * 0.5);
  vec3 grass = mix(vec3(0.06, 0.085, 0.02), vec3(0.15, 0.17, 0.05), nC.r);
  vec3 litter = mix(vec3(0.16, 0.10, 0.045), vec3(0.25, 0.18, 0.08), nC.g);
  wCol = mix(soil, grass, cov);
  wCol = mix(wCol, litter, smoothstep(0.5, 0.85, nA.a * 0.7 + nB.a * 0.3) * 0.45);
  wHeight = nC.g * 0.02 + nB.r * 0.03;
  grime = 0.0;
  streak = 0.0;
  mossGate = 0.0;
  mossH = 0.0;
#elif defined(KIND_WOOD)
  float gr = texture2D(tNoise, vec2(nC.r * 0.3 + hcoord * 0.2, vWPos.y * 0.15 + nB.g * 0.4)).g;
  wCol = uBase * (0.62 + 0.55 * gr) * (0.8 + 0.3 * nB.r);
  wCol = mix(wCol, vec3(0.05, 0.05, 0.04), smoothstep(0.62, 0.85, nB.a) * 0.6);
  wHeight = gr * 0.5;
#endif

#ifdef USE_MAP
  {
    vec4 dc = texture2D(map, vMapUv);
    vec2 eu = abs(vMapUv - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.82, 1.0, max(eu.x, eu.y) + (nB.r - 0.5) * 0.25);
    float keep = smoothstep(0.25, 0.55, nB.r * 0.6 + nC.g * 0.3 + nA.g * 0.4) * edge * dc.a * uDecal;
    vec3 faded = mix(dc.rgb, vec3(dot(dc.rgb, vec3(0.33))), 0.25) * (0.8 + 0.25 * nA.r);
    wCol = mix(wCol, faded, keep);
    wPaintM = max(wPaintM, keep);
  }
#endif

wCol *= 1.0 - 0.42 * streak;
wCol = mix(wCol, wCol * vec3(0.8, 0.88, 0.72), streak * 0.6);
wCol *= 1.0 - 0.42 * grime;

float mossN = nA.g * 0.6 + nB.r * 0.5;
float mossM = smoothstep(0.6, 0.92, mossN + upF * 0.25 + grime * 0.35 + streak * 0.15 + mossBias) * mossGate * uMoss;
mossM *= 0.75 + 0.25 * nC.g;
vec3 mossCol = mix(vec3(0.035, 0.045, 0.015), vec3(0.085, 0.10, 0.03), nC.r * 0.7 + nB.g * 0.3);
mossCol = mix(mossCol, vec3(0.12, 0.10, 0.055), smoothstep(0.55, 0.9, nB.a) * 0.55);
wCol = mix(wCol, mossCol, mossM);
wMoss = mossM;
wHeight += mossM * mossH * nC.r;
diffuseColor.rgb *= wCol;
`;

const W_ROUGH = /* glsl */ `
float roughnessFactor = roughness;
roughnessFactor = clamp(roughnessFactor + (nB.g - 0.5) * 0.16 + wMoss * 0.15 - wPaintM * 0.12 + wRoughAdd, 0.05, 1.0);
`;

const W_METAL = /* glsl */ `
float metalnessFactor = metalness * (1.0 - wPaintM) * (1.0 - wMoss);
`;

const W_NORMAL = /* glsl */ `
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

export function weathered(opts = {}) {
  const {
    kind = 'concrete',
    color = '#a29d92',
    paint = null,
    paintAmount = 0.7,
    moss = 1,
    streaks = 1,
    dirt = 1,
    roughness = 0.92,
    metalness = 0,
    scale = 1,
    bump = null,
    seed = 0,
    map = null,
    decal = 1,
    rect = [-1e4, 1e4, -1e4, 1e4],
    side = THREE.FrontSide,
    envMapIntensity = 1,
  } = opts;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, side, map, envMapIntensity });
  mat.defines = { ['KIND_' + kind.toUpperCase()]: '' };
  if (paint) mat.defines.USE_PAINT = '';
  if (kind === 'bark') mat.defines.USE_UV = '';
  const defBump = { concrete: 0.012, rust: 0.01, bark: 0.025, pavers: 1.0, soil: 1.0, wood: 0.01 }[kind];
  const u = {
    tNoise: shared.tNoise,
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
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + W_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + W_VERT);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + W_FRAG_PARS)
      .replace('#include <map_fragment>', W_ALBEDO)
      .replace('#include <roughnessmap_fragment>', W_ROUGH)
      .replace('#include <metalnessmap_fragment>', W_METAL)
      .replace('#include <normal_fragment_maps>', W_NORMAL);
  };
  mat.customProgramCacheKey = () => 'weathered';
  return mat;
}

// ======================================================================
// 植被材质：风动 + 球面法线 + 透光
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
    normalBlend = 0.75,
    transl = 0.45,
    roughness = 0.78,
    atlas = false,
    grass = false,
    alphaTest = 0.5,
    vertexColors = false,
  } = opts;
  const mat = new THREE.MeshStandardMaterial({ map, color, roughness, metalness: 0, side: THREE.DoubleSide, vertexColors });
  if (map) {
    mat.alphaTest = alphaTest;
    mat.alphaToCoverage = true;
  }
  mat.defines = { FOLIAGE: '' };
  if (atlas) mat.defines.ATLAS = '';
  if (grass) mat.defines.GRASS = '';
  const u = {
    uTime: shared.uTime,
    uWind: { value: wind },
    uFlutter: { value: flutter },
    uNBlend: { value: normalBlend },
    uTransl: { value: transl },
    uSunDirV: shared.uSunDirV,
    uSunCol: shared.uSunCol,
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
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDirV;
        uniform vec3 uSunCol;
        uniform float uTransl;`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize(-vViewPosition);
          float bl = pow(max(dot(vdir, uSunDirV), 0.0), 3.0);
          float sh = 1.0;
          #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            vec3 scd = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
            if (scd.x > 0.0 && scd.x < 1.0 && scd.y > 0.0 && scd.y < 1.0)
              sh = texture(directionalShadowMap[0], vec3(scd.xy, scd.z - 0.003));
          #endif
          outgoingLight += diffuseColor.rgb * uSunCol * uTransl * (bl * 1.6 + 0.1) * sh;
        }
        #include <opaque_fragment>`
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

export function glassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#2c3a38',
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.6,
  });
}
