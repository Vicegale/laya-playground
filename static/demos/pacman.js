import demos from './index.js';
import { installGameSection, seeded } from './perception.js';

const COLS = 19, ROWS = 15;
const VECTORS = {
  up: { dc: 0, dr: -1 }, right: { dc: 1, dr: 0 }, down: { dc: 0, dr: 1 }, left: { dc: -1, dr: 0 },
};
const CLOCKWISE = ['up', 'right', 'down', 'left'];


installGameSection({
  id: 'pacman', navLabel: 'Pac-Man',
  titleHtml: 'Read every corridor.<br>Choose the turn.',
  lead: 'Pac-Man now gives Laya one concrete classification per legal corridor instead of asking the vague question “is this corridor good?”. Each corridor is described by food, ghost pressure and topology; Laya classifies it as promising, quiet or dangerous.',
  sees: 'One description per legal corridor: nearby pellets or power pellets, nearest-ghost distance, current power state, and whether the corridor opens up or dead-ends. Laya decides which semantic situation best fits each corridor.',
  controls: 'Move with the arrow keys or WASD. Laya classifies each legal corridor as promising, quiet or dangerous; those probabilities determine Pac-Man\'s desired turn. Bad judgments are played.',
});

export class Pacman {
  constructor(seed) {
    this.rand = seeded(seed);
    this.best = 0;
    this.crashes = 0;
    this.level = 1;
    this.optionTurn = 0;
    this.reset(true);
  }

