// Classic Snake. Laya chooses from all four directions using current board facts and rules.
// Apply its returned choice directly; normal Snake physics rejects reversal, without a fallback.
import { rng } from '../lib3d.js';

export const COLS = 20, ROWS = 12;
export const DIRECTIONS = ['up', 'right', 'down', 'left'];
const VECTORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const RELATIONS = ['above', 'to the right of', 'below', 'to the left of'];
const equal = (a, b) => a.x === b.x && a.y === b.y;

export class Snake {
  constructor(seed) {
    this.rand = rng(seed); this.best = 0; this.crashes = 0; this.serial = 0; this.t = 0;
    this.reset();
  }

  reset() {
    const x = COLS / 2 | 0, y = ROWS / 2 | 0;
    this.body = Array.from({ length: 4 }, (_, n) => ({ x: x - n, y }));
    this.heading = 1; this.intent = 1; this.score = 0; this.dead = 0; this.won = false;
    this.acc = 0; this.serial++; this.read = null; this.decidedSerial = -1;
    this.spawnFood();
  }

  spawnFood() {
    const empty = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!this.body.some(cell => cell.x === x && cell.y === y)) empty.push({ x, y });
    }
    this.food = empty.length ? empty[this.rand() * empty.length | 0] : null;
    if (!this.food) { this.won = true; this.dead = 1.5; }
  }

  target(direction) {
    const [dx, dy] = VECTORS[direction], head = this.body[0];
    return { x: head.x + dx, y: head.y + dy };
  }

  obstruction(target) {
    if (target.x < 0 || target.x >= COLS || target.y < 0 || target.y >= ROWS) return 'wall';
    const growing = this.food && equal(target, this.food);
    // The tail vacates its current cell on a non-growing move, so that cell is legal.
    if (this.body.slice(0, growing ? undefined : -1).some(cell => equal(cell, target))) return 'body';
    return null;
  }

  steer(direction) {
    if (this.dead || !Number.isInteger(direction) || direction < 0 || direction >= 4 || direction === (this.heading + 2) % 4) return false;
    this.intent = direction; return true;
  }

  setModelDriven(enabled) { this.modelDriven = enabled; }

  update(dt, input) {
    this.t += dt;
    if (this.dead) {
      this.dead -= dt;
      if (this.dead <= 0 || input.restart) this.reset();
      return;
    }
    if (typeof input.direction === 'number') this.steer(input.direction);
    this.acc += dt;
    const interval = 1 / Math.min(10, 5 + this.score * 0.15);
    while (this.acc >= interval && !this.dead) {
      // A model-controlled step needs a choice for this exact position. Slow inference
      // must not let an old direction carry the head into another cell unchecked.
      if (this.modelDriven && this.decidedSerial !== this.serial) { this.acc = interval; break; }
      this.acc -= interval; this.move();
    }
  }

  move() {
    if (this.dead) return;
    this.heading = this.intent;
    const target = this.target(this.heading);
    if (this.obstruction(target)) { this.dead = 1.2; this.crashes++; return; }
    const growing = this.food && equal(target, this.food);
    this.body.unshift(target);
    if (growing) { this.score++; this.best = Math.max(this.best, this.score); this.spawnFood(); }
    else this.body.pop();
    this.serial++; this.read = null;
  }

  needsDecision() {
    return !this.dead && this.decidedSerial !== this.serial;
  }

  observe() {
    const head = this.body[0], food = this.food;
    const relative = food ? [food.y < head.y ? 'above' : food.y > head.y ? 'below' : null,
      food.x < head.x ? 'to the left of' : food.x > head.x ? 'to the right of' : null].filter(Boolean).join(' and ') : null;
    // Bind each option to its neighboring cell instead of asking the encoder to combine
    // a separate occupancy paragraph with generic options. All four options remain present.
    // These are local cell/rule facts, never food-distance scores or a recommended route.
    const criteria = Object.fromEntries(DIRECTIONS.map((direction, index) => {
      const blocked = this.obstruction(this.target(index));
      const obstacle = index === (this.heading + 2) % 4 ? 'reverse into the neck'
        : blocked === 'body' ? 'snake body' : blocked;
      return [direction, obstacle ? `obstacle, ${obstacle}` : `open passage ${RELATIONS[index]} the head`];
    }));
    this.read = { serial: this.serial };
    return { state: food ? `The food is ${relative || 'at'} the head.` : 'There is no food; the board is full.',
      questions: { direction: { type: 'choice', instructions: 'Which open direction is toward food?', criteria } } };
  }

  act(answers, params, apply) {
    const read = this.read;
    if (!read || this.dead || read.serial !== this.serial) return { label: 'STALE READ', why: 'The head moved while the model was deciding.' };
    const choice = answers.direction.choice;
    if (!apply) return { label: 'NOT APPLIED', why: 'Paused; the model reading did not change steering.' };
    this.decidedSerial = this.serial;
    if (!this.steer(DIRECTIONS.indexOf(choice))) return {
      label: `REJECTED ${choice.toUpperCase()}`,
      why: `The model chose a forbidden reversal; continuing ${DIRECTIONS[this.heading]}. No alternative was selected.`,
    };
    return { label: `QUEUED ${choice.toUpperCase()}`, why:
      `Applying the model's ${choice} choice directly.` };
  }

  draw(ctx, w, h) {
    ctx.fillStyle = 'rgb(9,9,9)'; ctx.fillRect(0, 0, w, h);
    const cell = Math.min((w - 40) / COLS, (h - 76) / ROWS);
    const ox = (w - cell * COLS) / 2, oy = (h - cell * ROWS) / 2 + 8;
    ctx.fillStyle = 'rgb(18,18,18)'; ctx.fillRect(ox, oy, cell * COLS, cell * ROWS);
    ctx.strokeStyle = 'rgb(38,38,38)'; ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + x * cell, oy + ROWS * cell); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox + COLS * cell, oy + y * cell); ctx.stroke(); }
    ctx.strokeStyle = 'rgb(160,160,160)'; ctx.lineWidth = 2; ctx.strokeRect(ox - 2, oy - 2, COLS * cell + 4, ROWS * cell + 4);
    const center = p => [ox + (p.x + 0.5) * cell, oy + (p.y + 0.5) * cell];
    if (this.food) {
      const [x, y] = center(this.food), radius = cell * 0.29;
      ctx.strokeStyle = `rgb(${70 + Math.round(Math.sin(this.t * 5) * 30)},70,70)`;
      // Only the red channel is used by the dither stage.
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, cell * 0.43, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgb(255,255,255)'; ctx.beginPath();
      ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgb(9,9,9)'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    if (!(this.dead && !this.won && Math.floor(this.dead * 10) % 2)) {
      ctx.strokeStyle = 'rgb(220,220,220)'; ctx.lineWidth = cell * 0.65; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
      this.body.forEach((p, i) => { const [x, y] = center(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      this.body.forEach((p, i) => {
        const [x, y] = center(p), size = cell * (i ? 0.56 : 0.8);
        ctx.fillStyle = i ? 'rgb(205,205,205)' : 'rgb(255,255,255)'; ctx.fillRect(x - size / 2, y - size / 2, size, size);
      });
      const [x, y] = center(this.body[0]), [dx, dy] = VECTORS[this.heading], eye = Math.max(2, cell * 0.09);
      ctx.fillStyle = 'rgb(9,9,9)';
      for (const side of [-1, 1]) ctx.fillRect(x + dx * cell * 0.21 - dy * side * cell * 0.2 - eye / 2,
        y + dy * cell * 0.21 + dx * side * cell * 0.2 - eye / 2, eye, eye);
    }
    ctx.fillStyle = 'rgb(150,150,150)'; ctx.font = `${Math.max(9, cell * 0.36)}px monospace`;
    ctx.textAlign = 'left'; ctx.fillText('SNAKE / CLASSIC GRID', ox, oy - 12);
    ctx.textAlign = 'right'; ctx.fillText(`LENGTH ${this.body.length}   SPEED ${Math.min(10, 5 + this.score * 0.15).toFixed(1)}`, ox + COLS * cell, oy + ROWS * cell + 20);
    ctx.textAlign = 'left';
  }
}

const KEY_DIRECTIONS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
export default {
  id: 'snake', title: 'Snake', checkpoint: 'english', keys: 'ARROWS / WASD / D-PAD TO STEER', touch: true,
  simulationSpeed: { min: 0.1, max: 2, step: 0.1, value: 1 },
  recordingVersion: 'snake-state-v6-grounded-options',
  showCriteria: true,
  answerLabel: 'ANSWER · RAW MODEL PROBABILITIES',
  keyCodes: [...Object.keys(KEY_DIRECTIONS), 'Space'],
  touchKeys: [['ArrowUp', '↑', 'Up'], ['ArrowLeft', '←', 'Left'], ['ArrowDown', '↓', 'Down'], ['ArrowRight', '→', 'Right']],
  blurb: 'All four directions stay available. Laya reads each neighboring cell and the food position, then its choice controls steering directly.',
  params: [],
  input: (keys, pressed) => {
    const last = [...pressed].filter(key => Object.hasOwn(KEY_DIRECTIONS, key)).at(-1);
    return { direction: last === undefined ? null : KEY_DIRECTIONS[last], restart: pressed.has('Space') };
  },
  create: seed => new Snake(seed),
};
