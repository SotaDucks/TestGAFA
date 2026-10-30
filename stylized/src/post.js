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
  const int NS = 12;
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

// ---------------------------------------------------------------- 深度感知模糊
const BLUR_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float z0 = texture2D(tSrc, vUv).g;
  float sum = 0.0;
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    vec2 s = texture2D(tSrc, uv).rg;
    float w = exp(-float(i * i) / 9.0) / (0.002 + abs(s.g - z0) / max(z0, 0.1));
    sum += s.r * w;
    ws += w;
  }
  gl_FragColor = vec4(sum / ws, z0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- 合成：AO（带色相）+ 轮廓线 + 空气透视
const COMP_FS = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uHalf;
uniform vec2 uRes;
uniform float uAOStrength;
uniform vec3 uAOTint;
uniform vec3 uHazeCol;
uniform vec3 uHazeSun;
uniform vec3 uSunDir;
uniform vec4 uHaze; // x 密度  y 高度衰减  z 最大浓度  w 起始距离
uniform vec4 uLine; // x 线宽(px)  y 阈值  z 强度  w 淡出距离
uniform vec3 uLineCol;
varying vec2 vUv;
float linZ(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  if (d >= 0.999999) return 1e4;
  vec4 c = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return -c.z / c.w;
}
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  vec4 c = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 vp = c.xyz / c.w;
  bool sky = d >= 0.999999;
  float z = sky ? 1e4 : -vp.z;
  // AO 联合双边上采样
  vec2 pos = vUv * uHalf - 0.5;
  vec2 b = floor(pos);
  vec2 f = pos - b;
  float ao = 0.0;
  float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 cc = clamp(ivec2(b) + ivec2(i, j), ivec2(0), ivec2(uHalf) - 1);
    vec4 a = texelFetch(tAO, cc, 0);
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float w = bw / (0.001 + abs(a.g - z) / max(z, 0.1)) + 1e-5;
    ao += a.r * w;
    ws += w;
  }
  ao = sky ? 1.0 : ao / ws;
  // 遮蔽处偏向蓝紫，而不是发黑
  col *= mix(vec3(1.0), mix(uAOTint, vec3(1.0), ao), uAOStrength);
  if (!sky) {
    // 轮廓线：邻近像素明显更远 → 当前像素是前景物体的边
    vec2 px = uLine.x / uRes;
    float zf = max(max(linZ(vUv + vec2(px.x, 0.0)), linZ(vUv - vec2(px.x, 0.0))), max(linZ(vUv + vec2(0.0, px.y)), linZ(vUv - vec2(0.0, px.y))));
    float edge = smoothstep(uLine.y, uLine.y * 2.5, (zf - z) / z);
    edge *= 1.0 - smoothstep(uLine.w * 0.4, uLine.w, z);
    col = mix(col, col * uLineCol, edge * uLine.z);
    // 空气透视：远处融进浅蓝色的天光
    vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    rd /= dist;
    float hf = exp(-max(wp.y, 0.0) / uHaze.y);
    float fog = 1.0 - exp(-max(dist - uHaze.w, 0.0) * uHaze.x * (0.4 + 0.6 * hf));
    fog = min(fog, uHaze.z);
    vec3 hz = mix(uHazeCol, uHazeSun, pow(max(dot(rd, uSunDir), 0.0), 6.0) * 0.6);
    col = mix(col, hz, fog);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- 调色：Khronos Neutral（保色相、保饱和）+ 自然饱和度 + 轻微冷暖分离
const FINAL_FS = /* glsl */ `
uniform sampler2D tInput;
uniform float uExposure;
uniform float uVibrance;
uniform float uVignette;
varying vec2 vUv;
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float dd = 1.0 - startCompression;
  float newPeak = 1.0 - dd * dd / (peak + dd - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = texture2D(tInput, vUv).rgb * uExposure;
  col = neutral(max(col, 0.0));
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
  float sat = (mx - mn) / max(mx, 1e-4);
  col = mix(vec3(l), col, 1.0 + uVibrance * (1.0 - sat));
  col *= mix(vec3(0.97, 0.98, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.7, l));
  vec2 dc = vUv - 0.5;
  col *= mix(1.0, 0.9, smoothstep(0.15, 0.7, dot(dc, dc) * 2.0) * uVignette);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  constructor(renderer, scene, camera, { sunDir, hazeCol, hazeSun }) {
    this.r = renderer;
    this.scene = scene;
    this.camera = camera;
    this.frame = 0;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.size = size;
    this.depthTex = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depthTex, depthBuffer: true });
    const hw = Math.max(1, Math.floor(size.x / 2)), hh = Math.max(1, Math.floor(size.y / 2));
    const half = () => new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.aoA = half();
    this.aoB = half();
    this.compRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });

    const mk = (fs, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false }));
    this.ao = mk(AO_FS, {
      tDepth: { value: this.depthTex },
      uInvProj: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uRadius: { value: 1.2 },
      uIntensity: { value: 1.0 },
      uFrame: { value: 0 },
    });
    this.blur = mk(BLUR_FS, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.comp = mk(COMP_FS, {
      tScene: { value: this.sceneRT.texture },
      tDepth: { value: this.depthTex },
      tAO: { value: this.aoA.texture },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uHalf: { value: new THREE.Vector2(hw, hh) },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uAOStrength: { value: 0.9 },
      uAOTint: { value: new THREE.Color(0.32, 0.3, 0.52) },
      uHazeCol: { value: hazeCol },
      uHazeSun: { value: hazeSun },
      uSunDir: { value: sunDir },
      uHaze: { value: new THREE.Vector4(0.0042, 16, 0.75, 25) },
      uLine: { value: new THREE.Vector4(1, 0.06, 0.7, 70) },
      uLineCol: { value: new THREE.Color(0.42, 0.36, 0.55) },
    });
    this.final = mk(FINAL_FS, {
      tInput: { value: this.compRT.texture },
      uExposure: { value: 1.0 },
      uVibrance: { value: 0.22 },
      uVignette: { value: 1.0 },
    });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.16, 0.5, 1.15);
    this.lineScale();
  }

  // 线宽随分辨率缩放，1080p 约 1.2px
  lineScale() {
    this.comp.material.uniforms.uLine.value.x = Math.max(1, this.size.y / 900);
  }

  setSize() {
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    this.size = size;
    const hw = Math.max(1, Math.floor(size.x / 2)), hh = Math.max(1, Math.floor(size.y / 2));
    this.depthTex.image.width = size.x;
    this.depthTex.image.height = size.y;
    this.depthTex.dispose();
    this.sceneRT.setSize(size.x, size.y);
    for (const rt of [this.aoA, this.aoB]) rt.setSize(hw, hh);
    this.compRT.setSize(size.x, size.y);
    this.ao.material.uniforms.uRes.value.set(size.x, size.y);
    this.comp.material.uniforms.uHalf.value.set(hw, hh);
    this.comp.material.uniforms.uRes.value.set(size.x, size.y);
    this.bloom.setSize(size.x, size.y);
    this.lineScale();
  }

  render() {
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
    const bu = this.blur.material.uniforms;
    bu.tSrc.value = this.aoA.texture;
    bu.uDir.value.set(1 / hw, 0);
    r.setRenderTarget(this.aoB);
    this.blur.render(r);
    bu.tSrc.value = this.aoB.texture;
    bu.uDir.value.set(0, 1 / hh);
    r.setRenderTarget(this.aoA);
    this.blur.render(r);
    // 合成
    const cu = this.comp.material.uniforms;
    cu.uInvProj.value.copy(cam.projectionMatrixInverse);
    cu.uCamWorld.value.copy(cam.matrixWorld);
    cu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    r.setRenderTarget(this.compRT);
    this.comp.render(r);
    // 泛光
    this.bloom.render(r, null, this.compRT, 0.016, false);
    // 输出
    r.setRenderTarget(null);
    this.final.render(r);
  }
}
