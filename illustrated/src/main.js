import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Batch, Rng, nextFrame } from './utils.js';
import { SITE } from './layout.js';
import { createNoise, leafClusterTexture, ivyTexture, fernTexture, fallenLeafAtlas, muralTexture, paintingTexture, treelineTexture } from './textures.js';
import { shared, painted, foliage, glassMaterial, toon, INK, INK_SHADER_PARS } from './materials.js';
import { createSky, SKY } from './sky.js';
import { buildBlock, buildPodium, buildPlazaFurniture } from './building.js';
import { buildBanyan, WING } from './banyan.js';
import { buildVegetation, mergeTubes } from './vegetation.js';
import { buildProps } from './props.js';
import { createDust, createBirds, createButterflies } from './life.js';
import { Post } from './post.js';

// 插画版：暖色斜阳，强度单位是卡通光照里的直接倍数
const SUN_DIR = new THREE.Vector3(-0.75, 0.56, 0.36).normalize();
const SUN_COLOR = new THREE.Color('#fff0d6');
const SUN_INT = 1.35;

// 竖屏/窄屏时保持水平视角，构图不被裁掉
function fovFor(aspect) {
  const base = 46, ref = 16 / 9;
  if (aspect >= ref) return base;
  const h = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * ref);
  return Math.min(72, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect)) * 0.85 + base * 0.15);
}

const loaderBar = document.querySelector('#loader .l-bar i');
const loaderSub = document.querySelector('#loader .l-sub');
async function step(label, pct) {
  loaderSub.textContent = label;
  loaderBar.style.width = pct + '%';
  await nextFrame();
  await nextFrame();
}

