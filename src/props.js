// Everything on the track, made of shapes: trains, barriers, arches, coins and power-up orbs. Each prop is merged into
// one mesh per material (few draw calls), and the canvas-drawn textures are made at a size that stays sharp up close.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIN_LENGTH } from './world.js';

export function canvasTexture(w, h, draw, { repeat = false, anisotropy = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft round glow, for halos (headlights, lamps, orbs) drawn as additive sprites. */
export const glowTexture = (() => {
  let t;
  return () =>
    (t ??= canvasTexture(128, 128, (g) => {
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
      r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
    }));
})();

export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

/** One mesh from many parts: [geometry, material, position, rotation?, scale?] -> merged per material. */
export function build(parts) {
  const byMat = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [geo, mat, p, r = [0, 0, 0], s = [1, 1, 1]] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); // some shapes come indexed, some not: merge them all flat
    g.applyMatrix4(m.compose(new THREE.Vector3(...p), q.setFromEuler(e.set(...r)), new THREE.Vector3(...s)));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  }
  const mats = [...byMat.keys()];
  const merged = mergeGeometries(mats.map((k) => mergeGeometries(byMat.get(k), false)), true);
  const mesh = new THREE.Mesh(merged, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createProps(renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (w, h, draw, o) => canvasTexture(w, h, draw, { anisotropy: maxAniso, ...o });

  const stripes = tex(512, 128, (g, w, h) => {
    g.fillStyle = '#f6f2ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff5a1f';
    for (let x = -h; x < w + h; x += 96) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 48, h);
      g.lineTo(x + 48 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  });
  const duck = tex(1024, 256, (g, w, h) => {
    g.fillStyle = '#0a1214';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffb347';
    g.lineWidth = 14;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#ffd27a';
    g.font = '800 132px Oxanium, Rajdhani, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('↓  DUCK  ↓', w / 2, h / 2 + 8);
  });
  const logo = tex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b2a30';
    g.font = 'italic 800 62px Oxanium, Rajdhani, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('JEVRUNNER', 12, h / 2 + 4);
  });

  const M = {
    paint: new THREE.MeshStandardMaterial({ color: '#d7e2e4', metalness: 0.55, roughness: 0.28 }),
    paintDark: new THREE.MeshStandardMaterial({ color: '#30454a', metalness: 0.6, roughness: 0.4 }),
    under: new THREE.MeshStandardMaterial({ color: '#0d1719', metalness: 0.4, roughness: 0.7 }),
    windows: new THREE.MeshStandardMaterial({ color: '#0d2a30', emissive: '#9ff7ff', emissiveIntensity: 0.8, roughness: 0.15, metalness: 0.2 }),
    windshield: new THREE.MeshPhysicalMaterial({ color: '#071418', metalness: 0.9, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 }),
    trim: new THREE.MeshStandardMaterial({ color: '#0c2a2c', emissive: '#2fe8d8', emissiveIntensity: 2.0 }),
    headlight: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fffbe8', emissiveIntensity: 2.2 }),
    logo: new THREE.MeshStandardMaterial({ map: logo, transparent: true, roughness: 0.5, depthWrite: false }),
    board: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.45, emissive: '#ff6a2b', emissiveIntensity: 0.08 }),
    steel: new THREE.MeshStandardMaterial({ color: '#566a70', metalness: 0.8, roughness: 0.32 }),
    warn: new THREE.MeshStandardMaterial({ color: '#ff9a3a', emissive: '#ff6a10', emissiveIntensity: 3 }),
    gold: new THREE.MeshStandardMaterial({ color: '#e0a83a', metalness: 0.75, roughness: 0.3, emissive: '#b8741a', emissiveIntensity: 0.25 }),
    neon: new THREE.MeshStandardMaterial({ color: '#fff1c4', emissive: '#ffc35a', emissiveIntensity: 3.2 }),
    sign: new THREE.MeshStandardMaterial({ map: duck, emissiveMap: duck, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.6 }),
    coin: new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 1, roughness: 0.22, emissive: '#ff9d00', emissiveIntensity: 0.55 }),
  };

  // ---- the train: a rounded carriage, its front facing the runner ----
  const L = TRAIN_LENGTH, W = 2.6, H = 3.0;
  const trainParts = [
    [new RoundedBoxGeometry(W, H, L, 5, 0.32), M.paint, [0, 0.55 + H / 2, -L / 2]],
    [new THREE.BoxGeometry(W - 0.5, 0.5, L - 1.2), M.under, [0, 0.35, -L / 2]],
    [new THREE.BoxGeometry(W + 0.02, 0.62, L - 1.4), M.windows, [0, 2.45, -L / 2]],
    [new THREE.BoxGeometry(W + 0.04, 0.1, L - 0.8), M.trim, [0, 1.35, -L / 2]],
    [new THREE.BoxGeometry(W + 0.03, 0.05, L - 0.8), M.trim, [0, 3.3, -L / 2]],
    [new RoundedBoxGeometry(W - 0.5, 0.95, 0.12, 3, 0.05), M.windshield, [0, 2.55, 0.02]],
    [new THREE.BoxGeometry(W - 0.4, 0.06, 0.06), M.trim, [0, 3.1, 0.05]],
    [new THREE.BoxGeometry(1.2, 0.35, 2.4), M.paintDark, [0, 3.72, -L * 0.3]],
    [new THREE.BoxGeometry(1.2, 0.35, 2.4), M.paintDark, [0, 3.72, -L * 0.72]],
    [new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18), M.headlight, [-0.85, 1.25, 0.04], [Math.PI / 2, 0, 0]],
    [new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18), M.headlight, [0.85, 1.25, 0.04], [Math.PI / 2, 0, 0]],
  ];
  for (const z of [-1.6, -L + 1.6]) {
    trainParts.push([new THREE.BoxGeometry(W - 0.3, 0.3, 1.8), M.under, [0, 0.28, z]]);
    for (const x of [-0.95, 0.95]) for (const dz of [-0.55, 0.55]) trainParts.push([new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18), M.steel, [x, 0.3, z + dz], [0, 0, Math.PI / 2]]);
  }
  for (const side of [-1, 1]) trainParts.push([new THREE.PlaneGeometry(2.4, 0.6), M.logo, [side * (W / 2 + 0.03), 1.75, -L * 0.5], [0, side * Math.PI / 2, 0]]);
  const trainProto = build(trainParts);

  // ---- the barrier: a striped board on two posts, warning lights on top ----
  const barrierProto = build([
    [new RoundedBoxGeometry(2.3, 0.56, 0.16, 2, 0.04), M.board, [0, 0.78, 0]],
    [new RoundedBoxGeometry(0.14, 1.12, 0.14, 2, 0.03), M.steel, [-1.08, 0.56, 0]],
    [new RoundedBoxGeometry(0.14, 1.12, 0.14, 2, 0.03), M.steel, [1.08, 0.56, 0]],
    [new THREE.BoxGeometry(0.5, 0.06, 0.5), M.steel, [-1.08, 0.03, 0]],
    [new THREE.BoxGeometry(0.5, 0.06, 0.5), M.steel, [1.08, 0.03, 0]],
    [new THREE.SphereGeometry(0.09, 14, 10), M.warn, [-0.75, 1.16, 0]],
    [new THREE.SphereGeometry(0.09, 14, 10), M.warn, [0.75, 1.16, 0]],
  ]);

  // ---- the arch: a gold gantry with a neon outline and the DUCK sign hanging low ----
  const archProto = build([
    [new RoundedBoxGeometry(0.22, 3.0, 0.3, 2, 0.06), M.gold, [-1.18, 1.5, 0]],
    [new RoundedBoxGeometry(0.22, 3.0, 0.3, 2, 0.06), M.gold, [1.18, 1.5, 0]],
    [new RoundedBoxGeometry(2.6, 0.26, 0.34, 2, 0.06), M.gold, [0, 2.95, 0]],
    [new THREE.BoxGeometry(0.05, 2.7, 0.05), M.neon, [-1.05, 1.5, 0.16]],
    [new THREE.BoxGeometry(0.05, 2.7, 0.05), M.neon, [1.05, 1.5, 0.16]],
    [new THREE.BoxGeometry(2.15, 0.05, 0.05), M.neon, [0, 2.8, 0.16]],
    [new THREE.BoxGeometry(0.03, 0.85, 0.03), M.steel, [-0.7, 2.35, 0]],
    [new THREE.BoxGeometry(0.03, 0.85, 0.03), M.steel, [0.7, 2.35, 0]],
    [new RoundedBoxGeometry(2.1, 0.58, 0.08, 2, 0.03), M.under, [0, 1.62, 0]],
    [new THREE.PlaneGeometry(2.0, 0.5), M.sign, [0, 1.62, 0.045]],
  ]);

  const POWER = { shield: '#3fe8d8', magnet: '#ff5fc8', double: '#ffd23f' };
  const ICON = { shield: '🛡', magnet: '🧲', double: '2×' };
  function orb(kind) {
    const g = new THREE.Group();
    const c = POWER[kind];
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 3), new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1, clearcoat: 1, transmission: 0 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 10, 48), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.4 }));
    const ring2 = ring.clone();
    ring2.rotation.x = Math.PI / 2;
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex(128, 128, (g2) => {
        g2.font = '700 84px system-ui, sans-serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillStyle = '#ffffff';
        g2.fillText(ICON[kind], 64, 70);
      }),
      depthWrite: false,
    }));
    icon.scale.setScalar(0.5);
    const halo = glowSprite(c, 2.4, 0.55);
    for (const o of [core, ring, ring2, icon, halo]) o.position.y = 1.15;
    g.add(core, ring, ring2, icon, halo);
    g.userData.spin = [ring, ring2];
    g.userData.bob = true;
    return g;
  }

  function train() {
    const g = new THREE.Group();
    g.add(trainProto.clone());
    for (const x of [-0.85, 0.85]) {
      const s = glowSprite('#fff6dc', 1.1, 0.45);
      s.position.set(x, 1.25, 0.25);
      g.add(s);
    }
    return g;
  }
  const barrier = () => {
    const g = new THREE.Group();
    g.add(barrierProto.clone());
    for (const x of [-0.75, 0.75]) {
      const s = glowSprite('#ff8a2a', 0.9, 0.7);
      s.position.set(x, 1.16, 0.05);
      g.add(s);
    }
    g.userData.blink = g.children.slice(1);
    return g;
  };
  const arch = () => {
    const g = new THREE.Group();
    g.add(archProto.clone());
    return g;
  };

  // ---- coins: one instanced mesh for all of them ----
  const coinGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0, -0.05), new THREE.Vector2(0.26, -0.05), new THREE.Vector2(0.31, -0.02), new THREE.Vector2(0.31, 0.02), new THREE.Vector2(0.26, 0.05), new THREE.Vector2(0, 0.05)],
    28,
  );
  coinGeo.rotateX(Math.PI / 2);
  const coins = new THREE.InstancedMesh(coinGeo, M.coin, 300);
  coins.frustumCulled = false;
  coins.castShadow = true;

  const makers = { train, barrier, arch, shield: () => orb('shield'), magnet: () => orb('magnet'), double: () => orb('double') };
  return { makers, coins, materials: M, power: POWER };
}
