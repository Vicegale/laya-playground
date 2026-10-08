import demos from './index.js';
import { installGameSection, seeded } from './perception.js';

const COLS = 9, ROWS = 11;
const DIRS = {
  up: { dx: 0, dr: -1 }, left: { dx: -1, dr: 0 }, right: { dx: 1, dr: 0 },
  wait: { dx: 0, dr: 0 }, down: { dx: 0, dr: 1 },
};
const ROAD_ROWS = new Set([6, 7, 8, 9]);
const RIVER_ROWS = new Set([1, 2, 3, 4]);


function wrap(v, span) {
  v %= span;
  return v < 0 ? v + span : v;
}

installGameSection({
  id: 'frogger', navLabel: 'Frogger',
  titleHtml: 'See every opening.<br>Choose the hop.',
  lead: 'Frogger gives Laya a compact view of the frog’s current tile and the immediately adjacent spaces, then asks it to choose the hop directly. Code reports terrain, cars and logs but does not rank moves or look ahead to choose a route.',
  sees: 'Home is above. Laya sees the current tile plus UP, LEFT, RIGHT and DOWN when they exist: bank, road traffic, or river log support. It does not get pre-labelled safe or preferred moves.',
  controls: 'Move with the arrow keys or WASD. UP, LEFT, RIGHT, WAIT and DOWN are the actual options when legal; Laya’s returned choice is the hop that is executed.',
});

export class Frogger {
  constructor(seed) {
    this.rand = seeded(seed);
    this.best = 0;
    this.crashes = 0;
    this.level = 1;
    this.optionTurn = 0;
    this.lanes = [
      { row: 1, kind: 'river', speed: 0.92, length: 3.5, gap: 1.5, phase: 0.2 },
      { row: 2, kind: 'river', speed: -0.78, length: 3.9, gap: 1.6, phase: 1.1 },
      { row: 3, kind: 'river', speed: 1.05, length: 3.2, gap: 1.6, phase: 2.0 },
      { row: 4, kind: 'river', speed: -0.88, length: 3.7, gap: 1.7, phase: 0.6 },
      { row: 6, kind: 'road', speed: 1.35, length: 1.15, gap: 5.2, phase: 0.1 },
      { row: 7, kind: 'road', speed: -1.55, length: 1.35, gap: 5.6, phase: 1.5 },
      { row: 8, kind: 'road', speed: 1.15, length: 1.7, gap: 5.8, phase: 0.8 },
      { row: 9, kind: 'road', speed: -1.7, length: 1.0, gap: 5.0, phase: 2.3 },
    ];
    this.time = 0;
    this.reset(true);
  }

  reset(first = false) {
    if (!first) this.level = 1;
    this.score = 0;
    this.dead = 0;
    this.hopCool = 0;
    this.modelMove = 'wait';
    this.frog = { x: 4, row: 10 };
  }

  setModelDriven(enabled) { this.modelDriven = enabled; if (!enabled) this.modelMove = 'wait'; }
  lane(row) { return this.lanes.find(l => l.row === row) || null; }

  objectsAt(lane, t = this.time) {
    const span = COLS + 4;
    const period = lane.length + lane.gap;
    const offset = wrap(lane.phase + lane.speed * t, period);
    const out = [];
    for (let base = -period * 2; base < span + period * 2; base += period) {
      const left = wrap(base + offset, span) - 2;
      out.push({ left, right: left + lane.length });
      if (left + lane.length > span - 2) out.push({ left: left - span, right: left + lane.length - span });
    }
    return out;
  }

  occupied(row, x, t = this.time) {
    const lane = this.lane(row);
    if (!lane) return false;
    return this.objectsAt(lane, t).some(o => x + 0.34 >= o.left && x - 0.34 <= o.right);
  }

  candidateList() {
    return Object.entries(DIRS).flatMap(([id, d]) => {
      const row = this.frog.row + d.dr;
      const x = this.frog.x + d.dx;
      if (row < 0 || row >= ROWS || x < 0 || x > COLS - 1) return [];
      const label = `${id.toUpperCase()} option`;
      return [{ id, label, row, x }];
    });
  }

  roadFact(row, x, spot = 'that space') {
    const lane = this.lane(row);
    if (this.occupied(row, x)) return `A car overlaps ${spot} now.`;
    const cars = this.objectsAt(lane);
    const distances = cars.map(car => {
      const distance = x < car.left ? car.left - x : x > car.right ? x - car.right : 0;
      const center = (car.left + car.right) / 2;
      const approaching = (center < x && lane.speed > 0) || (center > x && lane.speed < 0);
      return { distance, approaching };
    }).sort((a, b) => a.distance - b.distance);
    const nearest = distances[0];
    if (!nearest || nearest.distance === 0) return `A car occupies ${spot} now.`;
    const distance = nearest.distance < 0.75 ? 'very close' : nearest.distance < 1.7 ? 'nearby' : 'far away';
    return `The nearest car is ${distance} and ${nearest.approaching ? 'moving toward' : 'moving away from'} ${spot}.`;
  }

