import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj;
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * c;
  return v.xyz / v.w;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// ---------------------------------------------------------------- SAO 环境光遮蔽（半分辨率）
const AO_FS = /* glsl */ `
${COMMON}
uniform mat4 uProj;
uniform vec2 uRes;
uniform float uRadius;
uniform float uIntensity;
uniform float uFrame;
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.999999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / uRes;
  vec3 Pr = viewPos(vUv + vec2(px.x, 0.0)), Pl = viewPos(vUv - vec2(px.x, 0.0));
  vec3 Pu = viewPos(vUv + vec2(0.0, px.y)), Pd = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  float rnd = ign(gl_FragCoord.xy + uFrame * 7.13) * 6.2831;
  float ssR = min(uRadius * uProj[1][1] * 0.5 / -P.z, 0.15);
  float aspect = uRes.y / uRes.x;
  float r2 = uRadius * uRadius;
  float occ = 0.0;
  const int NS = 16;
  for (int i = 0; i < NS; i++) {
    float a = (float(i) + 0.5) / float(NS);
    float ang = rnd + a * 43.98;
    vec2 off = vec2(cos(ang) * aspect, sin(ang)) * ssR * a;
    vec3 Q = viewPos(vUv + off);
    vec3 v = Q - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0);
    occ += f * f * f * max((vn - 0.012 * -P.z * 0.1) / (0.01 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - occ * uIntensity * 5.0 / (r2 * r2 * r2 * float(NS)));
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- 体积光（沿视线采样太阳阴影图）
const VOL_FS = /* glsl */ `
${COMMON}
uniform sampler2DShadow tShadow;
uniform sampler2D tNoise;
uniform mat4 uShadowMatrix;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbCol;
uniform float uDensity;
uniform float uFalloff;
uniform float uMaxDist;
uniform float uG;
uniform float uSunScat;
uniform float uTime;
uniform float uFrame;
uniform float uHasShadow;
uniform vec4 uMist;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float dens(vec3 p) {
  float n = texture2D(tNoise, p.xz * 0.012 + vec2(uTime * 0.0025, uTime * 0.0011)).r;
  float n2 = texture2D(tNoise, p.xz * 0.05 + p.y * 0.03 + vec2(-uTime * 0.004, 0.0)).a;
  vec3 q = (p - uMist.xyz) / vec3(uMist.w, uMist.w * 0.55, uMist.w);
  float mist = exp(-dot(q, q)) * 2.6;
  return uDensity * (exp(-max(p.y, 0.0) * uFalloff) + mist) * (0.45 + 0.9 * n * (0.6 + 0.6 * n2));
}
void main() {
  float d = texture2D(tDepth, vUv).r;
  vec3 vp = viewPos(vUv);
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  vec3 rd = wp - uCamPos;
  float dist = length(rd);
  rd /= dist;
  if (d >= 0.999999) dist = uMaxDist;
  dist = min(dist, uMaxDist);
  const int N = 44;
  float stepLen = dist / float(N);
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588);
  float cosT = dot(rd, uSunDir);
  float phase = mix(1.0 / (4.0 * 3.14159), hg(cosT, uG), 0.75) * 4.0 * 3.14159;
  vec3 scat = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + jit) * stepLen;
    vec3 p = uCamPos + rd * t;
    float sd = dens(p);
    float vis = 1.0;
    if (uHasShadow > 0.5) {
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tShadow, vec3(sc.xy, sc.z - 0.001));
    }
    float stT = exp(-sd * stepLen);
    vec3 S = (uSunCol * vis * phase * uSunScat + uAmbCol) * sd;
    scat += T * S * (1.0 - stT) / max(sd, 1e-6);
    T *= stT;
  }
  gl_FragColor = vec4(scat, T);
}
`;

// ---------------------------------------------------------------- 深度感知模糊
const BLUR_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tAO;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float z0 = texture2D(tAO, vUv).g;
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = texture2D(tAO, uv).g;
    float w = exp(-float(i * i) / 9.0) / (0.002 + abs(z - z0) / max(z0, 0.1));
    sum += texture2D(tSrc, uv) * w;
    ws += w;
  }
  vec4 r = sum / ws;
  #ifdef AO_MODE
    r.g = z0;
  #endif
  gl_FragColor = r;
}
`;

