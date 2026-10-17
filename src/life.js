import * as THREE from 'three';
import { Rng } from './utils.js';
import { shared } from './materials.js';

// ---------------------------------------------------------------- 光中浮尘（只在阳光里可见）
export function createDust(count = 2200) {
  const rng = new Rng(31);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(-26, 22);
    pos[i * 3 + 1] = rng.range(0.4, 20);
    pos[i * 3 + 2] = rng.range(-6, 28);
    seed[i] = rng.r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      tShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uSunCol: shared.uSunCol,
      uSize: { value: 60 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uSize;
      varying float vAlpha;
      varying vec3 vW;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.13 + aSeed * 10.0) * 0.6 + uTime * 0.06;
        p.y += sin(uTime * 0.09 + aSeed * 7.0) * 0.5;
        p.z += cos(uTime * 0.11 + aSeed * 5.0) * 0.6;
        p.x = mod(p.x + 26.0, 48.0) - 26.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.4 + aSeed) / max(1.0, -mv.z);
        vW = (modelMatrix * vec4(p, 1.0)).xyz;
        vAlpha = 0.5 + 0.5 * sin(uTime * 0.8 + aSeed * 30.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2DShadow tShadow;
      uniform mat4 uShadowMatrix;
      uniform vec3 uSunCol;
      varying float vAlpha;
      varying vec3 vW;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d);
        vec4 sc = uShadowMatrix * vec4(vW, 1.0);
        float vis = 0.0;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) vis = texture(tShadow, vec3(sc.xy, sc.z - 0.002));
        gl_FragColor = vec4(uSunCol * vis * a * vAlpha * 0.05, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- 鸟群
export function createBirds(n = 9) {
  const rng = new Rng(55);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#16130f', roughness: 0.9, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.12, 0.55, 0, -0.02, 0, 0, 0.12, 0.55, 0, -0.02, 0.32, 0, 0.12], 3));
  wingGeo.computeVertexNormals();
  const bodyGeo = new THREE.ConeGeometry(0.06, 0.45, 6);
  bodyGeo.rotateX(Math.PI / 2);
  const birds = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(bodyGeo, mat));
    const wl = new THREE.Mesh(wingGeo, mat);
    const wr = new THREE.Mesh(wingGeo, mat);
    wr.scale.x = -1;
    b.add(wl, wr);
    b.scale.setScalar(rng.range(0.9, 1.3));
    group.add(b);
    birds.push({ b, wl, wr, r: rng.range(18, 34), h: rng.range(26, 38), sp: rng.range(0.12, 0.2) * rng.sign(), ph: rng.range(0, 6.28), fl: rng.range(7, 10), cx: rng.range(-12, 6), cz: rng.range(-18, 4) });
  }
  group.userData.update = (t) => {
    for (const q of birds) {
      const a = q.ph + t * q.sp;
      const x = q.cx + Math.cos(a) * q.r, z = q.cz + Math.sin(a) * q.r * 0.7;
      const y = q.h + Math.sin(t * 0.3 + q.ph) * 2.5;
      q.b.position.set(x, y, z);
      const dx = -Math.sin(a) * Math.sign(q.sp), dz = Math.cos(a) * 0.7 * Math.sign(q.sp);
      q.b.rotation.set(0, Math.atan2(dx, dz), -0.25 * Math.sign(q.sp));
      const glide = Math.sin(t * 0.5 + q.ph) > 0.2;
      const f = glide ? 0.12 + Math.sin(t * 2 + q.ph) * 0.05 : Math.sin(t * q.fl + q.ph) * 0.75;
      q.wl.rotation.z = f;
      q.wr.rotation.z = -f;
    }
  };
  return group;
}

// ---------------------------------------------------------------- 蝴蝶
export function createButterflies(spots) {
  const rng = new Rng(66);
  const group = new THREE.Group();
  const flies = [];
  const wing = new THREE.CircleGeometry(0.045, 10);
  wing.translate(0.045, 0.01, 0);
  wing.rotateX(-Math.PI / 2);
  const cols = ['#f4efe1', '#f2c94c', '#e0812f', '#f4efe1', '#9ec5e8'];
  for (const s of spots) {
    const mat = new THREE.MeshStandardMaterial({ color: rng.pick(cols), roughness: 0.7, side: THREE.DoubleSide, emissive: '#000' });
    const b = new THREE.Group();
    const wl = new THREE.Mesh(wing, mat), wr = new THREE.Mesh(wing, mat);
    wr.scale.x = -1;
    b.add(wl, wr);
    group.add(b);
    flies.push({ b, wl, wr, s, ph: rng.range(0, 10), sp: rng.range(0.25, 0.45) });
  }
  group.userData.update = (t) => {
    for (const f of flies) {
      const a = t * f.sp + f.ph;
      const x = f.s.x + Math.sin(a * 1.3) * 1.6 + Math.sin(a * 3.1) * 0.3;
      const z = f.s.z + Math.cos(a * 0.9) * 1.4;
      const y = f.s.y + 0.6 + Math.sin(a * 2.3) * 0.4 + Math.abs(Math.sin(t * 9 + f.ph)) * 0.08;
      const dx = f.b.position.x - x, dz = f.b.position.z - z;
      f.b.position.set(x, y, z);
      f.b.rotation.y = Math.atan2(dx, dz);
      const flap = Math.sin(t * 22 + f.ph) * 1.1;
      f.wl.rotation.z = flap;
      f.wr.rotation.z = -flap;
    }
  };
  return group;
}
