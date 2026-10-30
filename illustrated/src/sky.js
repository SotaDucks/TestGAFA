import * as THREE from 'three';
import { shared, INK_SHADER_PARS } from './materials.js';

// 风格化天空的几个关键色（线性空间，未经色调映射）
export const SKY = {
  zenith: new THREE.Color('#6fa3cc'),
  mid: new THREE.Color('#9cc4dc'),
  horizon: new THREE.Color('#dde7e0'),
  cloudLit: new THREE.Color(1.1, 1.09, 1.04),
  cloudShade: new THREE.Color('#c4ccd4'),
};

export function createSkyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDir },
      tNoise: shared.tNoise,
      uTime: shared.uTime,
      uZenith: { value: SKY.zenith },
      uMid: { value: SKY.mid },
      uHorizon: { value: SKY.horizon },
      uCloudLit: { value: SKY.cloudLit },
      uCloudShade: { value: SKY.cloudShade },
      uInkId: { value: 0 },
      uInkMode: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${INK_SHADER_PARS}
      uniform vec3 uSunDir;
      uniform sampler2D tNoise;
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      varying vec3 vDir;
      // 积云：低频覆盖 + Worley 团块（圆鼓鼓的云朵）+ 少量细节
      float cloudD(vec2 p) {
        float base = texture2D(tNoise, p * 0.5).r;
        float puff = 1.0 - texture2D(tNoise, p * 1.25 + 0.17).b;
        float puff2 = 1.0 - texture2D(tNoise, p * 2.6 + 0.61).b;
        float det = texture2D(tNoise, p * 4.0 + 0.53).a;
        return base * 0.52 + puff * 0.3 + puff2 * 0.12 + det * 0.08;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, h));
        col = mix(col, uZenith, smoothstep(0.28, 1.0, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.94, 0.8) * pow(sd, 10.0) * 0.15;
        col = mix(col, vec3(1.7, 1.6, 1.4), smoothstep(0.99935, 0.9996, sd));
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.2) * 0.13 + vec2(uTime * 0.0016, uTime * 0.0005);
          float c = cloudD(cp);
          // 云多在天空下半部，越往天顶越稀
          float hm = smoothstep(0.015, 0.1, h) * (1.0 - 0.75 * smoothstep(0.35, 0.85, h));
          float thr = 0.63 + (1.0 - hm) * 0.25;
          float cov = smoothstep(thr, thr + 0.012, c);
          // 朝太阳方向偏移采样：那边更密 → 处在自身阴影里；明暗用硬边
          vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.05;
          float c2 = cloudD(cp + toSun);
          float shade = smoothstep(0.012, 0.035, c2 - c);
          float inner = smoothstep(thr + 0.06, thr + 0.22, c);
          vec3 cc = mix(uCloudLit, uCloudShade, max(shade * 0.85, inner * 0.2));
          // 迎光的云边一圈更亮
          float rimC = (1.0 - smoothstep(thr, thr + 0.03, c)) * (1.0 - shade);
          cc += vec3(0.2, 0.18, 0.12) * rimC;
          // 靠近地平线的云融进天色
          cc = mix(cc, uHorizon * 1.05, 1.0 - smoothstep(0.0, 0.12, h));
          col = mix(col, cc, cov);
        }
        col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(col, 1.0);
        pc_fragInk = vec4(0.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
}

export function createSky(sunDir) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial(sunDir));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
