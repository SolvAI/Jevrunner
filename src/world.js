// Jevrunner's rules, shared by the browser game, the headless simulator (scripts/sim.mjs) and the tests.
// No three.js here: the track is a list of rows, each with one thing per lane, and a move either gets through or not.

export const LANES = ['left', 'mid', 'right'];
export const LANE_NAME = { left: 'LEFT', mid: 'MIDDLE', right: 'RIGHT' };
export const LANE_X = [-2.7, 0, 2.7];
export const ACTIONS = ['jump', 'run', 'slide'];
export const KEY_FOR = { left: 'A', right: 'D', jump: 'W', slide: 'S', run: '' };

/** Metres between rows, where the first row sits, and how far a train runs past its row. */
export const ROW_SPACING = 34;
export const FIRST_ROW = 70;
export const TRAIN_LENGTH = 12;

export const KINDS = ['clear', 'coins', 'barrier', 'arch', 'train', 'shield', 'magnet', 'double'];
export const POWERUPS = ['shield', 'magnet', 'double'];
export const OBSTACLES = ['barrier', 'arch', 'train'];

/** Short labels for the panel's lane cards and the live feed. */
export const LABEL = { clear: 'CLEAR', coins: 'COINS', barrier: 'BARRIER', arch: 'ARCH', train: 'TRAIN', shield: 'SHIELD', magnet: 'MAGNET', double: '2X' };

/** What the model reads about each thing on a lane: what it is, and what it means for the runner. */
export const DESCRIBE = {
  clear: 'free: nothing on it',
  coins: 'free, with coins to collect',
  barrier: 'a low barrier: passable only by jumping',
  arch: 'an overhead arch: passable only by sliding',
  train: 'a train: BLOCKED, entering it crashes',
  shield: 'free, with a shield power-up (absorbs one crash)',
  magnet: 'free, with a magnet power-up (pulls in coins)',
  double: 'free, with a 2x power-up (double points)',
};

/** The moves that get through each thing. Run is the natural move wherever nothing is in the way. */
export function safeActions(kind) {
  if (kind === 'barrier') return ['jump'];
  if (kind === 'arch') return ['slide'];
  if (kind === 'train') return [];
  return ['run', 'jump', 'slide'];
}

export const isSafe = (kind, action) => safeActions(kind).includes(action);

/** Deterministic random numbers (mulberry32), so a run's track can be replayed from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, weights) => {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (const [k, w] of Object.entries(weights)) if ((x -= w) < 0) return k;
  return Object.keys(weights).at(-1);
};

/** Row i of a track: harder as it goes, never three trains (every row has a way through). */
export function generateRow(i, r) {
  const lanes = ['clear', 'clear', 'clear'];
  if (i < 2) {
    lanes[1] = 'coins';
    return { i, d: FIRST_ROW + i * ROW_SPACING, lanes };
  }
  const hard = Math.min(1, i / 160);
  const n = Number(pick(r, { 0: 0.12 * (1 - hard), 1: 0.5 - 0.2 * hard, 2: 0.3 + 0.1 * hard, 3: 0.08 + 0.22 * hard }));
  const order = [0, 1, 2].sort(() => r() - 0.5);
  let trains = 0;
  for (let k = 0; k < n; k++) {
    let kind = pick(r, { barrier: 0.34, arch: 0.3, train: 0.36 });
    if (kind === 'train' && (trains >= 2 || (n === 3 && trains >= 2))) kind = r() < 0.5 ? 'barrier' : 'arch';
    if (kind === 'train') trains += 1;
    lanes[order[k]] = kind;
  }
  const free = [0, 1, 2].filter((l) => lanes[l] === 'clear');
  if (free.length) {
    if (r() < 0.07) lanes[free[Math.floor(r() * free.length)]] = POWERUPS[Math.floor(r() * POWERUPS.length)];
    else if (r() < 0.6) lanes[free[Math.floor(r() * free.length)]] = 'coins';
  }
  return { i, d: FIRST_ROW + i * ROW_SPACING, lanes };
}

/** A track: rows generated on demand from one seed. */
export function makeTrack(seed) {
  const r = rng(seed);
  const rows = [];
  return {
    seed,
    row(i) {
      while (rows.length <= i) rows.push(generateRow(rows.length, r));
      return rows[i];
    },
  };
}

const VALUE = { shield: 4, magnet: 3.5, double: 3.5, coins: 3, clear: 2, barrier: 1, arch: 1, train: -100 };

