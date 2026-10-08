// Real-model regression positions and seeded headless games. Requires server.py on 8770.
// node tools/evaluate_snake.mjs --out /tmp/snake-evaluation.json
// node tools/evaluate_snake.mjs --previous --seeds 7,20261006,31 --seconds 60
// --baseline retains the historical v3 balanced prompt and its no-wait controller.
// node tools/evaluate_snake.mjs --seeds 101,202,303,404,505 --speed 0.2
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import demo, { Snake, DIRECTIONS } from '../static/demos/snake.js';
import { STEP, MAX_RATE } from '../static/sim.js';

const args = process.argv.slice(2), option = (name, fallback) => {
  const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1];
};
const baseline = args.includes('--baseline'), previous = args.includes('--previous');
assert.ok(!(baseline && previous), 'Choose either --baseline (v3) or --previous (v5)');
const seconds = Number(option('--seconds', 60)), speed = Number(option('--speed', 1));
const latencyMs = Number(option('--latency-ms', 0));
assert.ok(seconds > 0 && speed > 0);
const seeds = option('--seeds', '7,20261006,31').split(',').map(Number);
const API = process.env.LAYA_API || 'http://127.0.0.1:8770';
const VECTORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// Grading only: this never affects model input or steering.
const playableDirections = game => DIRECTIONS.filter((_, direction) =>
  direction !== (game.heading + 2) % 4 && !game.obstruction(game.target(direction)));