  buildMaze() {
    const grid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) =>
      r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? '#' : '.'));

    for (const c of [4, 14]) for (let r = 2; r < ROWS - 2; r++) if (![3, 7, 11].includes(r)) grid[r][c] = '#';
    for (const r of [5, 9]) for (let c = 2; c < COLS - 2; c++) if (![4, 9, 14].includes(c)) grid[r][c] = '#';
    for (let c = 7; c <= 11; c++) { grid[6][c] = '#'; grid[8][c] = '#'; }
    grid[7][7] = '#'; grid[7][11] = '#';
    for (const [r, c] of [[1,1],[1,17],[13,1],[13,17]]) grid[r][c] = 'o';
    for (const [r,c] of [[11,9],[7,9],[7,8],[7,10],[7,6],[7,12]]) grid[r][c] = ' ';
    return grid;
  }

  reset(first = false) {
    if (!first) this.level = 1;
    this.score = 0;
    this.dead = 0;
    this.playerClock = 0;
    this.ghostClock = 0;
    this.power = 0;
    this.modelDesired = 'left';
    this.maze = this.buildMaze();
    this.pac = { r: 11, c: 9, dir: 'left', desired: 'left' };
    this.ghosts = [
      { r: 7, c: 9, home: [7,9], shade: 230 },
      { r: 7, c: 8, home: [7,8], shade: 195 },
      { r: 7, c: 10, home: [7,10], shade: 165 },
    ];
  }

  setModelDriven(enabled) { this.modelDriven = enabled; if (!enabled) this.modelDesired = this.pac.dir; }
  passable(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS && this.maze[r][c] !== '#'; }

  neighbor(r, c, dir) {
    const d = VECTORS[dir];
    return { r: r + d.dr, c: c + d.dc };
  }

  ghostPositionFact() {
    const describeDirection = (dr, dc) => {
      const vertical = dr < 0 ? 'above' : dr > 0 ? 'below' : '';
      const horizontal = dc < 0 ? 'left' : dc > 0 ? 'right' : '';
      return vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal || 'on Pac-Man';
    };
    const facts = this.ghosts
      .map(g => {
        const dr = g.r - this.pac.r, dc = g.c - this.pac.c;
        const distance = Math.abs(dr) + Math.abs(dc);
        const band = distance <= 1 ? 'immediately' : distance <= 3 ? 'close' : distance <= 6 ? 'moderate distance' : 'far';
        return { distance, text: `${band} ${describeDirection(dr, dc)}` };
      })
      .sort((a, b) => a.distance - b.distance)
      .map(item => item.text);
    return `Ghosts: ${facts.join('; ')}.`;
  }

  corridorView(candidate) {
    const first = this.maze[candidate.r][candidate.c];
    const immediate = first === 'o' ? 'power pellet on the next tile' : first === '.' ? 'pellet on the next tile' : 'next tile is empty';
    let pellets = 0, powerPellets = 0, steps = 0;
    let r = this.pac.r, c = this.pac.c;
    for (let i = 0; i < 4; i++) {
      const n = this.neighbor(r, c, candidate.dir);
      if (!this.passable(n.r, n.c)) break;
      steps++;
      const cell = this.maze[n.r][n.c];
      if (cell === '.') pellets++;
      if (cell === 'o') powerPellets++;
      r = n.r; c = n.c;
    }
    const onward = CLOCKWISE.filter(dir => {
      const n = this.neighbor(candidate.r, candidate.c, dir);
      return this.passable(n.r, n.c) && !(n.r === this.pac.r && n.c === this.pac.c);
    }).length;
    const shape = onward === 0 ? 'dead end at the next tile' : onward === 1 ? 'one way onward from the next tile' : 'junction at the next tile';
    const food = powerPellets ? `${powerPellets} power pellet${powerPellets === 1 ? '' : 's'} and ${pellets} pellet${pellets === 1 ? '' : 's'} in the next ${steps} straight tiles` : `${pellets} pellet${pellets === 1 ? '' : 's'} in the next ${steps} straight tiles`;
    return `${candidate.dir.toUpperCase()}: open; ${immediate}; ${food}; ${shape}.`;
  }

  corridorCandidates() {
    return CLOCKWISE.flatMap(dir => {
      const n = this.neighbor(this.pac.r, this.pac.c, dir);
      return this.passable(n.r, n.c) ? [{ id: dir, dir, ...n }] : [];
    });
  }

  movePac() {
    const desired = this.modelDriven ? this.modelDesired : this.pac.desired;
    let dir = this.pac.dir;
    const wanted = this.neighbor(this.pac.r, this.pac.c, desired);
    if (this.passable(wanted.r, wanted.c)) dir = desired;
    const next = this.neighbor(this.pac.r, this.pac.c, dir);
    if (!this.passable(next.r, next.c)) return;
    this.pac.r = next.r; this.pac.c = next.c; this.pac.dir = dir;

    const cell = this.maze[this.pac.r][this.pac.c];
    if (cell === '.' || cell === 'o') {
      this.score += cell === 'o' ? 50 : 10;
      if (cell === 'o') this.power = 6.5;
      this.maze[this.pac.r][this.pac.c] = ' ';
      this.best = Math.max(this.best, this.score);
    }
  }

  moveGhost(g) {
    const candidates = CLOCKWISE.map(dir => ({ dir, ...this.neighbor(g.r, g.c, dir) })).filter(n => this.passable(n.r, n.c));
    if (!candidates.length) return;
    let best = null;
    for (const n of candidates) {
      const dist = Math.abs(n.r - this.pac.r) + Math.abs(n.c - this.pac.c);
      const score = this.power > 0 ? dist + this.rand() * 0.25 : -dist + this.rand() * 0.25;
      if (!best || score > best.score) best = { ...n, score };
    }
    g.r = best.r; g.c = best.c;
  }

  resolveGhostCollision() {
    for (const g of this.ghosts) {
      if (g.r !== this.pac.r || g.c !== this.pac.c) continue;
      if (this.power > 0) {
        this.score += 200;
        [g.r, g.c] = g.home;
        this.best = Math.max(this.best, this.score);
      } else { this.crash(); return true; }
    }
    return false;
  }

  update(dt, input = {}) {
    if (this.dead) {
      this.dead -= dt;
      if (this.dead <= 0 || input.restart) {
        this.dead = 0; this.pac = { r: 11, c: 9, dir: 'left', desired: 'left' }; this.modelDesired = 'left';
        this.ghosts.forEach(g => [g.r, g.c] = g.home);
      }
      return;
    }

    this.power = Math.max(0, this.power - dt);
    if (!this.modelDriven) {
      if (input.up) this.pac.desired = 'up'; else if (input.down) this.pac.desired = 'down';
      else if (input.left) this.pac.desired = 'left'; else if (input.right) this.pac.desired = 'right';
    }

    this.playerClock -= dt;
    if (this.playerClock <= 0) {
      this.playerClock += Math.max(0.072, 0.115 - this.level * 0.003);
      this.movePac();
      if (this.resolveGhostCollision()) return;
    }

    this.ghostClock -= dt;
    if (this.ghostClock <= 0) {
      this.ghostClock += Math.max(0.095, 0.17 - this.level * 0.006);
      for (const g of this.ghosts) this.moveGhost(g);
      if (this.resolveGhostCollision()) return;
    }

    if (!this.maze.some(row => row.some(cell => cell === '.' || cell === 'o'))) {
      this.level++;
      this.score += 500;
      this.best = Math.max(this.best, this.score);
      this.maze = this.buildMaze();
      this.pac = { r: 11, c: 9, dir: 'left', desired: 'left' };
      this.modelDesired = 'left';
      this.ghosts.forEach(g => [g.r, g.c] = g.home);
    }
  }

  crash() {
    if (this.dead) return;
    this.dead = 0.9; this.crashes++; this.best = Math.max(this.best, this.score);
  }

  observe() {
    const candidates = this.corridorCandidates();
    const rotation = this.optionTurn++ % candidates.length;
    const optionOrder = candidates.map((_, i) => (i + rotation) % candidates.length);
    this.lastCandidates = candidates;
    const power = this.power > 0 ? 'Power pellet active: ghosts are edible.' : 'Ghost collisions are dangerous.';
    return {
      state: [
        'Goal: eat pellets while avoiding dangerous ghosts.',
        power,
        this.ghostPositionFact(),
        ...candidates.map(candidate => this.corridorView(candidate)),
      ].join(' '),
      questions: {
        route: {
          type: 'choice',
          option_order: optionOrder,
          instructions: 'Which legal direction should Pac-Man take now?',
          criteria: Object.fromEntries(candidates.map(candidate => [candidate.dir, `move ${candidate.dir.toUpperCase()}`])),
        },
      },
    };
  }

  act(answers, params, apply) {
    const candidates = this.lastCandidates?.length ? this.lastCandidates : this.corridorCandidates();
    const requested = answers?.route?.choice;
    const chosen = candidates.find(candidate => candidate.dir === requested) || candidates.find(candidate => candidate.dir === this.pac.dir) || candidates[0];
    const absolute = chosen?.dir || this.pac.dir;
    if (apply) this.modelDesired = absolute;
    const probability = answers?.route?.probabilities?.[absolute] ?? 0;
    return { label: absolute.toUpperCase(), why: `Laya chose ${absolute} (${probability.toFixed(2)})` };
  }

  draw(ctx, w, h) {
    const cw = w / COLS, rh = h / ROWS;
    ctx.fillStyle = 'rgb(8,8,8)'; ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = this.maze[r][c], x = c * cw, y = r * rh;
      if (cell === '#') {
        ctx.fillStyle = 'rgb(62,62,62)'; ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2);
        ctx.fillStyle = 'rgb(12,12,12)'; ctx.fillRect(x + 3, y + 3, Math.max(1, cw - 6), Math.max(1, rh - 6));
      } else if (cell === '.' || cell === 'o') {
        ctx.fillStyle = cell === 'o' ? 'rgb(245,245,245)' : 'rgb(150,150,150)';
        ctx.beginPath(); ctx.arc(x + cw / 2, y + rh / 2, cell === 'o' ? Math.min(cw,rh)*0.17 : Math.max(1.4, Math.min(cw,rh)*0.055), 0, Math.PI*2); ctx.fill();
      }
    }

    const px = (this.pac.c + 0.5) * cw, py = (this.pac.r + 0.5) * rh;
    if (!(this.dead && Math.floor(this.dead * 12) % 2)) {
      const angle = { right:0, down:Math.PI/2, left:Math.PI, up:-Math.PI/2 }[this.pac.dir];
      ctx.fillStyle = 'rgb(245,245,245)'; ctx.beginPath(); ctx.moveTo(px,py);
      ctx.arc(px, py, Math.min(cw,rh)*0.34, angle + 0.45, angle + Math.PI*2 - 0.45); ctx.closePath(); ctx.fill();
    }

    for (const g of this.ghosts) {
      const gx = (g.c + 0.5) * cw, gy = (g.r + 0.5) * rh;
      const shade = this.power > 0 ? 105 : g.shade;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.beginPath(); ctx.arc(gx, gy - rh*0.04, Math.min(cw,rh)*0.3, Math.PI, 0); ctx.lineTo(gx + cw*0.3, gy + rh*0.28); ctx.lineTo(gx, gy + rh*0.18); ctx.lineTo(gx - cw*0.3, gy + rh*0.28); ctx.closePath(); ctx.fill();
    }

    ctx.fillStyle = 'rgb(145,145,145)'; ctx.font = `${Math.max(10, h * 0.027)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText(`LEVEL ${this.level}${this.power > 0 ? '   POWER' : ''}`, 14, 20);
    ctx.textAlign = 'right'; ctx.fillText('PAC-MAN / CANDIDATE CORRIDORS', w - 14, 20); ctx.textAlign = 'left';
  }
}

const demo = {
  id: 'pacman', title: 'Pac-Man', checkpoint: 'english',
  keys: 'ARROWS OR WASD TO TURN', touch: true,
  keyCodes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'],
  touchKeys: [['ArrowLeft', '←', 'Turn left'], ['ArrowUp', '↑', 'Turn up'], ['ArrowDown', '↓', 'Turn down'], ['ArrowRight', '→', 'Turn right']],
  simulationSpeed: { min: 0.5, max: 1.5, step: 0.1, value: 1 },
  blurb: 'One board state, one route choice. Every legal direction is an option; code supplies board facts but never combines them into a corridor score.',
  params: [],
  answerLabel: 'ANSWER · ROUTE',
  answerForFeed: answers => ({
    probabilities: answers?.route?.probabilities || {},
    choice: answers?.route?.choice || 'unknown',
  }),
  input: (keys, pressed) => ({
    up: keys.has('ArrowUp') || keys.has('KeyW'), down: keys.has('ArrowDown') || keys.has('KeyS'),
    left: keys.has('ArrowLeft') || keys.has('KeyA'), right: keys.has('ArrowRight') || keys.has('KeyD'),
    restart: pressed.has('Space'),
  }),
  create: seed => new Pacman(seed),
};

if (!demos.some(d => d.id === demo.id)) demos.push(demo);
export default demo;
