// One run of Jevrunner: the runner's motion, the rows it meets, coins, power-ups, score, and the decision model at
// the wheel. Pure game state: scene.js draws it and ui.js shows it; nothing here touches the DOM or three.js.
import { ACTIONS, LANES, LANE_X, ROW_SPACING, TRAIN_LENGTH, bestMove, buildRequests, isSafe, makeTrack, parseDecision, rowSummary } from './world.js';

export const V0 = 15; // the slider's lowest speed, m/s
export const VMAX = 34; // the default speed
export const SPEED_MAX = 200;
export const JUMP_T = 0.62;
export const JUMP_H = 1.75;
export const SLIDE_T = 0.7;
export const LANE_SPEED = 19; // m/s sideways: a lane in about 0.14 s
/** Metres between asking about a row (the row before it a train's length behind) and reaching it. */
export const DECISION_WINDOW = ROW_SPACING - TRAIN_LENGTH;
const LEAD = { jump: 0.2, slide: 0.24 }; // seconds before a row that the move starts
const POWER_SECONDS = { shield: 20, magnet: 12, double: 12 };
export const ZONES = ['PRISM FRONTIER', 'NEON HOLLOW', 'AURORA REACH', 'EMBER DRIFT', 'VOID GARDENS'];
export const ZONE_LENGTH = 2500;

const nearestLane = (x) => LANE_X.reduce((best, lx, l) => (Math.abs(x - lx) < Math.abs(x - LANE_X[best]) ? l : best), 0);

export class Run {
  constructor(seed, events = {}, { speed = VMAX, ghost = false } = {}) {
    this.seed = seed;
    this.track = makeTrack(seed);
    this.events = events; // onPopup(text, kind), onRow(result), onCrash(info), onPower(kind), onPlanStart(row), onCoin(coin, streak), onAction(kind), onGhost(info)
    this.ghost = ghost; // a hit is counted but the run goes on
    this.hits = 0;
    this.jumpBuffer = 0; // a jump pressed just before landing, kept for a moment
    this.s = 0;
    this.v = speed; // the slider's speed, from the first metre and the moment it moves
    this.topSpeed = this.v;
    this.t = 0;
    this.lane = 1;
    this.x = 0;
    this.jumpT = -1;
    this.slideT = -1;
    this.alive = true;
    this.score = 0;
    this.coins = 0;
    this.streak = 0;
    this.flow = 1;
    this.power = { shield: 0, magnet: 0, double: 0 };
    this.nextRow = 0; // the next row the runner will cross
    this.pendingMove = null; // {row, action, at}: a jump or slide waiting for its moment
    this.plans = []; // [{row, lane, action, steerAt}]: decided moves waiting for their turn, in row order
    this.coinsByRow = new Map();
    this.cleanMoves = 0;
    this.crash = null;
  }

  row(i) {
    return this.track.row(i);
  }

  get height() {
    return this.jumpT >= 0 ? JUMP_H * Math.sin((Math.PI * this.jumpT) / JUMP_T) : 0;
  }
  get sliding() {
    return this.slideT >= 0;
  }
  get zone() {
    return Math.floor(this.s / ZONE_LENGTH);
  }
  setSpeed(v) {
    this.v = v;
    this.topSpeed = Math.max(this.topSpeed, v);
  }

  /** The coins of a row: six along its lane, around the row. */
  coinsOf(i) {
    let c = this.coinsByRow.get(i);
    if (!c) {
      const row = this.row(i);
      c = [];
      row.lanes.forEach((k, l) => {
        if (k === 'coins') for (let j = 0; j < 6; j++) c.push({ lane: l, d: row.d - 10 + j * 4, taken: false, gone: false });
      });
      this.coinsByRow.set(i, c);
    }
    return c;
  }