  riverFact(row, x, spot = 'that space') {
    const lane = this.lane(row);
    const supported = this.occupied(row, x);
    if (!supported) return `There is no log under ${spot} now.`;
    return `A log supports ${spot} now and is moving ${lane.speed < 0 ? 'left' : 'right'}.`;
  }

  spaceFact(row, x) {
    const lane = this.lane(row);
    if (!lane) return row === 0 ? 'home bank' : 'bank';
    if (lane.kind === 'road') return `road; ${this.roadFact(row, x, 'this space').replace(/\.$/, '').toLowerCase()}`;
    return `river; ${this.riverFact(row, x, 'this space').replace(/\.$/, '').toLowerCase()}`;
  }

  doHop(dir) {
    const d = DIRS[dir];
    if (!d || dir === 'wait') return;
    const nr = this.frog.row + d.dr;
    const nx = this.frog.x + d.dx;
    if (nr < 0 || nr >= ROWS || nx < 0 || nx > COLS - 1) return;
    this.frog.row = nr;
    this.frog.x = nx;
  }

  update(dt, input = {}) {
    this.time += dt * (1 + (this.level - 1) * 0.05);
    if (this.dead) {
      this.dead -= dt;
      if (this.dead <= 0 || input.restart) { this.dead = 0; this.frog = { x: 4, row: 10 }; this.hopCool = 0; }
      return;
    }

    this.hopCool = Math.max(0, this.hopCool - dt);
    let dir = null;
    if (this.modelDriven) {
      // Model-driven hops are committed in act() so a transient safe opening is not
      // overwritten by the next perception before the hop cooldown expires.
    } else if (this.hopCool <= 0) {
      if (input.up) dir = 'up'; else if (input.left) dir = 'left'; else if (input.right) dir = 'right'; else if (input.down) dir = 'down';
    }
    if (dir) { this.doHop(dir); this.hopCool = 0.1; }

    const lane = this.lane(this.frog.row);
    if (lane?.kind === 'river') {
      if (!this.occupied(this.frog.row, this.frog.x)) return this.crash();
      this.frog.x += lane.speed * dt;
      if (this.frog.x < -0.42 || this.frog.x > COLS - 0.58) return this.crash();
    } else if (lane?.kind === 'road' && this.occupied(this.frog.row, this.frog.x)) return this.crash();

    if (this.frog.row === 0) {
      this.score += 100 + this.level * 10;
      this.best = Math.max(this.best, this.score);
      this.level++;
      this.frog = { x: 4, row: 10 };
      this.hopCool = 0.35;
    }
  }

  crash() {
    if (this.dead) return;
    this.dead = 0.8;
    this.crashes++;
    this.best = Math.max(this.best, this.score);
    this.modelMove = 'wait';
  }

  observe() {
    const candidates = this.candidateList();
    const rotation = this.optionTurn++ % candidates.length;
    const optionOrder = candidates.map((_, i) => (i + rotation) % candidates.length);
    this.lastCandidates = candidates;
    const descriptions = {
      up: 'jump UP one lane toward home',
      left: 'jump LEFT one tile',
      right: 'jump RIGHT one tile',
      wait: 'WAIT on the current tile',
      down: 'jump DOWN one lane away from home',
    };
    const adjacent = candidates.filter(candidate => candidate.id !== 'wait');
    return {
      state: [
        'Goal: reach the home bank above. Cars are dangerous; river water requires a log.',
        `Current: ${this.spaceFact(this.frog.row, this.frog.x)}.`,
        ...adjacent.map(candidate => `${candidate.id.toUpperCase()}: ${this.spaceFact(candidate.row, candidate.x)}.`),
      ].join(' '),
      questions: {
        move: {
          type: 'choice',
          option_order: optionOrder,
          instructions: 'Which legal hop should the frog take now?',
          criteria: Object.fromEntries(candidates.map(candidate => [candidate.id, descriptions[candidate.id]])),
        },
      },
    };
  }

  act(answers, params, apply) {
    const candidates = this.lastCandidates?.length ? this.lastCandidates : this.candidateList();
    const requested = answers?.move?.choice;
    const chosen = candidates.find(candidate => candidate.id === requested) || candidates.find(candidate => candidate.id === 'wait') || candidates[0];
    const dir = chosen?.id || 'wait';
    if (apply) {
      this.modelMove = dir;
      if (dir !== 'wait' && this.hopCool <= 0) {
        this.doHop(dir);
        this.hopCool = 0.1;
      }
    }
    const probability = answers?.move?.probabilities?.[dir] ?? 0;
    const label = dir === 'wait' ? 'WAIT' : dir.toUpperCase();
    return { label, why: `Laya chose ${dir} (${probability.toFixed(2)})` };
  }

