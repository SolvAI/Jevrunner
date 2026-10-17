// The page around the game: the HUD over the track, and the panel on the right that shows the model's decisions
// as they happen (next row and the odds per lane, the move, a live feed, the keys it "presses", the controls).
import { ACTIONS, KEY_FOR, LABEL, LANES, LANE_NAME, LANE_X } from './world.js';
import { DECISION_WINDOW, LANE_SPEED, ZONES, ZONE_LENGTH } from './game.js';
import { ROW_SPACING, TRAIN_LENGTH } from './world.js';

/**
 * How fast the runner can go before a move no longer fits. A move has DECISION_WINDOW metres (from the row before
 * being a train's length behind to the row) for a frame and the move itself, and, without plan-ahead, the answer too.
 * Crossing into the next lane counts once the runner is past the line between lanes, so a switch takes 1.5 lane
 * widths (two lanes) or half one (one lane) at LANE_SPEED; a jump needs 0.04 s to clear a barrier. With plan-ahead the
 * answer only has to come before its move's turn: one row and a train's length, ROW_SPACING + TRAIN_LENGTH metres.
 */
export function speedLimits(latencyMs, planAhead = false) {
  const half = (LANE_X[1] - LANE_X[0]) / 2;
  const base = (planAhead ? 0 : latencyMs / 1000) + 1 / 60;
  const pipeline = planAhead ? (ROW_SPACING + TRAIN_LENGTH) / (latencyMs / 1000) : Infinity;
  const limit = (move) => Math.min(pipeline, DECISION_WINDOW / (base + move));
  return { twoLanes: limit((3 * half) / LANE_SPEED), oneLane: limit(half / LANE_SPEED), inPlace: limit(0.04), pipeline };
}

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (p) => `${Math.round(p * 100)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createUI({ modelName }) {
  const feed = [];
  const stats = { decisions: 0, latencySum: 0, maxLatency: 0, runs: 0, crashes: 0, late: 0, net: 0, ok: 0, hits: 0 };
  const recent = []; // the last 200 answer times, for the slider's p95
  let last = null;

  // ---------- HUD ----------
  function hud(run, best) {
    $('score').textContent = fmt(run.score);
    $('best').textContent = fmt(Math.max(best, run.score));
    const z = run.zone;
    $('zone').textContent = ZONES[z % ZONES.length];
    $('dist').innerHTML = `${fmt(run.s)}<small> m</small>`;
    $('zonebar').style.width = `${((run.s % ZONE_LENGTH) / ZONE_LENGTH) * 100}%`;
    $('nextzone').textContent = `NEXT · ${ZONES[(z + 1) % ZONES.length]} IN ${fmt(ZONE_LENGTH - (run.s % ZONE_LENGTH))} M`;
    $('coins').textContent = fmt(run.coins);
    $('flow').textContent = `${run.flow % 1 ? run.flow.toFixed(1) : run.flow}×`;
    $('flowbar').style.width = `${((run.flow - 1) / 4) * 100}%`;
    $('speed').textContent = `${run.v.toFixed(1)} m/s`;
    for (const k of ['shield', 'magnet', 'double']) {
      const el = $(`pw-${k}`);
      const s = run.power[k];
      el.classList.toggle('on', s > 0);
      el.querySelector('b').textContent = s > 0 ? `${Math.ceil(s)}s` : '–';
    }
  }

  function popup(text, kind) {
    const el = document.createElement('div');
    el.className = `popup ${kind}`;
    el.textContent = text;
    const box = $('popups');
    while (box.children.length >= 2) box.firstChild.remove(); // at most two at a time: readable at any speed
    box.append(el);
    setTimeout(() => el.remove(), 1100);
  }

  function crashBanner(info, score, auto, why) {
    const el = $('crash');
    if (!info) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<div class="big">CRASHED</div><div>${esc(LABEL[info.kind])} in the ${esc(LANE_NAME[LANES[info.lane]])} lane · was ${esc(info.action === 'run' ? 'running' : info.action === 'jump' ? 'jumping' : 'sliding')} at ${Math.round(info.speed)} m/s</div>${why ? `<div class="why">${esc(why)}</div>` : ''}<div class="sub">${fmt(score)} points${auto ? ' · next run in a moment' : ' · press Let it run'}</div>`;
  }

  /** The slider's readout: the window at that speed, and which moves still fit with the answers seen so far. */
  function speed(cap, planAhead = false) {
    $('speed-val').textContent = `${cap} m/s`;
    const sorted = [...recent].sort((a, b) => a - b);
    const latency = sorted.length >= 20 ? sorted[Math.ceil(0.95 * sorted.length) - 1] : 110; // p95 of the answers so far
    const lim = speedLimits(latency, planAhead);
    const windowMs = Math.round((DECISION_WINDOW / cap) * 1000);
    const verdict = cap <= lim.twoLanes
      ? `every move fits (up to ~${Math.floor(lim.twoLanes)} m/s)`
      : cap <= lim.oneLane
        ? `<span class="warn">two-lane escapes too slow above ~${Math.floor(lim.twoLanes)} m/s</span>`
        : `<span class="bad">even one-lane dodges too slow above ~${Math.floor(lim.oneLane)} m/s</span>`;
    $('speed-note').innerHTML = planAhead
      ? `${windowMs} ms to move · answers ${Math.round(latency)} ms (p95), asked a row ahead · ${verdict}`
      : `${windowMs} ms to decide and move · answers ${Math.round(latency)} ms (p95) · ${verdict}`;
  }

  // ---------- panel ----------
  function header(driving, latency) {
    $('driver').textContent = driving ? 'IS DRIVING' : 'IS WATCHING';
    $('driver-dot').classList.toggle('on', driving);
    $('lat').textContent = latency ? `${Math.round(latency)} ms` : '– ms';
  }

  function nextRow(run, d) {
    // the lane cards: what is on each lane of the row being decided, the model's odds once they are in
    const target = d ?? null;
    const row = target ? { i: target.row, lanes: target.lanes } : run.row(run.nextRow);
    const out = target ? Math.max(0, target.remaining) : (row.d - run.s) / run.v;
    $('row-title').textContent = `row ${row.i} · ${out.toFixed(1)}s out`;
    const odds = target?.odds;
    for (const [l, name] of LANES.entries()) {
      const card = $(`lane-${name}`);
      card.classList.toggle('chosen', !!target && target.lane === l);
      card.querySelector('.what').textContent = LABEL[row.lanes[l]];
      const safe = odds ? odds.safe[l] : null;
      const lp = odds ? odds.lanes[l] : null;
      card.querySelector('.fill').style.height = `${Math.round((lp ?? 0) * 100)}%`;
      card.querySelector('.pct').textContent = lp === null ? '–' : pct(lp);
      card.querySelector('.safe').textContent = safe === null ? 'passable –' : `passable ${pct(safe)}`;
      card.querySelector('.safe').classList.toggle('bad', safe !== null && safe < 0.5);
      card.querySelectorAll('.mv').forEach((m, k) => {
        const p = odds ? odds.moves[l][k] : null;
        m.querySelector('i').textContent = p === null ? '–' : pct(p);
        m.classList.toggle('pick', !!target && target.lane === l && target.action === ACTIONS[k]);
      });
    }
    const key = $('choice-key');
    if (target && target.lane !== null) {
      const moveKey = target.action === 'run' ? (target.lane < target.from ? 'A' : target.lane > target.from ? 'D' : 'W') : KEY_FOR[target.action];
      key.textContent = target.action === 'run' && target.lane === target.from ? '·' : moveKey;
      $('choice').textContent = `${LANE_NAME[LANES[target.lane]]} · ${target.action.toUpperCase()}${target.net ? ' · NET' : ''}`;
      $('choice-sub').innerHTML = `${odds ? pct(odds.lanes[target.lane]) : '–'} lane · ${odds ? pct(odds.confidence) : '–'} move<br>${Math.round(target.latencyMs)} ms`;
    } else if (target) {
      key.textContent = '!';
      $('choice').textContent = target.error ? 'NO ANSWER' : target.late ? 'TOO LATE' : 'NO MOVE';
      $('choice-sub').innerHTML = `${esc(target.error ? target.error.slice(0, 60) : target.late ? 'kept the lane' : '')}<br>${Math.round(target.latencyMs)} ms`;
    }
  }

  function keys(d) {
    for (const k of ['W', 'A', 'S', 'D']) $(`key-${k}`).classList.remove('lit');
    if (!d || d.lane === null) {
      $('key-caption').textContent = '—';
      return;
    }
    const lit = [];
    if (d.lane < d.from) lit.push('A');
    if (d.lane > d.from) lit.push('D');
    if (d.action === 'jump') lit.push('W');
    if (d.action === 'slide') lit.push('S');
    for (const k of lit) $(`key-${k}`).classList.add('lit');
    $('key-caption').textContent = lit.length ? lit.map((k) => `${k} · ${{ A: 'LEFT', D: 'RIGHT', W: 'JUMP', S: 'SLIDE' }[k]}`).join('  +  ') : 'RUN · NO KEY';
  }

  function renderFeed() {
    $('feed').innerHTML = feed
      .map((f) => {
        const mark = f.outcome === undefined ? '<span class="wait">…</span>' : f.outcome ? '<span class="ok">✓</span>' : `<span class="bad" title="${esc(f.why)}">✗</span>`;
        const move = f.lane === null ? (f.error ? 'NO ANSWER' : 'TOO LATE') : `${LANE_NAME[LANES[f.lane]]} · ${f.action.toUpperCase()}`;
        return `<div class="f${f.net ? ' net' : ''}"><span class="n">${f.row}</span><span class="sum">${esc(f.summary)}</span><span class="mv">${esc(move)}</span><span class="p">${f.odds && f.lane !== null ? pct(f.odds.lanes[f.lane]) : ''}</span><span class="ms">${Math.round(f.latencyMs)}ms</span>${mark}</div>`;
      })
      .join('');
  }

  function decision(d, run) {
    last = d;
    stats.decisions += 1;
    stats.latencySum += d.latencyMs;
    if (!d.error) {
      stats.maxLatency = Math.max(stats.maxLatency, d.latencyMs);
      recent.push(d.latencyMs);
      if (recent.length > 200) recent.shift();
    }
    if (d.late) stats.late += 1;
    if (d.net) stats.net += 1;
    feed.unshift(d);
    if (feed.length > 40) feed.pop();
    header(true, d.latencyMs);
    nextRow(run, d);
    if (d.lane === null) keys(d); // otherwise the keys light when the move starts (planStarted)
    renderFeed();
    renderStats();
    if ($('sees').classList.contains('open')) showSees();
  }

  /** How the decision for a row turned out, and if it crashed, why. */
  function result(d, outcome) {
    d.outcome = outcome.ok;
    if (outcome.ok) stats.ok += 1;
    else d.why = d.lane === null ? (d.error ? 'no answer from the model' : 'the answer came too late')
      : d.lane !== outcome.lane ? `right call, but still switching lanes (${Math.abs(d.lane - d.from)} lane${Math.abs(d.lane - d.from) === 1 ? '' : 's'}) when the row came`
      : d.action !== outcome.action ? `right call, but the ${d.action} came too late`
      : 'wrong call by the model';
    renderFeed();
  }

  function renderStats() {
    const avg = stats.decisions ? stats.latencySum / stats.decisions : 0;
    $('stats').textContent = `${fmt(stats.decisions)} decisions · avg ${Math.round(avg)} ms · ${stats.runs} run${stats.runs === 1 ? '' : 's'} · ${stats.crashes} crash${stats.crashes === 1 ? '' : 'es'}${stats.hits ? ` · ${stats.hits} ghost hit${stats.hits === 1 ? '' : 's'}` : ''}${stats.late ? ` · ${stats.late} late` : ''}${stats.net ? ` · ${stats.net} net` : ''}`;
  }

  /** "What the model sees": the requests of the last decision, exactly as sent, and its answers. */
  function showSees() {
    const box = $('sees');
    box.classList.add('open');
    const d = last;
    if (!d) {
      box.querySelector('.body').innerHTML = '<p>No decision yet.</p>';
      return;
    }
    const strip = (r) => JSON.stringify(r, (k, v) => (typeof v === 'string' && v.startsWith('data:image') ? '[the frame, shown above]' : v), 1);
    box.querySelector('.body').innerHTML = `${d.image ? `<img src="${d.image}" alt="the frame the model saw">` : ''}
      <p>Row ${d.row} · ${esc(d.summary)} · ${d.requests.length} requests in parallel · ${Math.round(d.latencyMs)} ms</p>
      ${d.requests.map((r, k) => `<h4>request ${k + 1}</h4><pre>${esc(strip(r))}</pre>`).join('')}
      <h4>answers</h4><pre>${esc(JSON.stringify(d.answers, null, 1))}</pre>`;
  }
  $('sees-btn').onclick = () => ($('sees').classList.contains('open') ? $('sees').classList.remove('open') : showSees());
  $('sees-close').onclick = () => $('sees').classList.remove('open');

  function runStarted() {
    stats.runs += 1;
    renderStats();
    crashBanner(null);
  }
  function crashed() {
    stats.crashes += 1;
    renderStats();
  }

  function buttons({ playing, driving, net, vision, plan, ghost }) {
    $('btn-run').textContent = playing ? '■ STOP' : `▶ LET ${modelName.short} RUN`;
    $('btn-run').classList.toggle('on', playing);
    $('btn-drive').textContent = `${modelName.short} DRIVING · ${driving ? 'ON' : 'OFF'}`;
    $('btn-drive').classList.toggle('on', driving);
    $('btn-net').textContent = `SAFETY NET · ${net ? 'ON' : 'OFF'}`;
    $('btn-net').classList.toggle('on', net);
    $('btn-eyes').textContent = `EYES · ${vision ? 'SCREEN' : 'STATE'}`;
    $('btn-eyes').classList.toggle('on', vision);
    $('btn-plan').textContent = `PLAN AHEAD · ${plan ? 'ON' : 'OFF'}`;
    $('btn-plan').classList.toggle('on', plan);
    $('btn-ghost').textContent = `GHOST · ${ghost ? 'ON' : 'OFF'}`;
    $('btn-ghost').classList.toggle('on', ghost);
    header(driving, last?.latencyMs);
  }

  function humanKeys(k) {
    for (const key of ['W', 'A', 'S', 'D']) $(`key-${key}`).classList.toggle('lit', key === k);
    $('key-caption').textContent = k ? `${k} · ${{ A: 'LEFT', D: 'RIGHT', W: 'JUMP', S: 'SLIDE' }[k]} (you)` : '—';
  }

  /** A hit in ghost mode: counted, flashed, and the run goes on. */
  function ghostHit() {
    stats.hits += 1;
    renderStats();
    const el = $('stage');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  /** A new zone: its name across the screen for a moment. */
  function zoneBanner(name, n) {
    const el = $('zonebanner');
    el.innerHTML = `<small>ZONE ${n}</small>${esc(name)}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** A decided move starts (at once, or with plan-ahead once its turn comes): light the keys it "presses". */
  function planStarted(d) {
    if (d) keys(d);
  }

  /** The model's name everywhere on the page (MODEL_LABEL on the server; H2O by default). */
  function setLabel(label) {
    if (!label || label === modelName.short) return;
    modelName.short = label;
    document.querySelectorAll('.ml').forEach((el) => (el.textContent = label));
  }

  return { hud, popup, crashBanner, decision, result, nextRow, runStarted, crashed, buttons, humanKeys, header, speed, planStarted, ghostHit, zoneBanner, setLabel, stats };
}