  // ---- controls (the model's or the keyboard's) ----
  steer(lane) {
    if (!this.alive) return;
    const next = Math.max(0, Math.min(2, lane));
    if (next !== this.lane) this.events.onAction?.('switch');
    this.lane = next;
  }
  /**
   * Jump. A planned jump (the model's) that comes while the runner is up and coming down lifts again from the same
   * height: fast runs meet barriers closer together than one jump lasts. A pressed jump (yours) in the air is kept
   * for 0.18 s and happens on landing.
   */
  jump({ relift = false } = {}) {
    if (!this.alive) return;
    if (this.jumpT >= 0) {
      if (relift && this.jumpT > JUMP_T / 2) this.jumpT = JUMP_T - this.jumpT;
      else if (!relift) this.jumpBuffer = 0.18;
      return;
    }
    this.slideT = -1;
    this.jumpT = 0;
    this.events.onAction?.('jump');
  }
  slide() {
    if (!this.alive) return;
    if (this.jumpT >= 0) this.jumpT = Math.max(this.jumpT, JUMP_T * 0.75); // drop fast, then slide
    this.slideT = 0;
    this.jumpBuffer = 0;
    this.events.onAction?.('slide');
  }
  /**
   * A move for row i: steer once the runner is at `steerAt` (now, by default; with plan-ahead, once the row before is a
   * train's length behind), and time the jump or slide so it is on when the runner gets to the row.
   */
  plan(i, lane, action, steerAt = -Infinity) {
    this.plans = this.plans.filter((p) => p.row !== i);
    this.plans.push({ row: i, lane, action, steerAt });
    this.plans.sort((a, b) => a.row - b.row);
    this.startPlans();
  }
  startPlans() {
    while (this.alive && this.plans.length && this.s >= this.plans[0].steerAt) {
      const p = this.plans.shift();
      if (p.row < this.nextRow) continue; // its row is already behind
      this.steer(p.lane);
      this.pendingMove = p.action === 'jump' || p.action === 'slide' ? { row: p.row, action: p.action, at: this.row(p.row).d - this.v * LEAD[p.action] } : null;
      this.events.onPlanStart?.(p.row);
    }
  }
  /** The lane the runner will be in after row i: its planned lane, else where it is heading now. */
  laneAfter(i, decided) {
    const p = this.plans.find((q) => q.row === i);
    return p ? p.lane : decided ?? this.lane;
  }

  step(dt) {
    if (!this.alive) return;
    this.t += dt;
    this.s += this.v * dt;
    this.startPlans();
    const target = LANE_X[this.lane];
    this.x += Math.sign(target - this.x) * Math.min(Math.abs(target - this.x), LANE_SPEED * dt);
    if (this.jumpT >= 0 && (this.jumpT += dt) >= JUMP_T) this.jumpT = -1;
    if (this.jumpBuffer > 0) {
      this.jumpBuffer -= dt;
      if (this.jumpT < 0) {
        this.jumpBuffer = 0;
        this.jump();
      }
    }
    if (this.slideT >= 0 && (this.slideT += dt) >= SLIDE_T) this.slideT = -1;
    if (this.pendingMove && this.s >= this.pendingMove.at) {
      if (this.pendingMove.action === 'jump') this.jump({ relift: true });
      else this.slide();
      this.pendingMove = null;
    }
    for (const k of Object.keys(this.power)) this.power[k] = Math.max(0, this.power[k] - dt);
    const mult = this.flow * (this.power.double > 0 ? 2 : 1);
    this.score += this.v * dt * 10 * mult;
    this.collectCoins(mult);
    while (this.alive && this.s >= this.row(this.nextRow).d) this.cross(this.nextRow++);
  }

  collectCoins(mult) {
    const here = nearestLane(this.x);
    for (let i = Math.max(0, this.nextRow - 1); i <= this.nextRow; i++) {
      const coins = this.coinsOf(i);
      for (const c of coins) {
        if (c.taken || c.gone || c.d > this.s) continue;
        if (c.lane === here || this.power.magnet > 0) {
          c.taken = true;
          this.coins += 1;
          this.streak += 1;
          this.score += 25 * mult;
          this.events.onCoin?.(c, this.streak);
        } else c.gone = true;
      }
      if (coins.length && coins.every((c) => c.gone)) {
        coins.length = 0; // a whole trail missed: the flow cools
        this.streak = Math.max(0, this.streak - 12);
      }
    }
    this.flow = Math.min(5, 1 + Math.floor(this.streak / 12) * 0.5);
  }

