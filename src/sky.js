// The sky: a dome drawn by a shader (gradient, stars, slow aurora bands, the sun with its halo), with colours that
// blend from one zone's palette to the next. It also lights the scene: it is rendered into the environment map that
// gives metal and glass their reflections.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform vec3 sun;
  uniform vec3 aurora;
  uniform vec3 sunDir;
  uniform vec3 fogColor;
  uniform float time;
  uniform float stars;
  uniform float sunK; // 0 while the sky is drawn into the environment map: no sun glinting off every surface
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
    col = mix(col, top, smoothstep(0.18, 0.75, h));
    col = mix(horizon * 0.55, col, smoothstep(-0.08, 0.02, h));

    // aurora: two soft moving bands above the horizon
    float a1 = sin(d.x * 5.0 + time * 0.12 + sin(d.z * 3.0 + time * 0.07) * 1.8) * 0.5 + 0.5;
    float a2 = sin(d.x * 9.0 - time * 0.09 + d.z * 2.0) * 0.5 + 0.5;
    float band = smoothstep(0.12, 0.3, h) * (1.0 - smoothstep(0.3, 0.62, h));
    col += aurora * (a1 * 0.7 + a2 * 0.3) * band * 0.28;

    // stars, twinkling, only high up
    vec3 cell = floor(d * 420.0);
    float s = hash(cell);
    float star = step(0.9972, s) * smoothstep(0.12, 0.45, h) * (0.55 + 0.45 * sin(time * 2.3 + s * 80.0));
    col += vec3(star) * stars;

    // the sun: a soft halo, a tight glow, and the disc
    float sd = max(dot(d, normalize(sunDir)), 0.0);
    col += sun * (pow(sd, 48.0) * 0.16 + pow(sd, 400.0) * 0.45) * sunK;
    col = mix(col, sun * 1.1, smoothstep(0.9986, 0.9991, sd) * sunK);

    // the haze at the horizon is the fog, so far things fade into the sky
    col = mix(fogColor, col, smoothstep(-0.01, 0.14, h));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createSky() {
  const uniforms = {
    top: { value: new THREE.Color() },
    mid: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sun: { value: new THREE.Color() },
    aurora: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0.16, 0.09, -1).normalize() },
    fogColor: { value: new THREE.Color() },
    time: { value: 0 },
    stars: { value: 1 },
    sunK: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}