  draw(ctx, w, h) {
    const cw = w / COLS, rh = h / ROWS;
    ctx.fillStyle = 'rgb(8,8,8)'; ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < ROWS; row++) {
      if (RIVER_ROWS.has(row)) ctx.fillStyle = 'rgb(24,24,24)';
      else if (ROAD_ROWS.has(row)) ctx.fillStyle = 'rgb(14,14,14)';
      else ctx.fillStyle = row === 0 ? 'rgb(38,38,38)' : 'rgb(29,29,29)';
      ctx.fillRect(0, row * rh, w, rh);
      ctx.strokeStyle = 'rgb(52,52,52)'; ctx.beginPath(); ctx.moveTo(0, row * rh); ctx.lineTo(w, row * rh); ctx.stroke();
    }

    for (const lane of this.lanes) {
      for (const o of this.objectsAt(lane)) {
        const x = o.left * cw;
        const ow = lane.length * cw;
        if (lane.kind === 'river') {
          ctx.fillStyle = 'rgb(120,120,120)'; ctx.fillRect(x, lane.row * rh + rh * 0.23, ow, rh * 0.54);
          ctx.fillStyle = 'rgb(70,70,70)'; ctx.fillRect(x + 4, lane.row * rh + rh * 0.34, Math.max(2, ow - 8), 2);
        } else {
          ctx.fillStyle = lane.row % 2 ? 'rgb(210,210,210)' : 'rgb(170,170,170)';
          ctx.fillRect(x, lane.row * rh + rh * 0.25, ow, rh * 0.5);
          ctx.fillStyle = 'rgb(45,45,45)'; ctx.fillRect(x + ow * 0.18, lane.row * rh + rh * 0.15, ow * 0.18, rh * 0.13);
        }
      }
    }

    const fx = (this.frog.x + 0.5) * cw, fy = (this.frog.row + 0.5) * rh;
    if (!(this.dead && Math.floor(this.dead * 12) % 2)) {
      ctx.fillStyle = 'rgb(245,245,245)';
      ctx.beginPath(); ctx.arc(fx, fy, Math.min(cw, rh) * 0.27, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(fx - cw * 0.28, fy - rh * 0.12, cw * 0.12, rh * 0.12);
      ctx.fillRect(fx + cw * 0.16, fy - rh * 0.12, cw * 0.12, rh * 0.12);
    }

    ctx.fillStyle = 'rgb(145,145,145)'; ctx.font = `${Math.max(10, h * 0.027)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText(`LEVEL ${this.level}   ROW ${10 - this.frog.row}/10`, 14, 20);
    ctx.textAlign = 'right'; ctx.fillText('FROGGER / CANDIDATE HOPS', w - 14, 20); ctx.textAlign = 'left';
  }
}

const demo = {
  id: 'frogger', title: 'Frogger', checkpoint: 'english',
  keys: 'ARROWS OR WASD TO HOP', touch: true,
  keyCodes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'],
  touchKeys: [['ArrowLeft', '←', 'Hop left'], ['ArrowUp', '↑', 'Hop up'], ['ArrowDown', '↓', 'Hop down'], ['ArrowRight', '→', 'Hop right']],
  simulationSpeed: { min: 0.5, max: 1.5, step: 0.1, value: 1 },
  blurb: 'One board state, one choice. Every legal hop is an option; JavaScript describes the crossing but never scores which hop is safest or best.',
  params: [],
  answerLabel: 'ANSWER · HOP',
  answerForFeed: answers => ({
    probabilities: answers?.move?.probabilities || {},
    choice: answers?.move?.choice || 'unknown',
  }),
  input: (keys, pressed) => ({
    up: pressed.has('ArrowUp') || pressed.has('KeyW') || keys.has('ArrowUp') || keys.has('KeyW'),
    down: pressed.has('ArrowDown') || pressed.has('KeyS') || keys.has('ArrowDown') || keys.has('KeyS'),
    left: pressed.has('ArrowLeft') || pressed.has('KeyA') || keys.has('ArrowLeft') || keys.has('KeyA'),
    right: pressed.has('ArrowRight') || pressed.has('KeyD') || keys.has('ArrowRight') || keys.has('KeyD'),
    restart: pressed.has('Space'),
  }),
  create: seed => new Frogger(seed),
};

if (!demos.some(d => d.id === demo.id)) demos.push(demo);
export default demo;
