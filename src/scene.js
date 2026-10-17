// Jevrunner's world in three.js: a glowing 3-lane track over dark water, crystal clusters and floating shards, lamp
// posts and portal rings, a shader sky, the runner, the props, particles. Draws a Run (game.js) each frame and holds
// no game state. Sharpness: 4x MSAA kept through the bloom pass, anisotropic textures, an adaptive pixel ratio.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LANE_X } from './world.js';
import { SPEED_MAX, VMAX, V0, ZONE_LENGTH } from './game.js';
import { createSky } from './sky.js';
import { createRunner } from './runner.js';
import { build, canvasTexture, createProps, glowSprite } from './props.js';
import { createFx } from './fx.js';

const SEG = 40; // metres of track per recycled segment
const N_SEG = 12;
const CHUNK = 150; // metres of scenery per recycled chunk
const N_CHUNK = 4;
const VIEW = 360; // rows are drawn this far ahead
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/** One palette per zone; the world fades from one to the next over a few seconds. */
const PALETTES = [
  { top: '#03121a', mid: '#0b3a44', horizon: '#5fb7b0', fog: '#1d5a60', sun: '#ffb48a', aurora: '#3fffd0', crystalA: '#2aa3a6', crystalB: '#3b78b8', glow: '#0b4f52', rail: '#7ff6ee', water: '#04161a' },
  { top: '#0e0820', mid: '#33184a', horizon: '#c27aa6', fog: '#45285a', sun: '#ffd27a', aurora: '#ff6ad5', crystalA: '#8c4fd0', crystalB: '#c45aa8', glow: '#3b1450', rail: '#ff9ef0', water: '#0b0614' },
  { top: '#02101c', mid: '#0b3350', horizon: '#7cc9a2', fog: '#1b5260', sun: '#e8ffb4', aurora: '#7dff9a', crystalA: '#3ec9a0', crystalB: '#4a9fe2', glow: '#0d4a3e', rail: '#9cffc8', water: '#03141a' },
  { top: '#160805', mid: '#4a1c0f', horizon: '#ff9a62', fog: '#62301f', sun: '#ffe2a0', aurora: '#ff9a4a', crystalA: '#d8743a', crystalB: '#a8443a', glow: '#4a1808', rail: '#ffd08a', water: '#120604' },
  { top: '#02030a', mid: '#0a1330', horizon: '#5a70d4', fog: '#1a234e', sun: '#ff8ac0', aurora: '#8a9cff', crystalA: '#4a5fd0', crystalB: '#8a7af0', glow: '#141e5a', rail: '#a8b8ff', water: '#03040c' },
];

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1500);

  // ---- palette state: current colours, fading toward the zone's ----
  const cur = Object.fromEntries(Object.entries(PALETTES[0]).map(([k, v]) => [k, new THREE.Color(v)]));
  let target = PALETTES[0];
  const tmp = new THREE.Color();
  const white = new THREE.Color('#ffffff');

  // ---- sky, fog, and the environment map made from the sky ----
  const sky = createSky();
  scene.add(sky.mesh);
  scene.fog = new THREE.Fog(cur.fog.clone(), 70, 380);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.mesh.material));
  let envRT = null;
  function refreshEnv() {
    sky.uniforms.sunK.value = 0;
    sky.uniforms.stars.value = 0;
    const next = pmrem.fromScene(envScene, 0.02, 0.1, 200);
    sky.uniforms.sunK.value = 1;
    sky.uniforms.stars.value = 1;
    scene.environment = next.texture;
    envRT?.dispose();
    envRT = next;
  }

  // ---- lights: a key light that casts shadows around the runner, and a sky fill (the warm tones come from the sky:
  // a light from the sun's side glints off the metal rails into a bloom blob) ----
  const hemi = new THREE.HemisphereLight('#a8f0ea', '#05161a', 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#e6fbff', 1.7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 26, bottom: -26, near: 1, far: 90 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);

  // ---- materials of the world ----
  const tex = (w, h, draw, o = {}) => canvasTexture(w, h, draw, { anisotropy: maxAniso, ...o });
  const bedTex = tex(512, 512, (g, w, h) => {
    g.fillStyle = '#0c181b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 60},${200 + Math.random() * 40},${200 + Math.random() * 40},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(140,220,215,0.10)';
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 128) g.strokeRect(-2, y, w + 4, 128);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    for (const x of [86, 256, 426]) g.strokeRect(x - 1, -2, 2, h + 4);
  }, { repeat: true });
  bedTex.repeat.set(1, SEG / 8);
  const waveNormal = tex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    const height = (x, y) => Math.sin((x / w) * Math.PI * 8 + Math.sin((y / h) * Math.PI * 4) * 1.4) * 0.5 + Math.sin((y / h) * Math.PI * 10 + (x / w) * Math.PI * 2) * 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = height(x + 1, y) - height(x - 1, y);
        const dy = height(x, y + 1) - height(x, y - 1);
        const i = (y * w + x) * 4;
        img.data[i] = 128 + dx * 60;
        img.data[i + 1] = 128 + dy * 60;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
  waveNormal.colorSpace = THREE.NoColorSpace;
  waveNormal.repeat.set(80, 80);

  const M = {
    bed: new THREE.MeshStandardMaterial({ map: bedTex, roughness: 0.78, metalness: 0.15, color: '#9fb4b6' }),
    sleeper: new THREE.MeshStandardMaterial({ color: '#203a40', roughness: 0.8, metalness: 0.2 }),
    rail: new THREE.MeshStandardMaterial({ color: '#c8e8ea', metalness: 1, roughness: 0.22, emissive: cur.rail.clone(), emissiveIntensity: 0.22 }),
    wall: new THREE.MeshStandardMaterial({ color: '#13262b', metalness: 0.5, roughness: 0.5 }),
    edge: new THREE.MeshStandardMaterial({ color: '#0f2a2e', emissive: cur.rail.clone(), emissiveIntensity: 1.6 }),
    pole: new THREE.MeshStandardMaterial({ color: '#1f343a', metalness: 0.8, roughness: 0.35 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#eafffb', emissiveIntensity: 2.2 }),
    cone: new THREE.MeshBasicMaterial({ color: '#d8fffa', transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    crystalA: new THREE.MeshStandardMaterial({ color: cur.crystalA.clone(), flatShading: true, roughness: 0.16, metalness: 0.3, emissive: cur.glow.clone(), emissiveIntensity: 0.7, envMapIntensity: 1.3 }),
    crystalB: new THREE.MeshStandardMaterial({ color: cur.crystalB.clone(), flatShading: true, roughness: 0.2, metalness: 0.3, emissive: cur.glow.clone(), emissiveIntensity: 0.55, envMapIntensity: 1.3 }),
    shard: new THREE.MeshStandardMaterial({ color: '#9fd8d4', flatShading: true, roughness: 0.15, metalness: 0.3, emissive: cur.rail.clone(), emissiveIntensity: 0.3 }),
    ridge: new THREE.MeshBasicMaterial({ color: '#000000', fog: false }),
    water: new THREE.MeshStandardMaterial({ color: cur.water.clone(), metalness: 0.85, roughness: 0.3, normalMap: waveNormal, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.9 }),
    ring: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: cur.rail.clone(), emissiveIntensity: 1.3, metalness: 0.5, roughness: 0.3 }),
  };

  // ---- water ----
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.75;
  scene.add(water);

  // ---- track segments ----
  const segParts = [[new THREE.BoxGeometry(9.8, 0.4, SEG), M.bed, [0, -0.2, -SEG / 2]]];
  for (const lx of LANE_X) for (const dx of [-0.72, 0.72]) segParts.push([new THREE.BoxGeometry(0.11, 0.13, SEG), M.rail, [lx + dx, 0.065, -SEG / 2]]);
  for (const side of [-1, 1]) {
    segParts.push([new THREE.BoxGeometry(0.34, 0.75, SEG), M.wall, [side * 4.9, 0.17, -SEG / 2]]);
    segParts.push([new THREE.BoxGeometry(0.12, 0.08, SEG), M.edge, [side * 4.78, 0.58, -SEG / 2]]);
    segParts.push([new THREE.CylinderGeometry(0.07, 0.1, 7.2, 10), M.pole, [side * 5.5, 3.4, -SEG / 2]]);
    segParts.push([new THREE.BoxGeometry(1.8, 0.09, 0.09), M.pole, [side * 4.75, 7.0, -SEG / 2]]);
    segParts.push([new THREE.BoxGeometry(0.85, 0.12, 0.34), M.lamp, [side * 4.1, 6.92, -SEG / 2]]);
  }
  const segProto = build(segParts);
  segProto.castShadow = false;
  const sleeperGeo = new THREE.BoxGeometry(2.25, 0.08, 0.3);
  const coneGeo = new THREE.ConeGeometry(2.4, 6.8, 28, 1, true);
  const segments = [];
  for (let k = 0; k < N_SEG; k++) {
    const g = new THREE.Group();
    g.add(segProto.clone());
    const sleepers = new THREE.InstancedMesh(sleeperGeo, M.sleeper, 3 * 25);
    sleepers.receiveShadow = true;
    const mtx = new THREE.Matrix4();
    let n = 0;
    for (const lx of LANE_X) for (let j = 0; j < 25; j++) sleepers.setMatrixAt(n++, mtx.makeTranslation(lx, 0.0, -j * 1.6 - 0.8));
    g.add(sleepers);
    for (const side of [-1, 1]) {
      const s = glowSprite('#e8fffb', 2.0, 0.45);
      s.position.set(side * 4.1, 6.85, -SEG / 2);
      const cone = new THREE.Mesh(coneGeo, M.cone);
      cone.position.set(side * 4.1, 3.45, -SEG / 2);
      g.add(s, cone);
    }
    g.userData.k = k;
    segments.push(g);
    scene.add(g);
  }

  // ---- scenery chunks: crystal clusters in three bands, and shards floating above ----
  const crystalGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.72), new THREE.Vector2(0, 1)], 6);
  const shardGeo = new THREE.OctahedronGeometry(1, 0);
  const PER = 70, SHARDS = 14;
  const chunks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(), e4 = new THREE.Euler();
  function fillChunk(ch) {
    let a = 0, b = 0;
    for (let c = 0; c < 18; c++) {
      const side = c % 2 ? 1 : -1;
      const band = Math.random();
      const x0 = side * (band < 0.4 ? rnd(10, 19) : band < 0.8 ? rnd(19, 45) : rnd(45, 95));
      const scale = band < 0.4 ? rnd(0.5, 1.1) : band < 0.8 ? rnd(1, 2.4) : rnd(2.2, 4.5);
      const z0 = -rnd(0, CHUNK);
      const n = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n && a + b < PER; j++) {
        const h = rnd(4, 12) * scale;
        const r = h * rnd(0.12, 0.22);
        p4.set(x0 + rnd(-2, 2) * scale, -0.9, z0 + rnd(-2, 2) * scale);
        if (Math.abs(p4.x) < 8.5) p4.x = side * 8.5;
        q4.setFromEuler(e4.set(rnd(-0.35, 0.35), rnd(0, Math.PI * 2), rnd(-0.35, 0.35)));
        s4.set(r, h, r);
        const useA = Math.random() < 0.62;
        const inst = useA ? ch.a : ch.b;
        const i = useA ? a++ : b++;
        inst.setMatrixAt(i, m4.compose(p4, q4, s4));
        inst.setColorAt(i, tmp.setScalar(rnd(0.7, 1.15)));
      }
    }
    ch.a.count = a;
    ch.b.count = b;
    for (const inst of [ch.a, ch.b]) {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
    ch.shardData = Array.from({ length: SHARDS }, () => ({ x: (Math.random() < 0.5 ? -1 : 1) * rnd(10, 60), y: rnd(10, 38), z: -rnd(0, CHUNK), s: rnd(0.6, 2.2), r: rnd(0, 6), w: rnd(0.2, 0.7) }));
  }
  for (let k = 0; k < N_CHUNK; k++) {
    const g = new THREE.Group();
    const a = new THREE.InstancedMesh(crystalGeo, M.crystalA, PER);
    const b = new THREE.InstancedMesh(crystalGeo, M.crystalB, PER);
    const shards = new THREE.InstancedMesh(shardGeo, M.shard, SHARDS);
    a.setColorAt(0, tmp.setScalar(1));
    b.setColorAt(0, tmp.setScalar(1));
    g.add(a, b, shards);
    const ch = { g, a, b, shards, k };
    fillChunk(ch);
    chunks.push(ch);
    scene.add(g);
  }
  // the ridge on the horizon: big crystal silhouettes that stay ahead, hazy with distance
  const RIDGE = 46;
  const ridge = new THREE.InstancedMesh(crystalGeo, M.ridge, RIDGE);
  ridge.frustumCulled = false;
  for (let i = 0; i < RIDGE; i++) {
    const side = i % 2 ? 1 : -1;
    const h = rnd(40, 150);
    p4.set(side * rnd(30, 420), -2, -rnd(520, 700));
    q4.setFromEuler(e4.set(rnd(-0.15, 0.15), rnd(0, 6), rnd(-0.15, 0.15)));
    s4.set(h * 0.22, h, h * 0.22);
    ridge.setMatrixAt(i, m4.compose(p4, q4, s4));
  }
  scene.add(ridge);
  // portal rings over the track
  const ringGeo = new THREE.TorusGeometry(9.2, 0.22, 12, 120);
  const ringGeo2 = new THREE.TorusGeometry(8.6, 0.06, 8, 120);
  const rings = Array.from({ length: 3 }, (_, k) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(ringGeo, M.ring), new THREE.Mesh(ringGeo2, M.ring));
    g.userData.k = k;
    scene.add(g);
    return g;
  });

  // ---- the runner, the props, the effects ----
  const runner = createRunner();
  scene.add(runner.root, runner.blob);
  const props = createProps(renderer);
  scene.add(props.coins);
  const fx = createFx(scene);
  const pools = new Map();
  const live = new Map(); // "row:lane" -> object
  const seen = new Set();
  function take(kind) {
    const pool = pools.get(kind) ?? [];
    pools.set(kind, pool);
    const o = pool.pop() ?? props.makers[kind]();
    o.userData.kind = kind;
    scene.add(o);
    return o;
  }
  function give(o) {
    scene.remove(o);
    pools.get(o.userData.kind).push(o);
  }

  // ---- post-processing: MSAA scene target, bloom, tone mapping ----
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 576), 0.42, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  /** The adaptive resolution: main.js lowers it when frames run long, raises it back when there is room. */
  function setPixelRatio(r) {
    const next = Math.max(0.6, Math.min(Math.min(window.devicePixelRatio, 2), r));
    if (Math.abs(next - pixelRatio) < 0.01) return pixelRatio;
    pixelRatio = next;
    resize();
    return pixelRatio;
  }

  // ---- palettes ----
  let zoneShown = -1, envAge = 0, fading = 0;
  function setZone(z) {
    const i = ((z % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (i === zoneShown) return;
    const first = zoneShown === -1;
    zoneShown = i;
    target = PALETTES[i];
    fading = first ? 0 : 3.5;
    if (first) {
      for (const k of Object.keys(cur)) cur[k].set(target[k]);
      applyPalette();
      refreshEnv();
    }
  }
  function applyPalette() {
    const u = sky.uniforms;
    u.top.value.copy(cur.top);
    u.mid.value.copy(cur.mid);
    u.horizon.value.copy(cur.horizon);
    u.sun.value.copy(cur.sun);
    u.aurora.value.copy(cur.aurora);
    u.fogColor.value.copy(cur.fog);
    scene.fog.color.copy(cur.fog);
    M.rail.emissive.copy(cur.rail);
    M.edge.emissive.copy(cur.rail);
    M.ring.emissive.copy(cur.rail);
    M.shard.emissive.copy(cur.rail);
    M.crystalA.color.copy(cur.crystalA);
    M.crystalB.color.copy(cur.crystalB);
    M.crystalA.emissive.copy(cur.glow);
    M.crystalB.emissive.copy(cur.glow);
    M.water.color.copy(cur.water);
    M.ridge.color.copy(cur.fog).lerp(tmp.copy(cur.crystalB).multiplyScalar(0.35), 0.28);
    hemi.color.copy(cur.horizon).lerp(white, 0.5);
    fx.setTint(tmp.copy(cur.rail).lerp(white, 0.5));
  }

  // ---- effects the game asks for ----
  let shake = 0, flash = 0;
  const at = new THREE.Vector3();
  function burst(kind, run, extra) {
    at.set(run.x, run.height + 0.9, -run.s);
    if (kind === 'coin') fx.emit({ at: at.set(LANE_X[extra?.lane ?? 1], 1.0, -(extra?.d ?? run.s)), count: 10, color: '#ffd23f', speed: 2.6, sizeMin: 0.12, sizeMax: 0.32, lifeMin: 0.25, lifeMax: 0.55, gravity: 3 });
    else if (kind === 'clean') fx.emit({ at, count: 18, color: '#ffe08a', speed: 3.5, sizeMin: 0.1, sizeMax: 0.28, gravity: 2 });
    else if (kind === 'power') fx.emit({ at, count: 40, color: extra ?? '#4ff6ea', speed: 5, sizeMin: 0.15, sizeMax: 0.45, gravity: 1 });
    else if (kind === 'shield' || kind === 'ghost') {
      fx.emit({ at, count: 50, color: kind === 'shield' ? '#4ff6ea' : '#c8b8ff', speed: 6, sizeMin: 0.15, sizeMax: 0.5, gravity: 0 });
      shake = 0.35;
      flash = 0.35;
    } else if (kind === 'crash') {
      fx.emit({ at, count: 70, color: '#ffffff', speed: 7, sizeMin: 0.12, sizeMax: 0.45, gravity: 9, lifeMax: 1.2 });
      fx.emit({ at, count: 40, color: '#ff7a2f', speed: 5, sizeMin: 0.2, sizeMax: 0.6, gravity: 7, lifeMax: 1.1 });
      shake = 0.9;
      flash = 0.6;
    } else if (kind === 'jump') fx.emit({ at: at.set(run.x, 0.1, -run.s + 0.2), count: 10, color: '#9ffcff', speed: 1.6, up: 0.3, sizeMin: 0.2, sizeMax: 0.45, gravity: 1 });
  }

  let captureWanted = null;
  /** The next frame, as a small JPEG data URL: what the model sees in the vision mode. */
  function capture(width = 640) {
    return new Promise((resolve) => (captureWanted = { resolve, width }));
  }

  const camPos = new THREE.Vector3(0, 4.6, 8), camLook = new THREE.Vector3(0, 1.1, -16);
  let fov = 60, lastX = 0, prevH = 0;
  const coinM = new THREE.Matrix4(), coinQ = new THREE.Quaternion(), coinP = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), coinE = new THREE.Euler();

  /** Draw a frame. `dt` is the real frame time (0 when paused); `slow` slows the visuals (a crash). */
  function render(run, dt, t, slow = 1) {
    const vdt = dt * slow;
    const z = -run.s;
    sky.uniforms.time.value = t;
    if (fading > 0) {
      fading -= dt;
      const k = 1 - Math.exp(-dt * 1.6);
      for (const name of Object.keys(cur)) cur[name].lerp(tmp.set(target[name]), k);
      applyPalette();
      envAge += dt;
      if (envAge > 0.5 || fading <= 0) {
        envAge = 0;
        refreshEnv();
      }
    }

    // track and scenery follow the runner
    const first = Math.floor(run.s / SEG) - 1;
    for (const g of segments) g.position.z = -(first + ((((g.userData.k - first) % N_SEG) + N_SEG) % N_SEG)) * SEG;
    const firstChunk = Math.floor((run.s - 40) / CHUNK);
    for (const ch of chunks) {
      const k = firstChunk + ((((ch.k - firstChunk) % N_CHUNK) + N_CHUNK) % N_CHUNK);
      if (ch.g.userData.at !== k) {
        if (ch.g.userData.at !== undefined) fillChunk(ch);
        ch.g.userData.at = k;
      }
      ch.g.position.z = -k * CHUNK;
      ch.shardData.forEach((d, i) => {
        p4.set(d.x, d.y + Math.sin(t * d.w + d.r) * 0.8, d.z);
        q4.setFromEuler(e4.set(t * d.w * 0.6 + d.r, t * d.w + d.r, 0));
        s4.set(d.s * 0.6, d.s, d.s * 0.6);
        ch.shards.setMatrixAt(i, m4.compose(p4, q4, s4));
      });
      ch.shards.instanceMatrix.needsUpdate = true;
    }
    for (const r of rings) {
      const k = Math.floor(run.s / 300) + r.userData.k + 1;
      r.position.set(0, 1.8, -k * 300);
      r.rotation.z = t * 0.1 * (r.userData.k % 2 ? 1 : -1);
    }
    ridge.position.set(camPos.x * 0.2, 0, z);
    water.position.set(0, -0.75, z - 300);
    waveNormal.offset.set(t * 0.004, -run.s / 30 + t * 0.01);
    key.position.set(run.x - 7, 24, z + 6);
    key.target.position.set(run.x, 0, z - 12);

    // what is on the track, from just behind the runner to VIEW ahead
    seen.clear();
    let coinN = 0;
    for (let i = Math.max(0, run.nextRow - 1); run.row(i).d < run.s + VIEW; i++) {
      const row = run.row(i);
      row.lanes.forEach((kind, l) => {
        if (kind === 'clear' || kind === 'coins') return;
        const id = `${i}:${l}`;
        seen.add(id);
        let o = live.get(id);
        if (!o) live.set(id, (o = take(kind)));
        o.position.set(LANE_X[l], 0, -row.d);
        if (o.userData.spin) for (const m of o.userData.spin) m.rotation.y = t * 1.8;
        if (o.userData.bob) o.position.y = 0.15 * Math.sin(t * 3 + i);
        if (o.userData.blink) for (const s of o.userData.blink) s.material.opacity = Math.sin(t * 9 + i) > 0 ? 0.8 : 0.15;
      });
      for (const c of run.coinsOf(i)) {
        if (c.taken || coinN >= 300) continue;
        let x = LANE_X[c.lane];
        if (run.power.magnet > 0 && c.d - run.s < 18) x = THREE.MathUtils.lerp(x, run.x, 1 - Math.max(0, c.d - run.s) / 18);
        coinP.set(x, 1.0 + 0.1 * Math.sin(t * 4 + c.d), -c.d);
        coinQ.setFromEuler(coinE.set(0, t * 3.2 + c.d * 0.4, 0));
        props.coins.setMatrixAt(coinN++, coinM.compose(coinP, coinQ, one));
      }
    }
    props.coins.count = coinN;
    props.coins.instanceMatrix.needsUpdate = true;
    for (const [id, o] of live) {
      if (!seen.has(id)) {
        give(o);
        live.delete(id);
      }
    }

    // the runner, and dust or sparks under it
    runner.update(run, vdt, t);
    if (prevH > 0.05 && run.height === 0 && run.alive) fx.emit({ at: at.set(run.x, 0.1, z + 0.2), count: 14, color: '#bfeee8', speed: 2.2, up: 0.4, sizeMin: 0.2, sizeMax: 0.5, gravity: 2, lifeMax: 0.6 });
    if (run.sliding && run.alive && Math.random() < 0.8) fx.emit({ at: at.set(run.x, 0.1, z + 0.6), count: 2, color: '#ffc46a', speed: 3, up: 0.6, sizeMin: 0.06, sizeMax: 0.14, gravity: 8, lifeMax: 0.35 });
    prevH = run.height;
    fx.update(vdt, camera, run.alive ? run.v : 0, z);

    // the camera: behind and above, easing sideways, a lean into lane changes, wider when fast
    const laneVel = dt > 0 ? (run.x - lastX) / dt : 0;
    lastX = run.x;
    camPos.x = damp(camPos.x, run.x * 0.55, 9, dt);
    camPos.y = damp(camPos.y, 4.5 + run.height * 0.35, 7, dt);
    camPos.z = z + 7.8;
    camLook.set(damp(camLook.x, run.x * 0.32, 10, dt), 1.05, z - 16);
    shake = Math.max(0, shake - dt * 1.6);
    flash = Math.max(0, flash - dt * 2.5);
    const sh = shake * shake;
    camera.position.set(camPos.x + (Math.random() - 0.5) * sh, camPos.y + (Math.random() - 0.5) * sh, camPos.z);
    camera.lookAt(camLook);
    camera.rotateZ(THREE.MathUtils.clamp(-laneVel * 0.006, -0.08, 0.08));
    const speedK = Math.min(1, Math.max(0, (run.v - V0) / (VMAX - V0)));
    const over = Math.max(0, (run.v - VMAX) / (SPEED_MAX - VMAX));
    fov = damp(fov, 60 + 9 * speedK + 18 * Math.sqrt(over), 4, dt);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    renderer.toneMappingExposure = 0.9 + flash * 0.9;

    composer.render(dt);
    if (captureWanted) {
      const { resolve, width } = captureWanted;
      captureWanted = null;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = Math.round((width * canvas.height) / canvas.width);
      c.getContext('2d').drawImage(renderer.domElement, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    }
  }

  setZone(0);
  return { render, resize, setZone, setPixelRatio, capture, burst, get pixelRatio() { return pixelRatio; }, zoneLength: ZONE_LENGTH, power: props.power };
}