// Historical v3 input, retained for earlier comparisons.
function oldObserve(game) {
  const head = game.body[0], food = game.food;
  const relative = [food.y < head.y ? 'above' : food.y > head.y ? 'below' : null,
    food.x < head.x ? 'to the left of' : food.x > head.x ? 'to the right of' : null].filter(Boolean).join(' and ');
  const relations = ['above', 'to the right of', 'below', 'to the left of'];
  const surroundings = DIRECTIONS.map((_, direction) => {
    const cell = game.target(direction), index = game.body.findIndex(part => part.x === cell.x && part.y === cell.y);
    const contents = cell.x < 0 || cell.x >= 20 || cell.y < 0 || cell.y >= 12 ? 'contains a wall'
      : food.x === cell.x && food.y === cell.y ? 'contains food'
      : index === game.body.length - 1 ? "contains the snake's tail"
      : index >= 0 ? "contains the snake's body" : 'is empty';
    return `The cell ${relations[direction]} the head ${contents}.`;
  });
  const q = { type: 'choice', instructions: 'Which direction has empty space toward the food?', criteria: {
    up: 'empty space above the head, with food above the head',
    right: 'empty space to the right of the head, with food to the right of the head',
    down: 'empty space below the head, with food below the head',
    left: 'empty space to the left of the head, with food to the left of the head',
  } };
  return { state: [`The snake is heading ${DIRECTIONS[game.heading]}.`, `The food is ${relative || 'at'} the head.`, ...surroundings].join('\n'),
    questions: Object.fromEntries(DIRECTIONS.map((_, rotation) => [`direction_${rotation}`, {
      ...q, option_order: DIRECTIONS.map((_, index) => (index + rotation) % 4),
    }])) };
}
// v5 prompt under the same current physics/controller: only model input changes.
function previousObserve(game) {
  const current = game.observe(), heading = DIRECTIONS[game.heading], food = game.food;
  const relations = ['above', 'to the right of', 'below', 'to the left of'];
  const cells = DIRECTIONS.map((_, direction) => {
    const cell = game.target(direction), index = game.body.findIndex(part => part.x === cell.x && part.y === cell.y);
    const contents = cell.x < 0 || cell.x >= 20 || cell.y < 0 || cell.y >= 12 ? 'contains a wall'
      : cell.x === food.x && cell.y === food.y ? 'contains food'
      : index === game.body.length - 1 ? "contains the snake's tail"
      : index >= 0 ? "contains the snake's body" : 'is empty';
    return `The cell ${relations[direction]} the head ${contents}.`;
  });
  return {state: [`The snake is heading ${heading}. It can continue ${heading} or turn ${DIRECTIONS[(game.heading + 3) % 4]} or ${DIRECTIONS[(game.heading + 1) % 4]}; it cannot reverse.`, ...cells, current.state].join('\n'),
    questions: {direction: {type: 'choice', instructions: 'Which clear direction should the snake choose to reach the food without reversing?',
      criteria: Object.fromEntries(DIRECTIONS.map((direction, index) => [direction, `empty space ${relations[index]} the head, with food ${relations[index]} the head`]))}}};
}
const observe = game => baseline ? oldObserve(game) : previous ? previousObserve(game) : game.observe();
function apply(game, answers, serial) {
  if (!baseline) return game.act(answers, {}, true);
  if (serial !== game.serial || game.dead) return { label: 'STALE READ' };
  const probabilities = Object.fromEntries(DIRECTIONS.map(direction => [direction,
    Object.values(answers).reduce((total, answer) => total + answer.probabilities[direction], 0) / 4]));
  const choice = DIRECTIONS.reduce((best, direction) => probabilities[direction] > probabilities[best] ? direction : best);
  game.decidedSerial = game.serial;
  return { label: game.steer(DIRECTIONS.indexOf(choice)) ? 'QUEUED ' + choice.toUpperCase() : 'REJECTED ' + choice.toUpperCase() };
}
let requests = 0, truncations = 0;
async function predict(obs) {
  const response = await fetch(API + '/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: obs.state, questions: obs.questions, model: 'english' }) });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json(); requests++;
  if (latencyMs > 0) await new Promise(resolve => setTimeout(resolve, latencyMs));
  if (result.usage?.truncated || result.usage?.state_truncated || result.usage?.options_truncated) truncations++;
  return result;
}

// Rotated food locations, wall turns and a body corner requiring a detour.
const positions = [];
for (let heading = 0; heading < 4; heading++) for (const [dx, dy] of [[0,-4],[4,0],[0,4],[-4,0],[3,-3],[3,3],[-3,3],[-3,-3]]) {
  const game = new Snake(1); game.heading = game.intent = heading;
  game.body = Array.from({ length: 4 }, (_, n) => ({ x: 10 - n * VECTORS[heading][0], y: 6 - n * VECTORS[heading][1] }));
  game.food = { x: 10 + dx, y: 6 + dy }; positions.push({ name: `heading-${DIRECTIONS[heading]}-food-${dx},${dy}`, game });
}
for (let heading = 0; heading < 4; heading++) {
  const game = new Snake(2), x = heading === 1 ? 19 : heading === 3 ? 0 : 10, y = heading === 2 ? 11 : heading === 0 ? 0 : 6;
  game.heading = game.intent = heading;
  game.body = Array.from({ length: 4 }, (_, n) => ({ x: x - n * VECTORS[heading][0], y: y - n * VECTORS[heading][1] }));
  game.food = { x: heading === 1 ? 3 : heading === 3 ? 16 : 12, y: heading === 2 ? 2 : heading === 0 ? 9 : 4 };
  positions.push({ name: `wall-ahead-${DIRECTIONS[heading]}`, game });
}
for (const food of [{x:10,y:2},{x:14,y:6},{x:7,y:9}]) {
  const game = new Snake(3); game.heading = game.intent = 1;
  game.body = [{x:10,y:6},{x:9,y:6},{x:9,y:5},{x:10,y:5},{x:11,y:5},{x:11,y:6},{x:12,y:6}];
  game.food = food; positions.push({ name: `body-corner-food-${food.x},${food.y}`, game });
}
let safe = 0, progress = 0, reversals = 0;
const failures = [];
for (const { name, game } of positions) {
  const obs = observe(game), serial = game.serial, { answers } = await predict(obs);
  const action = apply(game, answers, serial), direction = game.intent;
  const legal = !action.label.startsWith('REJECTED') && !game.obstruction(game.target(direction));
  const distance = cell => Math.abs(cell.x - game.food.x) + Math.abs(cell.y - game.food.y);
  const closer = playableDirections(game).filter(d => distance(game.target(DIRECTIONS.indexOf(d))) < distance(game.body[0]));
  const toward = legal && (!closer.length || closer.includes(DIRECTIONS[direction]));
  safe += Number(legal); progress += Number(toward); reversals += Number(action.label.startsWith('REJECTED'));
  if (!toward) failures.push({ name, action: action.label, playable: playableDirections(game), closer, state: obs.state, answers });
}
const positionSummary = { cases: positions.length, safe, progress, reversals, failures };
console.log('positions', JSON.stringify({ cases: positions.length, safe, progress, reversals }));
// Accuracy is measured, not enforced: all four options remain available to the model.

const runs = [];
for (const seed of seeds) {
  const game = new Snake(seed), total = Math.round(seconds / STEP);
  game.setModelDriven(!baseline);
  let step = 0, calls = 0, rejected = 0, stale = 0, guarded = 0, trapped = 0, food = 0, changedPreferred = 0;
  const advance = count => {
    for (let n = 0; n < count && step < total; n++, step++) {
      const before = game.score; game.update(STEP, {});
      if (game.score > before) food += game.score - before;
    }
  };
  while (step < total) {
    if (!game.needsDecision()) { advance(1); continue; }
    const obs = observe(game), serial = game.serial, s0 = step, t0 = performance.now();
    const result = await predict(obs), rtt = performance.now() - t0;
    advance(Math.max(1, Math.ceil(rtt * speed / 1000 / STEP)));
    const action = apply(game, result.answers, serial); calls++;
    rejected += Number(action.label.startsWith('REJECTED'));
    stale += Number(action.label === 'STALE READ'); trapped += Number(action.label === 'TRAPPED');
    guarded += Number(Boolean(action.why?.includes('Excluded:')));
    if (!baseline && action.label.startsWith('QUEUED')) changedPreferred += Number(action.label !== 'QUEUED ' + result.answers.direction.choice.toUpperCase());
    advance(Math.max(0, Math.ceil(1000 / MAX_RATE * speed / 1000 / STEP) - (step - s0)));
  }
  const run = { seed, seconds, speed, latencyMs, score: game.score, best: game.best, food, crashes: game.crashes, calls, rejected, stale, guarded, trapped, changedPreferred };
  runs.push(run); console.log('run', JSON.stringify(run));
  if (!baseline) {
    assert.equal(changedPreferred, 0, 'Controller must apply the returned choice without selecting an alternative');
    assert.equal(guarded, 0, 'Controller must not filter direction probabilities');
    assert.equal(stale, 0, 'Model-driven movement must wait for a fresh answer');
  }
}
const report = { policy: baseline ? 'v3-balanced-baseline' : previous ? 'snake-state-v5-model-choice' : demo.recordingVersion, model: 'english', requests, truncations,
  positions: positionSummary, runs, totals: { food: runs.reduce((n, r) => n + r.food, 0), crashes: runs.reduce((n, r) => n + r.crashes, 0) } };
const out = option('--out', null); if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log('totals', JSON.stringify(report.totals));
