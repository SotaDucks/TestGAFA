import * as THREE from 'three';
import { shared } from './materials.js';

export function createSkyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: sunDir }, tNoise: shared.tNoise, uTime: shared.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform sampler2D tNoise;
      uniform float uTime;
      varying vec3 vDir;
      float cloudFbm(vec2 p) {
        float v = texture2D(tNoise, p).r * 0.55;
        v += texture2D(tNoise, p * 2.7 + 0.3).a * 0.3;
        v += texture2D(tNoise, p * 7.1 + 0.7).g * 0.15;
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.10, 0.25, 0.62);
        vec3 mid = vec3(0.32, 0.52, 0.86);
        vec3 horizon = vec3(0.86, 0.84, 0.78);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zenith, smoothstep(0.25, 0.9, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.72, 0.42) * pow(sd, 5.0) * 0.9;
        col += vec3(1.0, 0.85, 0.6) * pow(sd, 48.0) * 3.0;
        col += vec3(1.0, 0.92, 0.75) * smoothstep(0.9996, 0.99985, sd) * 80.0;
        // 积云
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.12) * 0.09 + vec2(uTime * 0.0012, uTime * 0.0004);
          float c = cloudFbm(cp);
          float cov = smoothstep(0.5, 0.78, c) * smoothstep(0.02, 0.2, h);
          float thick = smoothstep(0.55, 0.95, c);
          vec3 lit = mix(vec3(1.0, 0.98, 0.95) * 1.9, vec3(1.0, 0.86, 0.68) * 2.8, pow(sd, 3.0));
          vec3 shadow = vec3(0.62, 0.68, 0.78) * 1.1;
          vec3 cc = mix(lit, shadow, thick * 0.7);
          col = mix(col, cc, cov * 0.92);
        }
        col = mix(col, horizon * 0.55, smoothstep(0.0, -0.25, h));
        gl_FragColor = vec4(col, 1.0);
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

// 由天空 + 地面生成 IBL
export function createEnvironment(renderer, sunDir) {
  const envScene = new THREE.Scene();
  envScene.add(createSky(sunDir));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.09, 0.085, 0.06) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  // 模拟周围树冠/建筑对天空的遮挡：一圈暗绿色带
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 18, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.07, 0.035), side: THREE.BackSide }));
  ring.position.y = 6;
  envScene.add(ring);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
  pmrem.dispose();
  return rt.texture;
}
