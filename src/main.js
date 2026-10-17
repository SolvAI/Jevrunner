// Wires Jevrunner together: the run (game.js), the world (scene.js), the panel (ui.js), the sound (audio.js) and
// the decision model behind /api/decide (server/decide.js). One game session at a time.
import { Driver, Run, SPEED_MAX, V0, VMAX, ZONES } from './game.js';
import { createScene } from './scene.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // private window: settings and the best score just aren't kept
    }
  },
};

const scene = createScene($('c'));
new ResizeObserver(() => scene.resize()).observe($('c'));
scene.resize();
const ui = createUI({ modelName: { short: 'H2O' } });
const audio = createAudio();

let best = store.get('jevrunner.best', 0);
const params = new URLSearchParams(location.search);
const flag = (name, key) => params.has(name) || store.get(key, false);
const opts = {
  playing: false, paused: false, driving: true,
  net: flag('net', 'jevrunner.net'), vision: flag('vision', 'jevrunner.vision'), plan: flag('plan', 'jevrunner.plan'), ghost: flag('ghost', 'jevrunner.ghost'),
  muted: store.get('jevrunner.muted', false),
};
let run = null;
let restartTimer = null;
let slowUntil = 0; // a crash plays in slow motion for a moment
const clampSpeed = (v) => Math.max(V0, Math.min(SPEED_MAX, Math.round(Number(v)) || VMAX));
// the speed: ?speed=, else the slider's last value; a run goes at it from the first metre
let cap = clampSpeed(params.get('speed') ?? store.get('jevrunner.cap', VMAX));
if (opts.muted) audio.toggleMute();

async function decide(body) {
  const r = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `HTTP ${r.status}`);
  if (out.model) $('model-id').textContent = out.model.split('/').pop();
  return out;
}

const driver = new Driver({
  decide,
  capture: () => scene.capture(640),
  onDecision: (d) => {
    ui.decision(d, run);
    ui.speed(cap, opts.plan);
  },
  onResult: (d, outcome) => {
    ui.result(d, outcome);
    void fetch('/api/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: run.seed, row: outcome.row, ok: outcome.ok, ghost: !!outcome.ghost, kind: outcome.kind, lane: outcome.lane, move: outcome.action, decided: { lane: d.lane, action: d.action, late: d.late, net: d.net, latencyMs: d.latencyMs } }),
    }).catch(() => {});
  },
});
driver.enabled = opts.driving;
driver.safetyNet = opts.net;
driver.vision = opts.vision;
driver.planAhead = opts.plan;

const POWER_COLOR = scene.power;
function newRun() {
  clearTimeout(restartTimer);
  run = new Run(Math.floor(Math.random() * 2 ** 31), {
    onPopup: (text, kind) => {
      ui.popup(text, kind);
      if (kind === 'clean') {
        scene.burst('clean', run);
        audio.play('clean');
      } else if (kind === 'shield') {
        scene.burst('shield', run);
        audio.play('shield');
      }
    },
    onPower: (kind) => {
      scene.burst('power', run, POWER_COLOR[kind]);
      audio.play('power');
    },
    onCoin: (coin, streak) => {
      scene.burst('coin', run, coin);
      audio.play('coin', streak);
    },
    onAction: (kind) => {
      audio.play(kind);
      if (kind === 'jump') scene.burst('jump', run);
    },
    onGhost: () => {
      scene.burst('ghost', run);
      audio.play('ghost');
      ui.ghostHit(run.hits);
    },
    onRow: (r) => driver.result(r),
    onCrash: (info) => {
      best = Math.max(best, run.score);
      store.set('jevrunner.best', Math.round(best));
      scene.burst('crash', run);
      audio.play('crash');
      slowUntil = performance.now() + 900;
      ui.crashed();
      ui.crashBanner(info, run.score, opts.playing, driver.byRow.get(info.row)?.why);
      if (opts.playing) restartTimer = setTimeout(newRun, 2400);
    },
    onPlanStart: (row) => ui.planStarted(driver.byRow.get(row)),
  }, { speed: cap, ghost: opts.ghost });
  driver.reset(run);
  ui.runStarted();
  ui.nextRow(run, null);
  ui.popup('GO!', 'go');
  audio.play('go');
}
run = new Run(1, {});
ui.nextRow(run, null);

function refresh() {
  ui.buttons(opts);
  $('title').classList.toggle('hidden', opts.playing || run.t > 0);
  $('sound').textContent = opts.muted ? '🔇' : '🔊';
}

// sound needs a click or a key first (the browser's rule); the first one starts it
const wake = () => audio.start(true);
addEventListener('pointerdown', wake, { once: true });
addEventListener('keydown', wake, { once: true });