async function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(15, 3.0, 28);

  await step('生成噪声与材质…', 6);
  const noise = createNoise(512);
  shared.tNoise.value = noise.tex;

  await step('绘制叶片…', 16);
  const tex = {
    banyan: leafClusterTexture({ seed: 11, lobes: 6 }),
    broad: leafClusterTexture({ seed: 23, lobes: 5 }),
    shrub: leafClusterTexture({ seed: 37, lobes: 6, leafLen: [16, 26] }),
    ivy: ivyTexture(),
    fern: fernTexture(),
    fallen: fallenLeafAtlas(),
    mural: muralTexture(),
    painting: paintingTexture(),
  };

  await step('调色盘与手绘材质…', 22);
  const plazaRect = [SITE.plaza.x0, SITE.plaza.x1, -10, SITE.plaza.z1];
  const mats = {
    concrete: painted({ color: '#c6bfae', seed: 0.0, moss: 0.7, streaks: 0.6 }),
    paint: painted({ color: '#c6bfae', paint: '#c4825e', paintAmount: 0.9, moss: 0.6, streaks: 0.5, seed: 3.1 }),
    wall: painted({ color: '#d2cab8', paint: '#ddd5c4', paintAmount: 0.82, moss: 0.4, streaks: 0.5, seed: 7.7 }),
    interior: painted({ color: '#56605f', moss: 0.1, streaks: 0.2, dirt: 0.2, seed: 1.7, rim: 0 }),
    stone: painted({ color: '#d3c9b4', moss: 0.6, streaks: 0.3, seed: 5.5 }),
    plaster: painted({ color: '#ece6da', moss: 0.6, streaks: 0.3, seed: 9.1, scale: 2.0 }),
    soil: painted({ kind: 'soil', color: '#a4a66e', brush: 0.2 }),
    frame: painted({ kind: 'rust', color: '#6e5444', paint: '#3e4a48', paintAmount: 0.85, seed: 2.2 }),
    rust: painted({ kind: 'rust', color: '#8a5e44', seed: 4.4 }),
    lamp: painted({ kind: 'rust', color: '#8a5e44', paint: '#4c5650', paintAmount: 0.9, seed: 8.2 }),
    bike: painted({ kind: 'rust', color: '#8a5e44', paint: '#d4ad52', paintAmount: 1.0, seed: 6.6, scale: 3 }),
    rubber: toon({ color: '#36332f' }),
    wood: painted({ kind: 'wood', color: '#a98563', moss: 0.4, streaks: 0.2, seed: 3.3 }),
    painting: painted({ color: '#e6dccb', map: tex.painting, moss: 0.1, streaks: 0.2, decal: 1.0 }),
    mural: painted({ color: '#cfc6b4', map: tex.mural, moss: 0.3, streaks: 0.5, decal: 1.0, seed: 2.9 }),
    glass: glassMaterial(),
    bark: painted({ kind: 'bark', color: '#9b7658', moss: 1.1, mossColor: '#8c9a50' }),
    plaza: painted({ kind: 'pavers', color: '#e8dbbb', mossColor: '#a3a865', rect: plazaRect }),
    podium: painted({ kind: 'pavers', color: '#e2d5b6', mossColor: '#a3a865', rect: [-38, 38, -60, 7] }),
    // 草、藤、落叶不描线：太碎，描了只会是一片杂线
    grass: foliage({ grass: true, vertexColors: true, wind: 0.08, flutter: 0.012, normalBlend: 1.0, transl: 0.2, brush: 0.2, ink: INK.none }),
    banyanLeaf: foliage({ map: tex.banyan, wind: 0.04, flutter: 0.015, normalBlend: 0.92 }),
    broadLeaf: foliage({ map: tex.broad, wind: 0.05, flutter: 0.018, normalBlend: 0.92 }),
    shrub: foliage({ map: tex.shrub, wind: 0.03, flutter: 0.015, normalBlend: 0.88 }),
    ivy: foliage({ map: tex.ivy, wind: 0.018, flutter: 0.015, normalBlend: 0.7, ink: INK.none }),
    fern: foliage({ map: tex.fern, wind: 0.03, flutter: 0.01, normalBlend: 0.5 }),
    fallen: foliage({ map: tex.fallen, atlas: true, wind: 0, flutter: 0, normalBlend: 0, transl: 0, ink: INK.none }),
  };

  // ---------------------------------------------------------------- 光照与天空
  await step('天空与光照…', 30);
  const sky = createSky(SUN_DIR);
  scene.add(sky);
  const hazeCol = new THREE.Color(0.6, 0.68, 0.72);
  const hazeSun = new THREE.Color(1.0, 0.95, 0.85);

  const center = new THREE.Vector3(-1, 6, 6);
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INT);
  sun.position.copy(SUN_DIR).multiplyScalar(90).add(center);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -46;
  sc.right = 46;
  sc.top = 40;
  sc.bottom = -40;
  sc.near = 30;
  sc.far = 170;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  shared.uSunCol.value.copy(SUN_COLOR).multiplyScalar(SUN_INT);

  // ---------------------------------------------------------------- 建筑
  await step('浇筑混凝土…', 38);
  const batch = new Batch();
  const rng = new Rng(2024);
  const bOut = buildBlock(batch, rng, {
    x0: SITE.B.x0,
    x1: SITE.B.x1,
    bays: SITE.B.bays,
    collapse: true,
    detail: 1,
    gaps: [
      { k: 2, a: -16.4, b: -13.15 },
      { k: 1, a: 5.3, b: 7.6 },
    ],
    paintedCols: [3, 4, 6],
    mural: true,
    groundTypes: ['wall', 'wall', 'wall', 'wall', 'door', 'gallery', 'shutter', 'door'],
    towerX: -4,
  });
  const podOut = buildPodium(batch, rng);
  const furn = buildPlazaFurniture(batch, rng);

  // 侧翼
  const wingBatch = new Batch();
  wingBatch.xf = new THREE.Matrix4().makeRotationY(WING.rot).setPosition(WING.ox, 0, WING.oz);
  const wingOut = buildBlock(wingBatch, new Rng(77), { x0: WING.x0, x1: WING.x1, bays: 6, floors: WING.floors, detail: 0, rightEnd: true, leftEnd: true, groundTypes: ['wall', 'door', 'wall', 'wall', 'shutter', 'wall'], gaps: [{ k: 2, a: -14, b: -11.5 }] });
  // 远处的另一栋楼
  const farBatch = new Batch();
  farBatch.xf = new THREE.Matrix4().makeRotationY(0.45).setPosition(38, 0, -26);
  buildBlock(farBatch, new Rng(99), { x0: -12, x1: 12, bays: 5, floors: 4, detail: 0, groundTypes: ['wall', 'door', 'wall', 'wall', 'wall'], gaps: [{ k: 3, a: -4, b: -1 }] });

  await step('摆放遗物…', 48);
  const propsGroup = buildProps({ batch, mats, bOut });
  scene.add(propsGroup);

  for (const m of [...batch.build(mats, { shadowless: ['glass'] }), ...wingBatch.build(mats, { shadowless: ['glass'] }), ...farBatch.build(mats, { shadowless: ['glass'] })]) scene.add(m);

  // 地面
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(100, 52, 1, 1), mats.plaza);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0, SITE.podiumFront + 26);
  plaza.receiveShadow = true;
  scene.add(plaza);
  const podTop = new THREE.Mesh(new THREE.PlaneGeometry(92, 70), mats.podium);
  mats.podium.polygonOffset = true;
  mats.podium.polygonOffsetFactor = -1;
  mats.podium.polygonOffsetUnits = -4;
  podTop.rotation.x = -Math.PI / 2;
  podTop.position.set(0, SITE.podiumY + 0.002, SITE.podiumFront - 35);
  podTop.receiveShadow = true;
  scene.add(podTop);
  // 远景树线
  const tl = treelineTexture();
  tl.repeat.set(5, 1);
  const treeline = new THREE.Mesh(
    new THREE.CylinderGeometry(150, 150, 46, 128, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { map: { value: tl }, uHaze: { value: hazeCol }, uInkId: { value: 0 }, uInkMode: { value: INK.none } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv * vec2(5.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `${INK_SHADER_PARS} uniform sampler2D map; uniform vec3 uHaze; varying vec2 vUv;
        void main(){ vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard;
          vec3 c = mix(t.rgb, uHaze, 0.2 + 0.3 * (1.0 - vUv.y));
          gl_FragColor = vec4(c, 1.0); pc_fragInk = vec4(0.0); }`,
      side: THREE.BackSide,
    })
  );
  treeline.position.set(0, 18, 10);
  scene.add(treeline);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mats.soil);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------------------------------------------------------------- 榕树
  await step('榕树正在生长…', 60);
  const banyan = buildBanyan(7);
  const bark = new THREE.Mesh(mergeTubes(banyan.bark), mats.bark);
  bark.castShadow = bark.receiveShadow = true;
  scene.add(bark);

  await step('野草、藤蔓与落叶…', 74);
  const veg = buildVegetation({ noise, mats, banyan, bOut, wingOut, podOut, furn });
  scene.add(veg);

  await step('生灵…', 86);
  // 插画版不要光里的浮尘
  const dust = createDust();
  const birds = createBirds();
  scene.add(birds);
  const flies = createButterflies([
    { x: 0, y: 1.6, z: 9 },
    { x: -20, y: 2.4, z: 5 },
    { x: 22, y: 2.4, z: 5 },
    { x: -25, y: 0, z: 9 },
    { x: 13, y: 0, z: 8.5 },
    { x: -6, y: 0, z: 14 },
  ]);
  scene.add(flies);

  // ---------------------------------------------------------------- 相机控制
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-3, 7.5, 2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 4;
  controls.maxDistance = 52;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.63;
  controls.minAzimuthAngle = -1.05;
  controls.maxAzimuthAngle = 1.05;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.7;
  controls.panSpeed = 0.6;
  controls.update();

  await step('后期：轮廓线 / 空气透视 / 调色…', 94);
  const post = new Post(renderer, scene, camera, { sunDir: SUN_DIR, hazeCol, hazeSun });

  // 预编译
  renderer.compile(scene, camera);
  await step('就绪', 100);
  document.getElementById('loader').classList.add('done');
  document.getElementById('hud').classList.add('show');

  // ---------------------------------------------------------------- 交互
  let auto = false;
  let lastInteract = performance.now();
  controls.addEventListener('start', () => {
    auto = false;
    lastInteract = performance.now();
    document.body.classList.remove('touring');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') window.location.href = '../'; // 切换到写实版本
    if (e.key === '2') window.location.href = '../stylized/'; // 切换到风格化版本
    if (e.key === 'h' || e.key === 'H') document.getElementById('hud').classList.toggle('show');
    if (e.key === 'c' || e.key === 'C') {
      auto = !auto;
      document.body.classList.toggle('touring', auto);
    }
  });
  let lastW = 0, lastH = 0;
  const fit = () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && h === lastH) return;
    if (w < 2 || h < 2) return;
    lastW = w;
    lastH = h;
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.setSize();
  };
  window.addEventListener('resize', fit);

  let prevT = performance.now();
  // 自适应分辨率：前 120 帧平均低于 ~40fps 时降低像素比
  let perfFrames = 0, perfAcc = 0, perfChecks = 0;
  const shake = new THREE.Vector3();
  let t = 0;
  function frame() {
    fit();
    const now = performance.now();
    const raw = (now - prevT) / 1000;
    const dt = Math.min(raw, 0.05);
    prevT = now;
    if (perfChecks < 3 && document.visibilityState === 'visible' && raw < 0.15) {
      perfFrames++;
      perfAcc += raw;
      if (perfFrames === 120) {
        const avg = perfAcc / perfFrames;
        if (avg > 1 / 40 && renderer.getPixelRatio() > 0.7) {
          renderer.setPixelRatio(Math.max(0.7, renderer.getPixelRatio() * 0.8));
          lastW = 0;
          fit();
        }
        perfFrames = 0;
        perfAcc = 0;
        perfChecks++;
      }
    }
    t += dt;
    shared.uTime.value = t;
    if (auto) {
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      sph.theta += dt * 0.05 * Math.cos(t * 0.05);
      sph.theta = THREE.MathUtils.clamp(sph.theta, controls.minAzimuthAngle, controls.maxAzimuthAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
    controls.update();
    // 限制平移范围
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -22, 22);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 1.5, 16);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -8, 30);
    if (camera.position.y < 0.6) camera.position.y = 0.6;

    birds.userData.update(t);
    flies.userData.update(t);
    const sm = sun.shadow.map;
    dust.visible = !!(sm && sm.depthTexture);
    if (dust.visible) {
      dust.material.uniforms.tShadow.value = sm.depthTexture;
      dust.material.uniforms.uShadowMatrix.value.copy(sun.shadow.matrix);
    }

    // 手持呼吸感
    shake.set(Math.sin(t * 0.31) * 0.025 + Math.sin(t * 0.73) * 0.01, Math.sin(t * 0.43) * 0.02, Math.cos(t * 0.27) * 0.02);
    camera.position.add(shake);
    camera.updateMatrixWorld();
    shared.uSunDirV.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    post.render(t);
    camera.position.sub(shake);
    requestAnimationFrame(frame);
  }
  frame();
  window.__scene = { scene, camera, controls, renderer, post, sun, mats };
  // 开发辅助：离屏渲染指定分辨率并保存到 ./shots（仅 dev 服务器）
  if (import.meta.env.DEV) window.__shot = async (name = 'shot', w = 1600, h = 900) => {
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    post.setSize();
    camera.updateMatrixWorld();
    shared.uSunDirV.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    post.render(t);
    post.render(t);
    const blob = await new Promise((res) => {
      const url = renderer.domElement.toDataURL('image/png');
      fetch(url).then((r) => r.blob()).then(res);
    });
    await fetch('/__shot?name=' + name, { method: 'POST', body: blob });
    renderer.setPixelRatio(pr);
    lastW = 0;
    fit();
    return 'saved ' + name;
  };
  window.__cam = (x, y, z, tx, ty, tz) => {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    controls.update();
  };
}

init().catch((e) => {
  console.error(e);
  const s = document.querySelector('#loader .l-sub');
  if (s) s.textContent = '出错了：' + e.message;
});