  /** The runner reaches row i: through it, or not. */
  cross(i) {
    const row = this.row(i);
    const lane = nearestLane(this.x);
    const kind = row.lanes[lane];
    const action = this.height > 0.35 ? 'jump' : this.sliding ? 'slide' : 'run';
    const ok = kind === 'barrier' ? action === 'jump' : kind === 'arch' ? action === 'slide' : kind !== 'train';
    if (ok) {
      if (kind === 'barrier' || kind === 'arch') {
        this.cleanMoves += 1;
        this.score += 75 * this.flow;
        this.events.onPopup?.('CLEAN MOVE +75', 'clean');
      } else if (row.lanes.includes('train')) {
        this.score += 50 * this.flow;
        this.events.onPopup?.('DODGE +50', 'dodge');
      }
      if (kind in POWER_SECONDS) {
        this.power[kind] = POWER_SECONDS[kind];
        this.events.onPopup?.(kind === 'double' ? '2X SCORE' : `${kind.toUpperCase()}!`, 'power');
        this.events.onPower?.(kind);
      }
      this.events.onRow?.({ row: i, lane, kind, action, ok: true });
      return;
    }
    if (this.power.shield > 0) {
      this.power.shield = 0;
      this.events.onPopup?.('SHIELD SAVED YOU', 'shield');
      this.events.onRow?.({ row: i, lane, kind, action, ok: true, shielded: true });
      return;
    }
    if (this.ghost) {
      // ghost mode: the hit counts (a miss in the feed, the flow resets) but the run goes on
      this.hits += 1;
      this.streak = 0;
      this.flow = 1;
      this.events.onPopup?.('GHOST · HIT', 'ghost');
      this.events.onRow?.({ row: i, lane, kind, action, ok: false, ghost: true });
      this.events.onGhost?.({ row: i, lane, kind, action, speed: this.v });
      return;
    }
    this.alive = false;
    this.crash = { row: i, lane, kind, action, speed: this.v };
    this.events.onRow?.({ row: i, lane, kind, action, ok: false });
    this.events.onCrash?.(this.crash);
  }
}

/**
 * The decision model at the wheel: one decision per row. By default it is asked about a row once the row before it is
 * a train's length behind the runner, so the answer and the move share the 22 m left (a late answer is dropped: the
 * runner keeps its lane and runs). With plan-ahead, it is asked about the next row as soon as the previous answer is
 * in, from the lane that answer chose; the move waits its turn, so the answer's time no longer eats into the 22 m.
 * With the safety net on, a move that would crash is replaced by the oracle's.
 */
export class Driver {
  constructor({ decide, capture, onDecision, onResult }) {
    this.decide = decide; // async (body) => {answers, latencyMs, model}
    this.capture = capture; // async () => data URL of the frame, for the vision mode
    this.onDecision = onDecision; // (decision) when an answer is applied (or late)
    this.onResult = onResult; // (decision, outcome) when its row is crossed
    this.enabled = true;
    this.safetyNet = false;
    this.vision = false;
    this.planAhead = false;
    this.reset(null);
  }

  reset(run) {
    this.run = run;
    this.row = 0;
    this.inFlight = false;
    this.byRow = new Map();
    this.token = (this.token ?? 0) + 1;
  }

  /** Where the move for row i may start: at once, or (plan-ahead) once the row before is a train's length behind. */
  steerAt(i) {
    return this.planAhead && i > 0 ? this.run.row(i - 1).d + TRAIN_LENGTH : -Infinity;
  }

  /** Called every frame: asks about the next row when its turn comes. */
  update() {
    const run = this.run;
    if (!run || !run.alive || !this.enabled || this.inFlight) return;
    if (this.row < run.nextRow) this.row = run.nextRow;
    if (this.planAhead) {
      if (this.row <= run.nextRow + 1) void this.ask(this.row); // at most one row past the next one
      return;
    }
    const prev = this.row > 0 ? run.row(this.row - 1) : null;
    if (prev && run.s < prev.d + TRAIN_LENGTH) return;
    void this.ask(this.row);
  }