$('btn-run').onclick = () => {
  audio.start(true);
  if (opts.playing) {
    opts.playing = false;
    clearTimeout(restartTimer);
  } else {
    opts.playing = true;
    opts.paused = false;
    if (!run.alive || run.t === 0 || run.seed === 1) newRun();
  }
  refresh();
};
const toggle = (btn, name, key, apply) => {
  $(btn).onclick = () => {
    opts[name] = !opts[name];
    if (key) store.set(key, opts[name]);
    apply?.(opts[name]);
    refresh();
  };
};
toggle('btn-drive', 'driving', null, (v) => (driver.enabled = v));
toggle('btn-net', 'net', 'jevrunner.net', (v) => (driver.safetyNet = v));
toggle('btn-eyes', 'vision', 'jevrunner.vision', (v) => (driver.vision = v));
toggle('btn-plan', 'plan', 'jevrunner.plan', (v) => {
  driver.planAhead = v;
  ui.speed(cap, v);
});
toggle('btn-ghost', 'ghost', 'jevrunner.ghost', (v) => (run.ghost = v));
const mute = () => {
  audio.start(true);
  opts.muted = audio.toggleMute();
  store.set('jevrunner.muted', opts.muted);
  refresh();
};
$('sound').onclick = mute;
const slider = $('speed-cap');
slider.value = cap;
ui.speed(cap, opts.plan);
slider.oninput = () => {
  cap = clampSpeed(slider.value);
  run.setSpeed(cap); // at once, mid-run too
  store.set('jevrunner.cap', cap);
  ui.speed(cap, opts.plan);
};
$('pause').onclick = () => {
  opts.paused = !opts.paused;
};

// The keyboard drives when the model doesn't; P pauses, M mutes, F shows the frame rate.
let showFps = false;
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'p' || k === 'escape') return void (opts.paused = !opts.paused);
  if (k === 'm') return mute();
  if (k === 'f') {
    showFps = !showFps;
    $('fps').hidden = !showFps;
    return;
  }
  if (opts.driving) return;
  const move = { a: 'A', arrowleft: 'A', d: 'D', arrowright: 'D', w: 'W', arrowup: 'W', ' ': 'W', s: 'S', arrowdown: 'S' }[k];
  if (!move) return;
  e.preventDefault();
  if (e.repeat) return;
  if (!opts.playing || !run.alive) {
    opts.playing = true;
    if (!run.alive || run.seed === 1) newRun();
    refresh();
  }
  if (move === 'A') run.steer(run.lane - 1);
  if (move === 'D') run.steer(run.lane + 1);
  if (move === 'W') run.jump();
  if (move === 'S') run.slide();
  ui.humanKeys(move);
  setTimeout(() => ui.humanKeys(null), 160);
});

async function health() {
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.label && h.label !== $('model-short').textContent) {
      ui.setLabel(h.label);
      refresh();
    }
    $('health').textContent = h.remote ? `remote model · ${h.url}` : h.up ? `model up · ${h.url}` : `model DOWN at ${h.url} · start it with scripts/run.sh`;
    $('health').classList.toggle('down', !h.up);
  } catch {
    $('health').textContent = 'the game server is not answering';
    $('health').classList.add('down');
  }
}
health();
setInterval(health, 5000);

// ---- the frame loop, with an adaptive resolution that keeps it smooth ----
let lastT = performance.now();
let zoneSeen = 0;
const frameTimes = [];
let qualityAt = 0;
function frame(now) {
  const raw = (now - lastT) / 1000;
  const dt = Math.max(0, Math.min(0.05, raw)); // a frame stamp can precede lastT
  lastT = now;
  const moving = opts.playing && !opts.paused;
  if (moving) {
    run.step(dt);
    driver.update();
  }
  if (run.zone !== zoneSeen) {
    zoneSeen = run.zone;
    if (run.zone > 0) ui.zoneBanner(ZONES[run.zone % ZONES.length], run.zone + 1);
  }
  scene.setZone(run.zone);
  const slow = now < slowUntil ? 0.3 : 1;
  scene.render(run, opts.paused ? 0 : dt, now / 1000, slow);
  ui.hud(run, best);
  audio.setSpeed(run.v);

  // frame time over the last second: lower the resolution when frames run long, raise it back when there is room
  if (raw > 0 && raw < 0.25) frameTimes.push(raw * 1000);
  if (frameTimes.length > 60) frameTimes.shift();
  if (frameTimes.length === 60 && now - qualityAt > 1500) {
    const avg = frameTimes.reduce((a, b) => a + b, 0) / 60;
    if (avg > 20) scene.setPixelRatio(scene.pixelRatio - 0.15);
    else if (avg < 12.5) scene.setPixelRatio(scene.pixelRatio + 0.1);
    qualityAt = now;
    if (showFps) $('fps').textContent = `${Math.round(1000 / avg)} fps · ${avg.toFixed(1)} ms · ${scene.pixelRatio.toFixed(2)}x`;
  }
  requestAnimationFrame(frame);
}
refresh();
requestAnimationFrame(frame);
// For scripts and the console: the current run and the session's numbers.
window.__jevrunner = {
  summary: () => ({ alive: run.alive, distance: Math.round(run.s), score: Math.round(run.score), speed: run.v, coins: run.coins, hits: run.hits, crash: run.crash, stats: { ...ui.stats }, best: Math.round(best), pixelRatio: scene.pixelRatio }),
};
// ?autoplay: start a run as the page opens (the model at the wheel)
if (params.has('autoplay')) $('btn-run').click();
