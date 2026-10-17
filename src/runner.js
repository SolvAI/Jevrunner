// The runner: a little astronaut with joints (hips, knees, shoulders, elbows), animated from the run's state: a run
// cycle that quickens with speed, a tuck in the air, a slide on its back, a lean into lane changes, a tumble on a crash.
// It only draws; the game's rules (game.js) decide where it is and whether it got through.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createRunner() {
  const suit = new THREE.MeshStandardMaterial({ color: '#eef2f3', roughness: 0.42, metalness: 0.05, envMapIntensity: 0.9 });
  const suitDark = new THREE.MeshStandardMaterial({ color: '#9aa9ad', roughness: 0.5, metalness: 0.2 });
  const orange = new THREE.MeshStandardMaterial({ color: '#ff7a2f', roughness: 0.38, metalness: 0.1, emissive: '#ff5a10', emissiveIntensity: 0.12 });
  const visor = new THREE.MeshPhysicalMaterial({ color: '#0c1b22', metalness: 0.9, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, emissive: '#1a8f8a', emissiveIntensity: 0.18 });
  const glow = new THREE.MeshStandardMaterial({ color: '#bffcff', emissive: '#4ff6ea', emissiveIntensity: 2.2 });
  const thrust = new THREE.MeshBasicMaterial({ color: '#7ff9ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

  const cast = (m) => {
    m.castShadow = true;
    return m;
  };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = cast(new THREE.Mesh(geo, mat));
    m.position.set(x, y, z);
    return m;
  };
  const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);

  const root = new THREE.Group();
  const body = new THREE.Group(); // leans and banks
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);
  hips.add(mesh(new RoundedBoxGeometry(0.42, 0.22, 0.26, 3, 0.08), suitDark, 0, 0, 0));

  const torso = new THREE.Group();
  torso.position.y = 0.08;
  hips.add(torso);
  torso.add(mesh(capsule(0.25, 0.3), suit, 0, 0.3, 0));
  const chest = mesh(new RoundedBoxGeometry(0.26, 0.18, 0.06, 2, 0.03), suitDark, 0, 0.36, -0.235);
  torso.add(chest);
  for (const [dx, c] of [[-0.06, '#3fe08a'], [0, '#ffb43a'], [0.06, '#4fe0d0']]) {
    torso.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.5 }), dx, 0.38, -0.27));
  }
  const pack = mesh(new RoundedBoxGeometry(0.44, 0.5, 0.24, 3, 0.07), orange, 0, 0.32, 0.25);
  torso.add(pack);
  const nozzles = [];
  for (const dx of [-0.12, 0.12]) {
    torso.add(mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 12), suitDark, dx, 0.04, 0.3));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 12, 1, true), thrust);
    flame.rotation.x = Math.PI;
    flame.position.set(dx, -0.17, 0.3);
    torso.add(flame);
    nozzles.push(flame);
  }
  torso.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.02), glow, 0, 0.5, 0.375));

  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.27, 32, 24), suit));
  const v = mesh(new THREE.SphereGeometry(0.21, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), visor, 0, 0.02, -0.08);
  v.rotation.x = -Math.PI / 2;
  v.scale.set(1.0, 0.82, 0.92);
  head.add(v);
  head.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), suitDark, 0.16, 0.24, 0.05));
  head.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), glow, 0.16, 0.36, 0.05));

  function limb(upper, lower, rU, rL, end) {
    const top = new THREE.Group();
    top.add(mesh(capsule(rU, upper), suit, 0, -upper / 2 - rU * 0.6, 0));
    const joint = new THREE.Group();
    joint.position.y = -upper - rU * 1.1;
    top.add(joint);
    joint.add(mesh(capsule(rL, lower), suit, 0, -lower / 2 - rL * 0.6, 0));
    joint.add(end);
    return { top, joint };
  }
  const boot = () => mesh(new RoundedBoxGeometry(0.17, 0.12, 0.28, 2, 0.05), orange, 0, -0.33, -0.04);
  const glove = () => mesh(new THREE.SphereGeometry(0.075, 14, 10), suitDark, 0, -0.27, 0);
  const legs = [limb(0.24, 0.22, 0.09, 0.08, boot()), limb(0.24, 0.22, 0.09, 0.08, boot())];
  legs[0].top.position.set(-0.12, -0.06, 0);
  legs[1].top.position.set(0.12, -0.06, 0);
  hips.add(legs[0].top, legs[1].top);
  const arms = [limb(0.17, 0.15, 0.075, 0.065, glove()), limb(0.17, 0.15, 0.075, 0.065, glove())];
  arms[0].top.position.set(-0.34, 0.52, 0);
  arms[1].top.position.set(0.34, 0.52, 0);
  torso.add(arms[0].top, arms[1].top);

  // the shield: a bubble that glows at its rim
  const bubbleMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#4ff6ea') }, time: { value: 0 }, opacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float bands = 0.5 + 0.5 * sin(vP.y * 18.0 - time * 3.0);
        gl_FragColor = vec4(color * (0.25 + f * 1.8 + bands * 0.08), (0.05 + f * 0.75) * opacity);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.1, 40, 24), bubbleMat);
  bubble.position.y = 0.95;
  root.add(bubble);

  // a soft contact shadow under the runner, that shrinks as it rises
  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;

  let phase = 0, lastX = 0, lean = 0, crashT = 0, slideK = 0, airK = 0, land = 0, wasAir = false;

  /** Pose the runner for this frame. `s` is the run (game.js); `dt` already slowed down in a crash. */
  function update(s, dt, t) {
    const vx = dt > 0 ? (s.x - lastX) / dt : 0;
    lastX = s.x;
    root.position.set(s.x, s.height, -s.s);
    blob.position.set(s.x, 0.03, -s.s);
    const k = 1 / (1 + s.height * 0.8);
    blob.scale.setScalar(k);
    blob.material.opacity = k;

    const air = s.height > 0.02;
    const sliding = s.sliding;
    if (wasAir && !air) land = 1; // landing squash
    wasAir = air;
    land = Math.max(0, land - dt * 5);
    airK = damp(airK, air ? 1 : 0, 14, dt);
    slideK = damp(slideK, sliding ? 1 : 0, 16, dt);
    lean = damp(lean, THREE.MathUtils.clamp(-vx * 0.045, -0.45, 0.45), 12, dt);

    if (s.alive) {
      crashT = 0;
      root.rotation.set(0, 0, 0);
      const cadence = 9 + Math.min(s.v, 60) * 0.22;
      phase += dt * cadence;
      const run = 1 - Math.max(airK, slideK);
      const sw = Math.sin(phase);
      // legs: swing, and bend the knee as the leg comes back
      for (const [i, leg] of legs.entries()) {
        const p = i ? -sw : sw;
        const kneeRun = -(0.25 + Math.max(0, Math.sin(phase + (i ? Math.PI : 0) - 0.6)) * 1.25);
        leg.top.rotation.x = p * 0.85 * run + 1.2 * airK * (i ? 0.85 : 1) + 1.45 * slideK * (i ? 0.6 : 1);
        leg.joint.rotation.x = kneeRun * run - 1.7 * airK - 0.2 * slideK;
      }
      for (const [i, arm] of arms.entries()) {
        const p = i ? sw : -sw;
        arm.top.rotation.x = p * 0.75 * run - 0.6 * airK + 0.5 * slideK;
        arm.top.rotation.z = (i ? -1 : 1) * (0.12 + 0.9 * airK + 0.5 * slideK);
        arm.joint.rotation.x = -(0.9 * run + 0.4 * airK + 0.2 * slideK);
      }
      hips.position.y = 0.92 + Math.abs(Math.cos(phase)) * 0.06 * run - 0.42 * slideK - 0.12 * land;
      torso.rotation.x = -0.16 * run - 0.25 * airK + 0.0 * slideK;
      torso.rotation.y = sw * 0.12 * run;
      head.rotation.x = 0.1 * run + 0.35 * slideK;
      body.rotation.x = 1.05 * slideK; // on its back, feet first
      body.position.z = 0.25 * slideK;
      body.rotation.z = lean;
      body.scale.set(1 + 0.08 * land, 1 - 0.1 * land, 1 + 0.08 * land);
    } else {
      // the tumble
      crashT += dt;
      root.rotation.x = Math.min(1.5, crashT * 4.5);
      root.rotation.z = Math.sin(crashT * 9) * 0.25 * Math.exp(-crashT * 2);
      root.position.y = Math.max(0, Math.sin(Math.min(crashT * 4, Math.PI)) * 0.9);
      root.position.z += Math.min(crashT, 0.4) * 2.5;
    }
    const thrustOn = s.alive ? airK : 0;
    for (const n of nozzles) {
      n.visible = thrustOn > 0.05;
      n.scale.set(1, 0.6 + thrustOn * (0.8 + 0.3 * Math.sin(t * 40)), 1);
    }
    bubble.visible = s.power.shield > 0;
    bubbleMat.uniforms.time.value = t;
    bubbleMat.uniforms.opacity.value = s.power.shield < 3 ? 0.5 + 0.5 * Math.sin(t * 14) : 1; // blinks before it ends
  }

  return { root, blob, update, get landing() { return land; } };
}
