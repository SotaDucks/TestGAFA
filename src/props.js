import * as THREE from 'three';
import { Rng, tube, vnoise, compose } from './utils.js';
import { SITE, groundY, slabTop } from './layout.js';
import { charTexture, textStripTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M = new THREE.Matrix4();

function withXf(batch, matrix, fn) {
  const prev = batch.xf;
  batch.xf = matrix;
  fn();
  batch.xf = prev;
}

// ---------------------------------------------------------------- 碎石
function rubbleGeometry(seed, flat = 1) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.7 + 0.6 * vnoise(x * 1.7 + seed, y * 1.7, z * 1.7 + seed * 3);
    const cut = Math.max(0.55, 1 - Math.max(0, x * 0.8 + seed * 0.1) * 0.4);
    p.setXYZ(i, x * n * cut, y * n * 0.75 * flat, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildProps({ batch, mats, bOut }) {
  const rng = new Rng(808);
  const group = new THREE.Group();

  // ================================================================ 碎石堆
  const piles = [
    ...bOut.rubble,
    { x: 16.8, y: SITE.podiumY, z: 2.6, r: 3.2, n: 120, h: 1.0 },
    { x: 6.4, y: SITE.podiumY, z: 1.6, r: 1.5, n: 30, h: 0.3 },
    { x: -14.8, y: SITE.podiumY, z: 1.4, r: 1.4, n: 22, h: 0.3 },
    { x: 19.5, y: SITE.podiumY, z: 5.2, r: 1.2, n: 18, h: 0.3 },
  ];
  const geos = [rubbleGeometry(1.3), rubbleGeometry(4.1, 0.7), rubbleGeometry(7.7, 1.2)];
  const lists = [[], [], []];
  for (const P of piles) {
    const H = P.h ?? 0.5;
    for (let i = 0; i < P.n; i++) {
      const a = rng.r() * Math.PI * 2, d = Math.sqrt(rng.r());
      const x = P.x + Math.cos(a) * d * P.r, z = P.z + Math.sin(a) * d * P.r * 0.7;
      const s = rng.range(0.06, 0.18) + (1 - d) * rng.range(0, 0.35);
      const y = P.y + (1 - d * d) * H * rng.r() + s * 0.3;
      lists[rng.int(0, 2)].push({ x, y, z, s, r: [rng.r() * 6, rng.r() * 6, rng.r() * 6] });
    }
  }
  // 零散碎块：广场、台阶、平台
  for (let i = 0; i < 160; i++) {
    const x = rng.range(-28, 28), z = rng.range(-2, 30);
    const y = groundY(x, z);
    if (z < 0.5 && Math.abs(x) < 17.6 && z > -8) {
      if (!rng.chance(0.5)) continue;
    } else if (z < 0.5) continue;
    const s = rng.range(0.03, 0.12);
    lists[rng.int(0, 2)].push({ x, y: y + s * 0.2, z, s, r: [rng.r() * 6, rng.r() * 6, rng.r() * 6] });
  }
  lists.forEach((L, gi) => {
    const mesh = new THREE.InstancedMesh(geos[gi], mats.concrete, L.length);
    L.forEach((it, i) => {
      compose([it.x, it.y, it.z], it.r, [it.s * rng.range(0.8, 1.3), it.s * rng.range(0.6, 1), it.s * rng.range(0.8, 1.3)], M);
      mesh.setMatrixAt(i, M);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  // ================================================================ 坠落的大块构件
  batch.box('concrete', 3.4, 0.38, 2.3, 16.7, SITE.podiumY + 0.75, 3.4, 0.32, 0.42, 0.22);
  batch.box('paint', 2.7, 1.4, 0.18, 14.9, SITE.podiumY + 0.12, 5.0, -1.48, 0.25, 0.06);
  batch.box('paint', 1.3, 1.35, 0.18, 5.9, SITE.podiumY + 0.13, 2.4, -1.5, 0.15, 0.08);
  batch.box('paint', 0.9, 1.3, 0.18, 7.1, SITE.podiumY + 0.35, 2.2, -1.1, -0.4, 0.3);
  batch.box('paint', 1.6, 1.35, 0.18, -15.4, SITE.podiumY + 0.45, 1.6, -0.95, 0.5, 0.2);
  // 栏杆残段
  batch.add('rust', tube([V(15.6, SITE.podiumY + 0.05, 4.2), V(16.5, SITE.podiumY + 0.3, 4.6), V(17.8, SITE.podiumY + 0.15, 5.4)], 0.02, { radial: 5 }));

  // ================================================================ 石膏几何体（美院素描课的“老朋友”）
  const plaster = (cx, cy, cz, yaw) => {
    const xf = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, cy, cz);
    withXf(batch, xf, () => {
      batch.box('plaster', 0.32, 0.32, 0.32, 0, 0.13, 0, 0.12, 0.4, 0.05);
      const sph = new THREE.SphereGeometry(0.17, 24, 16);
      sph.translate(0.55, 0.13, 0.15);
      batch.add('plaster', sph);
      const cone = new THREE.ConeGeometry(0.16, 0.42, 24);
      cone.rotateZ(1.35);
      cone.translate(-0.45, 0.14, 0.32);
      batch.add('plaster', cone);
      const hex = new THREE.CylinderGeometry(0.13, 0.13, 0.36, 6);
      hex.translate(0.2, 0.18, -0.45);
      batch.add('plaster', hex);
      const cyl = new THREE.CylinderGeometry(0.12, 0.12, 0.38, 24);
      cyl.rotateX(Math.PI / 2);
      cyl.rotateY(0.6);
      cyl.translate(-0.25, 0.09, -0.3);
      batch.add('plaster', cyl);
      const pyr = new THREE.ConeGeometry(0.2, 0.36, 4);
      pyr.rotateY(Math.PI / 4);
      pyr.translate(0.85, 0.15, -0.25);
      batch.add('plaster', pyr);
      // 十字穿插体
      batch.box('plaster', 0.44, 0.12, 0.12, -0.75, 0.2, -0.2, 0, 0.5, 0.3);
      batch.box('plaster', 0.12, 0.12, 0.44, -0.75, 0.2, -0.2, 0, 0.5, 0.3);
    });
  };
  plaster(-6.6, -0.04, 13.4, 0.4);
  // 架空层里的静物台
  const stillLife = new THREE.Matrix4().makeRotationY(-0.3).setPosition(1.4, SITE.podiumY, -4.6);
  withXf(batch, stillLife, () => {
    batch.box('wood', 0.9, 0.05, 0.9, 0, 0.7, 0);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) batch.box('wood', 0.05, 0.7, 0.05, x, 0.35, z);
  });
  const sl2 = new THREE.Matrix4().makeRotationY(-0.3).setPosition(1.4, SITE.podiumY + 0.725, -4.6);
  withXf(batch, sl2, () => {
    batch.box('plaster', 0.26, 0.26, 0.26, -0.15, 0.13, 0.05);
    const sph = new THREE.SphereGeometry(0.12, 20, 14);
    sph.translate(0.2, 0.12, 0.1);
    batch.add('plaster', sph);
    const cone = new THREE.ConeGeometry(0.1, 0.32, 20);
    cone.translate(0.05, 0.16, -0.22);
    batch.add('plaster', cone);
  });

  // ================================================================ 画架
  const easel = (x, y, z, yaw, tilt = 0, roll = 0, withCanvas = true) => {
    const xf = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, yaw, roll, 'YXZ')).setPosition(x, y, z);
    withXf(batch, xf, () => {
      batch.box('wood', 0.045, 1.75, 0.035, -0.28, 0.86, 0, 0, 0, -0.14);
      batch.box('wood', 0.045, 1.75, 0.035, 0.28, 0.86, 0, 0, 0, 0.14);
      batch.box('wood', 0.04, 1.7, 0.035, 0, 0.82, -0.42, 0.42, 0, 0);
      batch.box('wood', 0.72, 0.04, 0.035, 0, 0.6, 0.01);
      batch.box('wood', 0.62, 0.03, 0.09, 0, 0.78, 0.05);
      batch.box('wood', 0.04, 1.2, 0.03, 0, 1.2, 0.02);
      if (withCanvas) {
        batch.box('wood', 0.64, 0.8, 0.02, 0, 1.2, 0.07);
        const p = new THREE.PlaneGeometry(0.6, 0.76);
        p.translate(0, 1.2, 0.082);
        batch.add('painting', p);
      }
    });
  };
  easel(2.6, SITE.podiumY, -3.6, 0.35);
  easel(-3.8, SITE.podiumY + 0.04, -2.2, 1.1, -1.5, 0, true);
  easel(9.6, SITE.podiumY, -0.9, -0.2, -0.22, 0.05);
  easel(6.2, SITE.podiumY, -9.6, 0.1);
  easel(7.6, SITE.podiumY, -10.4, -0.4, 0, 0, false);

  // ================================================================ 倒伏的共享单车
  const bike = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-1.47, 0.75, 0, 'YXZ')).setPosition(11.8, 0.05, 15.2);
  withXf(batch, bike, () => {
    for (const wx of [-0.52, 0.52]) {
      const tor = new THREE.TorusGeometry(0.31, 0.028, 8, 32);
      tor.translate(wx, 0.33, 0);
      batch.add('rubber', tor);
      for (let k = 0; k < 3; k++) batch.box('bike', 0.3, 0.035, 0.02, wx + Math.cos((k * 2 * Math.PI) / 3) * 0.15, 0.33 + Math.sin((k * 2 * Math.PI) / 3) * 0.15, 0, 0, 0, (k * 2 * Math.PI) / 3);
      const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12);
      hub.rotateX(Math.PI / 2);
      hub.translate(wx, 0.33, 0);
      batch.add('bike', hub);
    }
    const tb = (pts, r = 0.026) => batch.add('bike', tube(pts.map((p) => V(...p)), r, { radial: 6, perMeter: 8, minSeg: 4 }));
    tb([[-0.52, 0.33, 0], [-0.25, 0.3, 0], [0, 0.28, 0]]);
    tb([[0, 0.28, 0], [-0.08, 0.6, 0], [-0.14, 0.86, 0]]);
    tb([[0, 0.28, 0], [0.2, 0.42, 0], [0.4, 0.74, 0]], 0.032);
    tb([[-0.52, 0.33, 0], [-0.3, 0.55, 0], [-0.1, 0.72, 0]]);
    tb([[0.4, 0.74, 0], [0.45, 0.55, 0], [0.52, 0.33, 0]]);
    tb([[0.4, 0.74, 0], [0.39, 0.9, 0], [0.37, 1.0, 0]]);
    batch.add('rust', tube([V(0.37, 1.0, -0.3), V(0.37, 1.02, 0), V(0.37, 1.0, 0.3)], 0.016, { radial: 5 }));
    batch.box('rubber', 0.26, 0.06, 0.13, -0.15, 0.89, 0);
    // 车筐
    const bx = 0.62, by = 0.86;
    for (const [a, b] of [[[0, 0, -0.15], [0.3, 0, -0.15]], [[0, 0, 0.15], [0.3, 0, 0.15]], [[0, 0.22, -0.15], [0.3, 0.22, -0.15]], [[0, 0.22, 0.15], [0.3, 0.22, 0.15]], [[0, 0, -0.15], [0, 0, 0.15]], [[0.3, 0, -0.15], [0.3, 0, 0.15]], [[0, 0.22, -0.15], [0, 0.22, 0.15]], [[0.3, 0.22, -0.15], [0.3, 0.22, 0.15]], [[0, 0, -0.15], [0, 0.22, -0.15]], [[0.3, 0, -0.15], [0.3, 0.22, -0.15]], [[0, 0, 0.15], [0, 0.22, 0.15]], [[0.3, 0, 0.15], [0.3, 0.22, 0.15]]]) {
      batch.add('rust', tube([V(bx + a[0], by + a[1], a[2]), V(bx + (a[0] + b[0]) / 2, by + (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), V(bx + b[0], by + b[1], b[2])], 0.008, { radial: 4, perMeter: 4 }));
    }
    batch.box('rust', 0.3, 0.01, 0.3, bx + 0.15, by, 0);
  });

  // ================================================================ 路灯（立着的 / 弯折的 / 倒地的）
  const lamp = (x, z, mode) => {
    const pts = [];
    if (mode === 'stand') pts.push(V(x, 0, z), V(x, 2.5, z), V(x + 0.05, 5.2, z), V(x + 0.6, 5.7, z), V(x + 1.1, 5.6, z));
    if (mode === 'bent') pts.push(V(x, 0, z), V(x, 1.8, z), V(x + 0.6, 3.6, z + 0.2), V(x + 1.9, 4.2, z + 0.5), V(x + 2.6, 3.7, z + 0.6));
    if (mode === 'fallen') pts.push(V(x, 0.1, z), V(x + 1.6, 0.12, z + 1.4), V(x + 3.4, 0.1, z + 2.8), V(x + 3.9, 0.3, z + 3.3), V(x + 4.3, 0.25, z + 3.7));
    batch.add('lamp', tube(pts, [0.075, 0.045], { radial: 8, perMeter: 3 }));
    const end = pts[pts.length - 1];
    batch.box('lamp', 0.55, 0.12, 0.26, end.x + 0.1, end.y - 0.05, end.z, 0, mode === 'fallen' ? 0.8 : 0, mode === 'bent' ? -0.6 : 0);
    batch.mm('concrete', x - 0.25, -0.05, z - 0.25, x + 0.25, 0.25, z + 0.25);
  };
  lamp(-17, 15, 'stand');
  lamp(17.5, 12.5, 'bent');
  lamp(-13.5, 29, 'fallen');

  // ================================================================ 校名墙
  const sign = new THREE.Group();
  sign.position.set(14.2, 0, 17.2);
  sign.rotation.y = -0.38;
  const signBatchXf = new THREE.Matrix4().makeRotationY(-0.38).setPosition(14.2, 0, 17.2);
  withXf(batch, signBatchXf, () => {
    batch.mm('stone', -3.9, -0.1, -0.45, 3.9, 0.16, 0.45);
    batch.mm('stone', -3.6, 0.16, -0.3, 3.6, 1.55, 0.3);
    batch.mm('stone', -3.68, 1.55, -0.34, 3.68, 1.65, 0.34);
  });
  const metal = (tex, tint) =>
    new THREE.MeshStandardMaterial({ map: tex, color: tint, metalness: 0.75, roughness: 0.5, alphaTest: 0.5, side: THREE.DoubleSide });
  const chars = '广州美术学院';
  for (let i = 0; i < chars.length; i++) {
    const tex = charTexture(chars[i]);
    const tint = new THREE.Color().setHSL(0.09 + rng.range(-0.02, 0.03), 0.45, 0.28 + rng.range(-0.03, 0.05));
    if (i === 3) tint.setHSL(0.33, 0.18, 0.3); // 铜绿
    const m = metal(tex, tint);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), m);
    const x = -2.75 + i * 1.1;
    mesh.position.set(x, 0.98, 0.335);
    if (i === 4) {
      // 只剩一颗钉子挂着，歪了
      mesh.geometry.translate(-0.4, -0.4, 0);
      mesh.position.set(x + 0.4, 1.38, 0.33);
      mesh.rotation.z = -0.5;
    }
    if (i === 5) {
      // 掉下来，斜靠在墙脚
      mesh.position.set(x + 0.15, 0.36, 0.62);
      mesh.rotation.set(-0.42, 0.12, 0.18);
      // 墙上留下的印痕
      const ghost = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshStandardMaterial({ map: tex, color: '#3a362e', roughness: 1, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      ghost.position.set(x, 0.98, 0.302);
      sign.add(ghost);
    }
    // 厚度：后面叠几层更暗的同形面片
    for (let k = 1; k <= 3; k++) {
      const back = new THREE.Mesh(mesh.geometry, metal(tex, tint.clone().multiplyScalar(0.45)));
      back.position.z = -0.009 * k;
      mesh.add(back);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sign.add(mesh);
  }
  const en = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 0.3), metal(textStripTexture('GUANGZHOU ACADEMY OF FINE ARTS'), new THREE.Color().setHSL(0.09, 0.4, 0.3)));
  en.position.set(0, 0.36, 0.31);
  en.castShadow = true;
  sign.add(en);
  group.add(sign);

  return group;
}
