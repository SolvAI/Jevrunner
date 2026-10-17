import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Driver, Run } from '../src/game.js';
import { TRAIN_LENGTH } from '../src/world.js';

const answer = (lane, action = 'run') => ({
  lane: { probabilities: { left: lane === 'left' ? 0.9 : 0.05, mid: lane === 'mid' ? 0.9 : 0.05, right: lane === 'right' ? 0.9 : 0.05 } },
  ...Object.fromEntries(['left', 'mid', 'right'].map((l) => [`${l}_move`, { probabilities: { jump: action === 'jump' ? 0.9 : 0.05, run: action === 'run' ? 0.9 : 0.05, slide: action === 'slide' ? 0.9 : 0.05 } }])),
});

test('a planned move waits for its turn, and one for a row already behind is dropped', () => {
  const run = new Run(3, {}, { speed: 20 });
  const started = [];
  run.events.onPlanStart = (i) => started.push(i);
  const steerAt = run.row(0).d + TRAIN_LENGTH;
  run.plan(1, 2, 'jump', steerAt);
  assert.equal(run.lane, 1, 'not before its turn');
  while (run.s < steerAt) run.step(1 / 60);
  assert.equal(run.lane, 2);
  assert.deepEqual(started, [1]);
  assert.equal(run.pendingMove.action, 'jump');
  run.plan(0, 0, 'run'); // row 0 is behind the runner now
  assert.equal(run.lane, 2);
});

test('the speed is the one set, from the start and the moment it changes', () => {
  const run = new Run(3, {}, { speed: 80 });
  run.step(0.5);
  assert.equal(run.v, 80);
  run.setSpeed(150);
  assert.equal(run.v, 150);
  assert.equal(run.topSpeed, 150);
});

test('plan-ahead asks about the next row before the runner is past this one, from the lane it chose', async () => {
  const run = new Run(3, {}, { speed: 30 });
  const asked = [];
  const driver = new Driver({
    decide: async ({ meta }) => {
      asked.push(meta);
      return { answers: answer(meta.row === 0 ? 'right' : 'left'), latencyMs: 5 };
    },
  });
  driver.planAhead = true;
  driver.reset(run);
  driver.update();
  await new Promise((r) => setTimeout(r, 0));
  driver.update();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked.map((m) => m.row), [0, 1]);
  assert.equal(asked[1].lane, 2, 'row 1 is asked from the lane chosen for row 0');
  assert.equal(run.s, 0, 'both asked before the runner moved');
  assert.equal(run.lane, 2, 'row 0 steers at once');
  driver.update();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked.length, 2, 'no further than one row past the next');
  while (run.s < run.row(0).d + TRAIN_LENGTH) run.step(1 / 60);
  assert.equal(run.lane, 0, "row 1's move starts once row 0 is a train's length behind");
});

test('two barriers closer together than one jump: the second jump lifts again mid-air', () => {
  const run = new Run(3, {}, { speed: 100 });
  run.jump();
  for (let k = 0; k < 25; k++) run.step(1 / 60); // ~0.42 s: past the top, coming down
  const h = run.height;
  assert.ok(run.jumpT > 0.31 && h > 0.35);
  run.jump({ relift: true }); // the model's planned jump
  assert.ok(Math.abs(run.height - h) < 1e-9, 'same height, no jolt');
  for (let k = 0; k < 15; k++) run.step(1 / 60); // 0.25 s later the first jump would have landed
  assert.ok(run.height > 0.35, 'still up');
});

test("a jump you press just before landing happens on landing; ghost mode counts a hit and runs on", () => {
  const run = new Run(3, {}, { speed: 30 });
  run.jump();
  for (let k = 0; k < 33; k++) run.step(1 / 60); // ~0.55 s: about to land
  run.jump();
  assert.ok(run.jumpBuffer > 0, 'kept');
  for (let k = 0; k < 6; k++) run.step(1 / 60);
  assert.ok(run.jumpT >= 0 && run.jumpT < 0.1, 'jumped again on landing');

  const ghost = new Run(5, {}, { speed: 30, ghost: true });
  const rows = [];
  ghost.events.onRow = (r) => rows.push(r);
  const trainRow = Array.from({ length: 200 }, (_, i) => ghost.row(i)).find((r) => r.i > 2 && r.lanes[1] === 'train');
  while (ghost.nextRow <= trainRow.i) ghost.step(1 / 60);
  assert.equal(ghost.alive, true);
  assert.equal(ghost.hits, rows.filter((r) => !r.ok).length, 'every miss counted');
  assert.ok(ghost.hits >= 1);
  assert.equal(rows.find((r) => r.row === trainRow.i).ok, false);
});