// ---------------------------------------------------------------- 合成（联合双边上采样）
const COMP_FS = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tVol;
uniform mat4 uInvProj;
uniform vec2 uHalf;
uniform float uAOStrength;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  vec4 c = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float z = d >= 0.999999 ? 1e4 : -c.z / c.w;
  vec2 pos = vUv * uHalf - 0.5;
  vec2 b = floor(pos);
  vec2 f = pos - b;
  float ao = 0.0;
  vec4 vol = vec4(0.0);
  float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 cc = clamp(ivec2(b) + ivec2(i, j), ivec2(0), ivec2(uHalf) - 1);
    vec4 a = texelFetch(tAO, cc, 0);
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float w = bw / (0.001 + abs(a.g - z) / max(z, 0.1)) + 1e-5;
    ao += a.r * w;
    vol += texelFetch(tVol, cc, 0) * w;
    ws += w;
  }
  ao /= ws;
  vol /= ws;
  if (d >= 0.999999) ao = 1.0;
  col *= mix(1.0, ao, uAOStrength);
  col = col * vol.a + vol.rgb;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- 调色 + ACES + 暗角 + 颗粒
const FINAL_FS = /* glsl */ `
uniform sampler2D tInput;
uniform float uExposure;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = IN * color;
  color = RRTAndODTFit(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 dc = vUv - 0.5;
  float r2 = dot(dc, dc);
  vec2 ca = dc * r2 * 0.012;
  vec3 col;
  col.r = texture2D(tInput, vUv - ca).r;
  col.g = texture2D(tInput, vUv).g;
  col.b = texture2D(tInput, vUv + ca).b;
  col *= uExposure;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.06);
  col *= mix(vec3(0.94, 1.0, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.02, 1.2, lum));
  col = aces(col / 0.6);
  col *= mix(1.0, 0.68, smoothstep(0.12, 0.75, r2 * 2.0));
  col = toSRGB(col);
  col = col * 0.985 + 0.006;
  col += (hash(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5) * 0.028;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  constructor(renderer, scene, camera, sun, noiseTex) {
    this.r = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.frame = 0;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.size = size;
    this.depthTex = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depthTex, depthBuffer: true });
    const hw = Math.max(1, Math.floor(size.x / 2)), hh = Math.max(1, Math.floor(size.y / 2));
    const half = () => new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.aoA = half();
    this.aoB = half();
    this.volA = half();
    this.volB = half();
    this.compRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });

    const mk = (fs, uniforms, defines = {}) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false }));
    this.ao = mk(AO_FS, {
      tDepth: { value: this.depthTex },
      uInvProj: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uRadius: { value: 1.1 },
      uIntensity: { value: 1.0 },
      uFrame: { value: 0 },
    });
    this.vol = mk(VOL_FS, {
      tDepth: { value: this.depthTex },
      tShadow: { value: null },
      tNoise: { value: noiseTex },
      uInvProj: { value: new THREE.Matrix4() },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color(1.0, 0.8, 0.58) },
      uAmbCol: { value: new THREE.Color(0.2, 0.25, 0.32) },
      uDensity: { value: 0.0019 },
      uMist: { value: new THREE.Vector4(-9, 6.5, 6, 9.5) },
      uFalloff: { value: 0.07 },
      uMaxDist: { value: 220 },
      uG: { value: 0.45 },
      uSunScat: { value: 2.0 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uHasShadow: { value: 0 },
    });
    this.blurAO = mk(BLUR_FS, { tSrc: { value: null }, tAO: { value: null }, uDir: { value: new THREE.Vector2() } }, { AO_MODE: '' });
    this.blurVol = mk(BLUR_FS, { tSrc: { value: null }, tAO: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.comp = mk(COMP_FS, {
      tScene: { value: this.sceneRT.texture },
      tDepth: { value: this.depthTex },
      tAO: { value: this.aoA.texture },
      tVol: { value: this.volA.texture },
      uInvProj: { value: new THREE.Matrix4() },
      uHalf: { value: new THREE.Vector2(hw, hh) },
      uAOStrength: { value: 0.85 },
    });
    this.final = mk(FINAL_FS, {
      tInput: { value: this.compRT.texture },
      uExposure: { value: 0.88 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
    });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.55, 1.6);
  }

  setSize() {
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    this.size = size;
    const hw = Math.max(1, Math.floor(size.x / 2)), hh = Math.max(1, Math.floor(size.y / 2));
    this.depthTex.image.width = size.x;
    this.depthTex.image.height = size.y;
    this.depthTex.dispose();
    this.sceneRT.setSize(size.x, size.y);
    for (const rt of [this.aoA, this.aoB, this.volA, this.volB]) rt.setSize(hw, hh);
    this.compRT.setSize(size.x, size.y);
    this.ao.material.uniforms.uRes.value.set(size.x, size.y);
    this.comp.material.uniforms.uHalf.value.set(hw, hh);
    this.final.material.uniforms.uRes.value.set(size.x, size.y);
    this.bloom.setSize(size.x, size.y);
  }

  render(time) {
    const r = this.r, cam = this.camera;
    this.frame = (this.frame + 1) % 64;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, cam);

    const hw = this.aoA.width, hh = this.aoA.height;
    // AO
    const au = this.ao.material.uniforms;
    au.uInvProj.value.copy(cam.projectionMatrixInverse);
    au.uProj.value.copy(cam.projectionMatrix);
    au.uFrame.value = this.frame;
    r.setRenderTarget(this.aoA);
    this.ao.render(r);
    // 体积光
    const vu = this.vol.material.uniforms;
    const sm = this.sun.shadow.map;
    vu.tShadow.value = sm && sm.depthTexture ? sm.depthTexture : null;
    vu.uHasShadow.value = vu.tShadow.value ? 1 : 0;
    vu.uShadowMatrix.value.copy(this.sun.shadow.matrix);
    vu.uInvProj.value.copy(cam.projectionMatrixInverse);
    vu.uCamWorld.value.copy(cam.matrixWorld);
    vu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    vu.uTime.value = time;
    vu.uFrame.value = this.frame;
    r.setRenderTarget(this.volA);
    if (vu.tShadow.value) this.vol.render(r);
    else {
      const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      r.setClearColor(cc, ca);
    }
    // 模糊
    const bA = this.blurAO.material.uniforms;
    bA.tAO.value = this.aoA.texture;
    bA.tSrc.value = this.aoA.texture;
    bA.uDir.value.set(1 / hw, 0);
    r.setRenderTarget(this.aoB);
    this.blurAO.render(r);
    bA.tAO.value = this.aoB.texture;
    bA.tSrc.value = this.aoB.texture;
    bA.uDir.value.set(0, 1 / hh);
    r.setRenderTarget(this.aoA);
    this.blurAO.render(r);
    const bV = this.blurVol.material.uniforms;
    bV.tAO.value = this.aoA.texture;
    bV.tSrc.value = this.volA.texture;
    bV.uDir.value.set(1 / hw, 0);
    r.setRenderTarget(this.volB);
    this.blurVol.render(r);
    bV.tSrc.value = this.volB.texture;
    bV.uDir.value.set(0, 1 / hh);
    r.setRenderTarget(this.volA);
    this.blurVol.render(r);
    // 合成
    this.comp.material.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    r.setRenderTarget(this.compRT);
    this.comp.render(r);
    // 泛光
    this.bloom.render(r, null, this.compRT, 0.016, false);
    // 输出
    this.final.material.uniforms.uTime.value = time;
    r.setRenderTarget(null);
    this.final.render(r);
  }
}
