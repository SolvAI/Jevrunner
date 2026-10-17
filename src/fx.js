// Particles and speed: sparkles when coins are taken, dust when the runner lands or slides, debris in a crash,
// floating motes in the air, and streaks rushing past when the run is fast. Purely visual.
import * as THREE from 'three';
import { glowTexture } from './props.js';

const MAX = 1600;

export function createFx(scene) {
  // ---- burst particles: one Points object, updated on the CPU ----
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const grav = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float size; attribute float alpha; attribute vec3 color;
      varying vec3 vColor; varying float vAlpha;
      uniform float scale;
      void main() {
        vColor = color; vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  const c = new THREE.Color();

  function emit({ at, count = 12, color = '#ffffff', speed = 3, up = 1, spread = 1, sizeMin = 0.15, sizeMax = 0.4, lifeMin = 0.35, lifeMax = 0.8, gravity = 6, carry = 0 }) {
    c.set(color);
    for (let k = 0; k < count; k++) {
      const i = next;
      next = (next + 1) % MAX;
      pos[i * 3] = at.x + (Math.random() - 0.5) * 0.3 * spread;
      pos[i * 3 + 1] = at.y + Math.random() * 0.2;
      pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.3 * spread;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      vel[i * 3] = Math.cos(a) * s * spread;
      vel[i * 3 + 1] = up * s * (0.5 + Math.random() * 0.8);
      vel[i * 3 + 2] = Math.sin(a) * s * spread - carry;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
      maxLife[i] = life[i] = lifeMin + Math.random() * (lifeMax - lifeMin);
      grav[i] = gravity;
    }
  }

  // ---- motes: specks floating over the track, recycled around the camera ----
  const MOTES = 220;
  const mPos = new Float32Array(MOTES * 3);
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
  const mMat = new THREE.PointsMaterial({ map: glowTexture(), color: '#bff8f2', size: 0.28, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(mGeo, mMat);
  motes.frustumCulled = false;
  scene.add(motes);
  for (let i = 0; i < MOTES; i++) {
    mPos[i * 3] = (Math.random() - 0.5) * 40;
    mPos[i * 3 + 1] = Math.random() * 9;
    mPos[i * 3 + 2] = -Math.random() * 160;
  }

  // ---- speed streaks: thin bright lines past the camera, shown above ~45 m/s ----
  const STREAKS = 90;
  const sGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  const sMat = new THREE.MeshBasicMaterial({ color: '#d8fffb', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const streaks = new THREE.InstancedMesh(sGeo, sMat, STREAKS);
  streaks.frustumCulled = false;
  scene.add(streaks);
  const sx = new Float32Array(STREAKS), sy = new Float32Array(STREAKS), sz = new Float32Array(STREAKS);
  for (let i = 0; i < STREAKS; i++) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 10;
    sx[i] = Math.cos(a) * r;
    sy[i] = 2 + Math.abs(Math.sin(a)) * r * 0.7;
    sz[i] = -Math.random() * 120;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3();

  function update(dt, camera, speed, runZ) {
    // bursts
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      vel[i * 3 + 1] -= grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + vel[i * 3 + 1] * dt);
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const k = life[i] / maxLife[i];
      alpha[i] = Math.min(1, k * 1.6);
    }
    for (const name of ['position', 'alpha']) geo.attributes[name].needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    mat.uniforms.scale.value = window.innerHeight * 0.6;

    // motes stay around the runner
    for (let i = 0; i < MOTES; i++) {
      if (mPos[i * 3 + 2] > runZ + 12 || mPos[i * 3 + 2] < runZ - 200) {
        mPos[i * 3 + 2] = runZ - 10 - Math.random() * 160;
        mPos[i * 3] = (Math.random() - 0.5) * 40;
        mPos[i * 3 + 1] = Math.random() * 9;
      }
      mPos[i * 3 + 1] += Math.sin(i + performance.now() * 0.0005) * 0.002;
    }
    mGeo.attributes.position.needsUpdate = true;

    // streaks
    const k = THREE.MathUtils.clamp((speed - 45) / 60, 0, 1);
    sMat.opacity = 0.55 * k;
    streaks.visible = k > 0;
    if (k > 0) {
      const len = 2 + speed * 0.06;
      for (let i = 0; i < STREAKS; i++) {
        sz[i] += speed * 1.6 * dt;
        if (sz[i] > 8) sz[i] -= 128;
        p3.set(camera.position.x + sx[i], sy[i], camera.position.z + sz[i]);
        s3.set(1, 1, len);
        streaks.setMatrixAt(i, m4.compose(p3, q, s3));
      }
      streaks.instanceMatrix.needsUpdate = true;
    }
  }

  function setTint(color) {
    mMat.color.set(color);
  }

  return { emit, update, setTint };
}