/** The best move for a row from a lane: a safe lane (power-ups, coins, then free), with as few switches as possible. */
export function bestMove(row, fromLane) {
  let best = null;
  for (let l = 0; l < 3; l++) {
    const kind = row.lanes[l];
    const score = VALUE[kind] - 0.4 * Math.abs(l - fromLane);
    if (!best || score > best.score) best = { lane: l, action: safeActions(kind)[0] ?? 'run', score };
  }
  return { lane: best.lane, action: best.action };
}

const r1 = (x) => Math.round(x * 10) / 10;
const switches = (from, to) => (from === to ? 'stay in it' : Math.abs(from - to) === 1 ? '1 lane switch' : '2 lane switches');

/** "ARCH M + TRAIN R", or "CLEAR": a row at a glance, for the live feed. */
export function rowSummary(row) {
  const parts = row.lanes.map((k, l) => (k === 'clear' ? null : `${LABEL[k]} ${'LMR'[l]}`)).filter(Boolean);
  return parts.length ? parts.join(' + ') : 'CLEAR';
}

/**
 * The System One requests for the next row: one lane question over the whole state, and per lane a move question
 * and a passable-or-not question that see only that lane's row (with the whole track in view, the model drifts to "run"; alone, it never misses).
 * `ahead` are the rows after it (context only: every lane can be reached between two rows). Sent in parallel.
 */
export function buildRequests({ row, ahead = [], lane, speed, secondsAway, metersAway }) {
  const laneRow = (r) => Object.fromEntries(LANES.map((name, l) => [name, r.lanes[l]]));
  const state = {
    runner: { lane: LANES[lane], speed_mps: r1(speed) },
    next_row: { row: row.i, seconds_away: r1(secondsAway), meters_away: Math.round(metersAway), ...laneRow(row) },
    rows_after: ahead.map((r) => ({ row: r.i, ...laneRow(r) })),
  };
  const requests = [{
    state,
    questions: {
      lane: {
        type: 'choice',
        instructions:
          `Pick the lane for the runner at row ${row.i}, ${r1(secondsAway)} s ahead; it is now in the ${LANES[lane]} lane. ` +
          'Never pick a BLOCKED lane. Best is a power-up, then coins, then a free lane, then a lane passable by jumping or ' +
          'sliding. With equal lanes, fewer lane switches is better.',
        criteria: Object.fromEntries(LANES.map((name, l) => [name, `${LANE_NAME[name][0] + LANE_NAME[name].slice(1).toLowerCase()} lane, ${switches(lane, l)}: ${DESCRIBE[row.lanes[l]]}`])),
      },
    },
  }];
  for (const [l, name] of LANES.entries()) {
    requests.push({
      state: { lane: name, row: row.i, in_lane: DESCRIBE[row.lanes[l]] },
      questions: {
        [`${name}_move`]: {
          type: 'choice',
          instructions: `In the ${name} lane, row ${row.i} has ${DESCRIBE[row.lanes[l]]}. Which move gets the runner through it?`,
          criteria: {
            jump: 'Jump: gets over a low barrier',
            run: 'Run: gets through a free lane, coins or a power-up',
            slide: 'Slide: gets under an overhead arch',
          },
        },
        [`${name}_safe`]: {
          type: 'noul',
          instructions: `The runner can get through row ${row.i} in the ${name} lane (with the right move).`,
          criteria: { true: 'Passable: free, or a barrier or arch with the right move', false: 'Blocked: a train is in it' },
        },
      },
    });
  }
  return requests;
}

/**
 * The model's odds back into a move: the lane with the best lane odds times its chance of being passable, then that
 * lane's likeliest move. `lanes` are the lane question's odds, `safe` each lane's P(passable), `moves` each lane's odds.
 */
export function parseDecision(answers) {
  const laneP = answers?.lane?.probabilities;
  if (!laneP || typeof laneP !== 'object') return null;
  const lanes = LANES.map((name) => Number(laneP[name] ?? 0));
  const safe = LANES.map((name) => {
    const p = answers?.[`${name}_safe`]?.noul;
    return typeof p === 'number' ? p : 1;
  });
  const moves = LANES.map((name) => {
    const p = answers?.[`${name}_move`]?.probabilities ?? {};
    return ACTIONS.map((a) => Number(p[a] ?? 0));
  });
  const value = lanes.map((p, l) => p * safe[l]);
  const lane = value.indexOf(Math.max(...value));
  const m = moves[lane];
  const action = ACTIONS[m.indexOf(Math.max(...m))];
  return { lane, action, lanes, safe, moves, confidence: m[ACTIONS.indexOf(action)] };
}