  async ask(i) {
    const run = this.run, token = this.token;
    const row = run.row(i);
    this.inFlight = true;
    const sentAt = performance.now();
    const secondsAway = (row.d - run.s) / run.v;
    const from = this.planAhead && i > run.nextRow ? run.laneAfter(i - 1, this.byRow.get(i - 1)?.lane) : run.lane;
    const args = { row, ahead: [run.row(i + 1), run.row(i + 2)], lane: from, speed: run.v, secondsAway, metersAway: row.d - run.s };
    let requests = buildRequests(args);
    let image = null;
    if (this.vision && this.capture) {
      image = await this.capture();
      requests = visionRequests(requests, args, image);
    }
    let res = null, error = null;
    try {
      res = await this.decide({ requests, meta: { seed: run.seed, row: i, lane: from, speed: run.v, vision: this.vision, planAhead: this.planAhead } });
    } catch (e) {
      error = e.message;
    }
    if (token !== this.token) return; // a new run started meanwhile
    this.inFlight = false;
    this.row = i + 1;
    const d = res ? parseDecision(res.answers) : null;
    const remaining = (row.d - run.s) / run.v;
    const decision = {
      row: i, summary: rowSummary(row), lanes: row.lanes, from, sentAt, secondsAway, remaining, planAhead: this.planAhead,
      latencyMs: res?.latencyMs ?? Math.round(performance.now() - sentAt), model: res?.model, error, image,
      requests, answers: res?.answers ?? null, odds: d, late: false, net: false, lane: null, action: null,
    };
    this.byRow.set(i, decision);
    if (!d || remaining <= 0 || !run.alive) {
      decision.late = !error && remaining <= 0;
      if (this.safetyNet && run.alive && remaining > 0) this.apply(decision, bestMove(row, from), true);
      else this.onDecision?.(decision);
      return;
    }
    this.apply(decision, d, false);
  }

  apply(decision, move, fromNet) {
    const row = this.run.row(decision.row);
    let { lane, action } = move;
    if (this.safetyNet && !fromNet && !isSafe(row.lanes[lane], action)) {
      ({ lane, action } = bestMove(row, decision.from));
      decision.net = true;
    }
    decision.net ||= fromNet;
    decision.lane = lane;
    decision.action = action;
    this.onDecision?.(decision);
    this.run.plan(decision.row, lane, action, this.steerAt(decision.row));
  }

  /** The row was crossed: how the decision for it turned out. */
  result(outcome) {
    const d = this.byRow.get(outcome.row);
    if (d) this.onResult?.(d, outcome);
  }
}

/** The vision mode: the same questions, but the lanes are seen in the frame instead of read from the state. */
function visionRequests(requests, { lane }, image) {
  const look = 'The image is the game: the runner is the astronaut at the bottom, running away from the camera on a 3-lane track; the next row is the nearest set of things ahead of it.';
  const [laneReq, ...moveReqs] = requests;
  const laneQ = laneReq.questions.lane;
  const out = [{
    state: { screen: image, runner_lane: LANES[lane], how_to_read: look },
    questions: {
      lane: {
        ...laneQ,
        criteria: Object.fromEntries(LANES.map((name, l) => [name, laneQ.criteria[name].split(':')[0] + ': as seen in the image'])),
      },
    },
  }];
  for (const r of moveReqs) {
    const [qid, q] = Object.entries(r.questions)[0];
    const name = qid.replace('_move', '');
    out.push({
      state: { screen: image, lane: name, how_to_read: look },
      questions: { [qid]: { ...q, instructions: `Look at the next thing in the ${name} lane in the image. Which move gets the runner through it? Run on anything free, jump over a low barrier, slide under an overhead arch.` } },
    });
  }
  return out;
}

export { ACTIONS, LANES, ROW_SPACING };
