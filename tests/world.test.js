import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, LANES, bestMove, buildRequests, isSafe, makeTrack, parseDecision, rowSummary, safeActions } from '../src/world.js';

test('every row has a way through, and the track is the same for the same seed', () => {
  const a = makeTrack(7), b = makeTrack(7);
  for (let i = 0; i < 3000; i++) {
    const row = a.row(i);
    assert.deepEqual(row, b.row(i));
    assert.ok(row.lanes.some((k) => k !== 'train'), `row ${i} is three trains`);
    assert.equal(row.d, 70 + i * 34);
  }
});

test('the moves that get through each thing', () => {
  assert.deepEqual(safeActions('barrier'), ['jump']);
  assert.deepEqual(safeActions('arch'), ['slide']);
  assert.deepEqual(safeActions('train'), []);
  assert.equal(safeActions('coins')[0], 'run');
  assert.ok(!isSafe('barrier', 'slide') && !isSafe('arch', 'jump') && !isSafe('train', 'run'));
});

test('the oracle never crashes and prefers fewer switches', () => {
  const t = makeTrack(42);
  let lane = 1;
  for (let i = 0; i < 3000; i++) {
    const row = t.row(i);
    const m = bestMove(row, lane);
    assert.ok(isSafe(row.lanes[m.lane], m.action), `row ${i}: ${row.lanes} -> ${m.lane}/${m.action}`);
    lane = m.lane;
  }
  assert.equal(bestMove({ lanes: ['clear', 'clear', 'clear'] }, 2).lane, 2);
  assert.equal(bestMove({ lanes: ['coins', 'train', 'clear'] }, 1).lane, 0);
});

test('one lane question over the whole state, one move question per lane over its own row', () => {
  const t = makeTrack(1);
  const reqs = buildRequests({ row: t.row(5), ahead: [t.row(6), t.row(7)], lane: 1, speed: 20.04, secondsAway: 0.93, metersAway: 18.6 });
  assert.deepEqual(reqs.map((r) => Object.keys(r.questions)[0]), ['lane', 'left_move', 'mid_move', 'right_move']);
  const [lane, , mid] = reqs;
  assert.deepEqual(Object.keys(lane.questions.lane.criteria), LANES);
  assert.deepEqual(Object.keys(mid.questions.mid_move.criteria), ACTIONS);
  assert.equal(lane.state.runner.lane, 'mid');
  assert.equal(lane.state.next_row.row, 5);
  assert.equal(lane.state.rows_after.length, 2);
  assert.deepEqual(Object.keys(mid.state), ['lane', 'row', 'in_lane']);
  assert.deepEqual(Object.keys(mid.questions), ['mid_move', 'mid_safe']);
  assert.equal(mid.questions.mid_safe.type, 'noul');
  assert.match(lane.questions.lane.criteria.left, /^Left lane, 1 lane switch: /);
});

test('the odds come back as a move', () => {
  const d = parseDecision({
    lane: { probabilities: { left: 0.1, mid: 0.7, right: 0.2 } },
    left_move: { probabilities: { jump: 0.2, run: 0.7, slide: 0.1 } },
    mid_move: { probabilities: { jump: 0.05, run: 0.05, slide: 0.9 } },
    right_move: { probabilities: { jump: 0.9, run: 0.05, slide: 0.05 } },
  });
  assert.equal(d.lane, 1);
  assert.equal(d.action, 'slide');
  assert.ok(Math.abs(d.confidence - 0.9) < 1e-9);
  // a lane the model thinks is blocked loses to a passable one, even with better lane odds
  const blocked = parseDecision({
    lane: { probabilities: { left: 0.2, mid: 0.6, right: 0.2 } },
    left_safe: { noul: 0.9 }, mid_safe: { noul: 0.1 }, right_safe: { noul: 0.85 },
  });
  assert.equal(blocked.lane, 0);
  assert.equal(parseDecision({}), null);
  assert.equal(rowSummary({ lanes: ['train', 'clear', 'arch'] }), 'TRAIN L + ARCH R');
  assert.equal(rowSummary({ lanes: ['clear', 'clear', 'clear'] }), 'CLEAR');
});
