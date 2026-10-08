import assert from 'node:assert/strict';
import demo, { Snake, COLS, ROWS } from '../static/demos/snake.js';

const answer = (up, right, down, left = 0) => {
  const probabilities = { up, right, down, left };
  const choice = Object.keys(probabilities).reduce((best, key) => probabilities[key] > probabilities[best] ? key : best);
  return { direction: { choice, probabilities } };
};
const params = {};
const game = new Snake(7), twin = new Snake(7);
assert.deepEqual(game.body, twin.body); assert.deepEqual(game.food, twin.food);
assert.ok(!game.body.some(p => p.x === game.food.x && p.y === game.food.y));
const size = game.body.length;
assert.deepEqual(game.observe(), game.observe(), 'Warm-up observations must not consume a decision');
assert.deepEqual(Object.keys(game.observe().questions.direction.criteria), ['up', 'right', 'down', 'left'], 'All four directions stay available, including reversal');
game.food = game.target(1); game.move();
assert.equal(game.score, 1); assert.equal(game.best, 1); assert.equal(game.body.length, size + 1);
assert.ok(!game.body.some(p => p.x === game.food.x && p.y === game.food.y));
assert.equal(game.steer(3), false, 'Cannot reverse into the neck');
assert.equal(game.steer(0), true);
assert.equal(game.steer(3), false, 'Queued turns cannot bypass reversal protection');
assert.equal(game.intent, 0);

game.body = [{ x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }]; game.heading = game.intent = 3;
game.move(); assert.equal(game.crashes, 1); assert.ok(game.dead > 0);
game.update(2, {}); assert.equal(game.dead, 0); assert.equal(game.score, 0); assert.equal(game.best, 1); assert.equal(game.crashes, 1);

const tail = new Snake(10);
tail.body = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }];
tail.heading = 0; tail.intent = 1; tail.food = { x: 10, y: 10 };
assert.match(tail.observe().questions.direction.criteria.right, /open passage/, 'A vacating tail is described as a playable cell without hiding any option');
tail.move(); assert.equal(tail.dead, 0, 'Tail cell vacates on a normal move');
assert.equal(new Set(tail.body.map(p => `${p.x},${p.y}`)).size, 4);
const hit = new Snake(11);
hit.body = [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
hit.heading = 0; hit.intent = 3; hit.food = { x: 10, y: 10 };
hit.move(); assert.equal(hit.crashes, 1, 'Body collision is fatal');

const stale = new Snake(12);
stale.observe(); stale.move();
const before = stale.intent;
assert.equal(stale.act(answer(1, 0, 0), params, true).label, 'STALE READ');
assert.equal(stale.intent, before); assert.equal(stale.needsDecision(), true);
stale.observe(); stale.act(answer(1, 0, 0), params, false);
assert.equal(stale.needsDecision(), true, 'An unapplied answer must not consume a decision');
stale.act(answer(1, 0, 0), params, true);
assert.equal(stale.intent, 0, 'Apply the model direction directly');
assert.equal(stale.needsDecision(), false, 'Do not request another decision for the same head position');

// Apply the returned choice, even if another probability or an empty exit looks better.
const wrong = new Snake(13);
wrong.body = [{ x: 0, y: 4 }, { x: 0, y: 5 }, { x: 0, y: 6 }]; wrong.heading = wrong.intent = 0;
assert.equal(wrong.observe().questions.direction.criteria.left, 'obstacle, wall');
const wallAction = wrong.act(answer(0.1, 0.2, 0, 0.7), params, true);
assert.equal(wrong.intent, 3, 'The model wall choice is applied without a fallback');
assert.equal(wallAction.label, 'QUEUED LEFT');
wrong.move(); assert.equal(wrong.crashes, 1);

const corner = new Snake(17);
corner.body = [{ x: 10, y: 6 }, { x: 9, y: 6 }, { x: 9, y: 5 }, { x: 10, y: 5 }, { x: 11, y: 5 }, { x: 11, y: 6 }, { x: 12, y: 6 }];
corner.heading = corner.intent = 1; corner.food = { x: 10, y: 2 };
corner.observe(); corner.act(answer(0.8, 0.1, 0.1), params, true);
assert.equal(corner.intent, 0, 'Body choice is applied instead of choosing the empty detour');
corner.move(); assert.equal(corner.crashes, 1);

for (let heading = 0; heading < 4; heading++) {
  const names = ['up', 'right', 'down', 'left'], reverse = (heading + 2) % 4;
  const reversed = new Snake(18); reversed.heading = reversed.intent = heading;
  const obs = reversed.observe();
  assert.deepEqual(Object.keys(obs.questions.direction.criteria), names, 'Fixed four-action schema at every heading');
  assert.equal(obs.questions.direction.criteria[names[reverse]], 'obstacle, reverse into the neck', 'The backward direction remains offered with its actual rule context');
  const probabilities = [0.1, 0.1, 0.1, 0.1]; probabilities[reverse] = 0.7;
  const action = reversed.act(answer(...probabilities), params, true);
  assert.equal(action.label, `REJECTED ${names[reverse].toUpperCase()}`);
  assert.equal(reversed.intent, heading, 'Normal Snake reversal rejection does not substitute another model option');
  assert.equal(reversed.needsDecision(), false, 'One answer per position, including rejected answers');
}
const authoritative = new Snake(20); authoritative.observe();
authoritative.act({ direction: { choice: 'down', probabilities: { up: 0.7, right: 0.1, down: 0.1, left: 0.1 } } }, params, true);
assert.equal(authoritative.intent, 2, 'Use returned choice rather than recomputing probability ranking');

const slow = new Snake(19); slow.setModelDriven(true);
const originalHead = { ...slow.body[0] };
slow.observe(); slow.update(1, {});
assert.deepEqual(slow.body[0], originalHead, 'Wait for a fresh answer when inference is slower than movement');
slow.act(answer(0.1, 0.8, 0.1), params, true); slow.update(1, {});
assert.equal(slow.body[0].x, originalHead.x + 1, 'One model answer authorizes one cell movement');
assert.equal(slow.serial, 2, 'Do not spend the same answer on catch-up moves');

const full = new Snake(14);
full.body = Array.from({ length: COLS * ROWS }, (_, n) => ({ x: n % COLS, y: Math.floor(n / COLS) }));
full.spawnFood(); assert.equal(full.food, null); assert.equal(full.won, true); assert.equal(full.crashes, 0);

const controls = demo.input(new Set(), new Set(['KeyW']));
assert.equal(controls.direction, 0);
const up = new Snake(15), head = { ...up.body[0] };
up.update(0.2, controls); assert.equal(up.body[0].y, head.y - 1);
assert.equal(demo.input(new Set(), new Set(['ArrowUp', 'ArrowRight'])).direction, 1);

// Same seed, steps and model readings reproduce the game, including resets and food spawns.
const a = new Snake(16), b = new Snake(16);
for (let step = 0; step < 6000; step++) {
  for (const instance of [a, b]) {
    if (step % 3 === 0 && !instance.dead) { instance.observe(); instance.act(answer(0.5, 0.3, 0.2), params, true); }
    instance.update(1 / 120, {});
  }
}
assert.deepEqual({ body: a.body, food: a.food, score: a.score, crashes: a.crashes }, { body: b.body, food: b.food, score: b.score, crashes: b.crashes });
console.log('Snake growth, collisions, reversal schema, tail motion, stale reads, all four model options, direct choice with no fallback, input and seeded replay verified.');
