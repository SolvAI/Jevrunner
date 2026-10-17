// Headless check of the decision model on Jevrunner's rows, without the game: for each row, the request the game
// would send, the model's move, and whether it gets through. Prints accuracy and latency.
//   node scripts/sim.mjs [rows=200] [seed=1] [url=http://127.0.0.1:8741/v1/systemone]
import { ACTIONS, LABEL, LANES, bestMove, buildRequests, isSafe, makeTrack, parseDecision } from '../src/world.js';

const rows = Number(process.argv[2] ?? 200);
const seed = Number(process.argv[3] ?? 1);
const url = process.argv[4] ?? 'http://127.0.0.1:8741/v1/systemone';
const track = makeTrack(seed);
let lane = 1, ok = 0, laneSafe = 0, moveRight = 0, bestLane = 0;
const lat = [];
const misses = [];
for (let i = 2; i < rows + 2; i++) {
  const row = track.row(i);
  const reqs = buildRequests({ row, ahead: [track.row(i + 1), track.row(i + 2)], lane, speed: 22, secondsAway: 0.9, metersAway: 20 });
  const t0 = performance.now();
  const outs = await Promise.all(reqs.map(async (req) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })).json()));
  const out = { answers: Object.assign({}, ...outs.map((o) => o.answers)) };
  lat.push(performance.now() - t0);
  const d = parseDecision(out.answers);
  if (!d) throw new Error(`no decision: ${JSON.stringify(out).slice(0, 300)}`);
  const kind = row.lanes[d.lane];
  const safe = isSafe(kind, d.action);
  ok += safe;
  laneSafe += kind !== 'train';
  if (kind !== 'train') moveRight += isSafe(kind, d.action);
  bestLane += d.lane === bestMove(row, lane).lane;
  if (!safe) misses.push(`row ${i} from ${LANES[lane]}: ${row.lanes.map((k) => LABEL[k]).join(' | ')} -> ${LANES[d.lane]} ${d.action} (lane ${d.lanes.map((p) => p.toFixed(2))}, move ${d.moves[d.lane].map((p, k) => `${ACTIONS[k]} ${p.toFixed(2)}`).join(' ')})`);
  lane = safe ? d.lane : 1;
}
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)].toFixed(0);
console.log(`${rows} rows (seed ${seed}): gets through ${ok}/${rows} (${((ok / rows) * 100).toFixed(1)}%), safe lane ${laneSafe}/${rows}, right move in a safe lane ${moveRight}/${laneSafe}, oracle's lane ${bestLane}/${rows}`);
console.log(`latency p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${lat.at(-1).toFixed(0)} ms`);
for (const m of misses.slice(0, 15)) console.log('  miss:', m);
