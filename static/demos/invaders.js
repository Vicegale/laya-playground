import demos from './index.js';
// Space Invaders gives Laya one compact board state and one choice whose options
// are the actual legal controls, including move+fire combinations when firing is ready.

const WORLD_W = 100, WORLD_H = 100;
const PLAYER_Y = 91.5, PLAYER_SPEED = 42, PLAYER_HALF_W = 4.3;
const BULLET_SPEED = 65, ENEMY_BULLET_SPEED = 31, FIRE_COOLDOWN = 0.28;
const COLS = 9, ROWS = 5, COL_GAP = 8.5, ROW_GAP = 6.5;
const ALIEN_HALF_W = 2.65, ALIEN_HALF_H = 2.05;
const MOVES = [
  { id: 'left', move: -1 },
  { id: 'hold', move: 0 },
  { id: 'right', move: 1 },
];

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function installSection() {
  if (typeof document === 'undefined' || document.getElementById('invaders')) return;
  const checkpoint = document.getElementById('checkpoint');
  if (!checkpoint) return;

  const section = document.createElement('section');
  section.className = 'block';
  section.id = 'invaders';
  section.innerHTML = `
    <div class="head">
      <h2>See the formation.<br>Choose the control.</h2>
      <div class="aside"><p class="lead">Space Invaders gives Laya only the formation and incoming-shot facts that matter for the next control, then asks it to choose directly from the legal controls. JavaScript does not select a target alien, dodge direction or firing lane first.</p></div>
    </div>
    <div class="live game-mount" data-demo="invaders"></div>
    <div class="qa">
      <div><h3>What does Laya see?</h3>
        <p>Exposed invaders relative to the cannon, formation height and motion, and enemy shots close enough to affect the next move. Absolute cannon position and weapon cooldown text are omitted because the legal options already encode those constraints.</p></div>
      <div><h3>What does the player control?</h3>
        <p>Move with left/right or A/D and fire with Space. LEFT, HOLD and RIGHT — with FIRE variants when the weapon is ready — are the actual Laya options. Its returned choice is executed directly.</p></div>
    </div>`;
  checkpoint.before(section);

  const nav = document.querySelector('nav.index');
  const checkpointLink = nav?.querySelector('a[href="./#checkpoint"]');
  if (checkpointLink && !nav.querySelector('a[href="./#invaders"]')) {
    const link = document.createElement('a');
    link.href = './#invaders'; link.textContent = 'Invaders';
    checkpointLink.before(link);
  }
}
installSection();

export class Invaders {
  constructor(seed) {
    this.rand = seeded(seed);
    this.best = 0;
    this.crashes = 0;
    this.wave = 1;
    this.optionTurn = 0;
    this.stars = Array.from({ length: 72 }, () => ({ x: this.rand() * WORLD_W, y: this.rand() * 83, a: 45 + this.rand() * 80 }));
    this.reset(true);
  }

  reset(first = false) {
    if (!first) this.wave = 1;
    this.score = 0;
    this.dead = 0;
    this.won = 0;
    this.playerX = WORLD_W / 2;
    this.playerMove = 0;
    this.fireCool = 0;
    this.enemyShotClock = 0.7;
    this.playerBullets = [];
    this.enemyBullets = [];
    this.spawnWave();
  }

  spawnWave() {
    this.aliens = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) this.aliens.push({ row, col, alive: true });
    this.formationX = 16;
    this.formationY = 13;
    this.formationDir = 1;
    this.enemyBullets.length = 0;
    this.playerBullets.length = 0;
    this.enemyShotClock = Math.max(0.3, 0.9 - this.wave * 0.05);
  }

  setModelDriven(enabled) { this.modelDriven = enabled; if (!enabled) this.playerMove = 0; }
  alienX(a) { return this.formationX + a.col * COL_GAP; }
  alienY(a) { return this.formationY + a.row * ROW_GAP; }
  alive() { return this.aliens.filter(a => a.alive); }

  exposedAliens() {
    return this.aliens.filter(a => a.alive && !this.aliens.some(b => b.alive && b.col === a.col && b.row > a.row));
  }

  update(dt, input = {}) {
    if (this.dead) {
      this.dead -= dt;
      if (this.dead <= 0 || input.restart) this.reset();
      return;
    }
    if (this.won) {
      this.won -= dt;
      if (this.won <= 0) { this.won = 0; this.wave++; this.spawnWave(); }
      return;
    }

    this.fireCool = Math.max(0, this.fireCool - dt);
    let move = this.modelDriven ? this.playerMove : (input.left === input.right ? 0 : input.left ? -1 : 1);
    this.playerX = clamp(this.playerX + move * PLAYER_SPEED * dt, PLAYER_HALF_W + 1, WORLD_W - PLAYER_HALF_W - 1);
    if (!this.modelDriven && input.fire) this.fire();

    const living = this.alive();
    if (!living.length) { this.won = 0.75; this.best = Math.max(this.best, this.score); return; }

    const speed = 4.8 + this.wave * 0.55 + (COLS * ROWS - living.length) * 0.09;
    const left = Math.min(...living.map(a => this.alienX(a) - ALIEN_HALF_W));
    const right = Math.max(...living.map(a => this.alienX(a) + ALIEN_HALF_W));
    const step = this.formationDir * speed * dt;
    if (left + step < 2 || right + step > WORLD_W - 2) {
      this.formationDir *= -1;
      this.formationY += 3.6;
    } else this.formationX += step;

    if (living.some(a => this.alienY(a) + ALIEN_HALF_H >= PLAYER_Y - 5)) return this.crash();

    for (const b of this.playerBullets) b.y -= BULLET_SPEED * dt;
    for (const b of this.enemyBullets) b.y += ENEMY_BULLET_SPEED * dt;

    for (const bullet of this.playerBullets) {
      if (bullet.dead) continue;
      for (const alien of this.aliens) {
        if (!alien.alive) continue;
        if (Math.abs(bullet.x - this.alienX(alien)) <= ALIEN_HALF_W && Math.abs(bullet.y - this.alienY(alien)) <= ALIEN_HALF_H) {
          bullet.dead = true; alien.alive = false;
          this.score += 10 + (ROWS - 1 - alien.row) * 5;
          this.best = Math.max(this.best, this.score);
          break;
        }
      }
    }
    this.playerBullets = this.playerBullets.filter(b => !b.dead && b.y > -3);

    for (const bullet of this.enemyBullets) {
      if (bullet.y >= PLAYER_Y - 2.1 && bullet.y <= PLAYER_Y + 2.5 && Math.abs(bullet.x - this.playerX) <= PLAYER_HALF_W) return this.crash();
    }
    this.enemyBullets = this.enemyBullets.filter(b => b.y < WORLD_H + 4);

    this.enemyShotClock -= dt;
    if (this.enemyShotClock <= 0) {
      this.enemyShotClock = Math.max(0.22, 0.86 - this.wave * 0.05) * (0.65 + this.rand() * 0.9);
      const shooters = this.exposedAliens();
      if (shooters.length) {
        const shooter = shooters[this.rand() * shooters.length | 0];
        this.enemyBullets.push({ x: this.alienX(shooter), y: this.alienY(shooter) + 2.5 });
      }
    }
  }

  fire() {
    if (!this.canFire()) return false;
    this.playerBullets.push({ x: this.playerX, y: PLAYER_Y - 4.2 });
    this.fireCool = FIRE_COOLDOWN;
    return true;
  }

  crash() {
    if (!this.dead) {
      this.dead = 1.1;
      this.crashes++;
      this.best = Math.max(this.best, this.score);
      this.playerMove = 0;
    }
  }

  canFire() {
    return !this.dead && !this.won && this.fireCool <= 0 && this.playerBullets.length < 2;
  }

  formationFact() {
    const exposed = this.exposedAliens();
    if (!exposed.length) return 'Invaders: none exposed.';
    const offsets = exposed.map(alien => this.alienX(alien) - this.playerX);
    const band = distance => distance <= 8 ? 'near' : distance <= 18 ? 'moderate distance' : 'far';
    const aligned = offsets.some(dx => Math.abs(dx) <= 3);
    const left = offsets.filter(dx => dx < -3).map(Math.abs).sort((a,b)=>a-b)[0];
    const right = offsets.filter(dx => dx > 3).sort((a,b)=>a-b)[0];
    const lowest = Math.max(...exposed.map(alien => this.alienY(alien)));
    const remaining = PLAYER_Y - lowest;
    const height = remaining < 35 ? 'low' : remaining < 55 ? 'mid-height' : 'high';
    return [
      `Invaders: ${aligned ? 'an exposed invader is directly above the cannon' : 'no exposed invader is directly above the cannon'}.`,
      `Nearest exposed invader on the left: ${left == null ? 'none' : band(left)}.`,
      `Nearest exposed invader on the right: ${right == null ? 'none' : band(right)}.`,
      `Formation: ${height}, moving ${this.formationDir < 0 ? 'left' : 'right'}.`,
    ].join(' ');
  }

  enemyShotFact() {
    const shots = this.enemyBullets
      .map(shot => ({ dy: PLAYER_Y - shot.y, dx: shot.x - this.playerX }))
      .filter(item => item.dy >= -2 && item.dy <= 30);
    if (!shots.length) return 'Enemy shots: none near cannon height.';
    const verticalBand = dy => dy < 8 ? 'very close' : dy < 18 ? 'approaching' : 'well above';
    const nearest = list => list.sort((a,b)=>a.dy-b.dy)[0];
    const aligned = nearest(shots.filter(item => Math.abs(item.dx) <= PLAYER_HALF_W + 1));
    const left = nearest(shots.filter(item => item.dx < -(PLAYER_HALF_W + 1)));
    const right = nearest(shots.filter(item => item.dx > PLAYER_HALF_W + 1));
    const parts = [];
    if (aligned) parts.push(`directly above ${verticalBand(aligned.dy)}`);
    if (left) parts.push(`left side ${verticalBand(left.dy)}`);
    if (right) parts.push(`right side ${verticalBand(right.dy)}`);
    return `Enemy shots: ${parts.join('; ')}.`;
  }

  actionCandidates() {
    const moves = MOVES.filter(candidate => {
      if (candidate.move < 0) return this.playerX > PLAYER_HALF_W + 1.5;
      if (candidate.move > 0) return this.playerX < WORLD_W - PLAYER_HALF_W - 1.5;
      return true;
    });
    const actions = moves.map(candidate => ({ ...candidate, fire: false, id: candidate.id, label: candidate.id.toUpperCase() }));
    if (this.canFire()) {
      for (const candidate of moves) actions.push({
        ...candidate,
        fire: true,
        id: `${candidate.id}_fire`,
        label: `${candidate.id.toUpperCase()} + FIRE`,
      });
    }
    return actions;
  }

  observe() {
    const candidates = this.actionCandidates();
    const rotation = this.optionTurn++ % candidates.length;
    const optionOrder = candidates.map((_, i) => (i + rotation) % candidates.length);
    this.lastActionCandidates = candidates;
    return {
      state: [
        'Goal: destroy the invaders while avoiding incoming enemy shots.',
        this.formationFact(),
        this.enemyShotFact(),
      ].join(' '),
      questions: {
        action: {
          type: 'choice',
          option_order: optionOrder,
          instructions: 'Which legal cannon control should be used now?',
          criteria: Object.fromEntries(candidates.map(candidate => [
            candidate.id,
            candidate.fire
              ? `${candidate.move < 0 ? 'move left' : candidate.move > 0 ? 'move right' : 'hold position'} and fire now`
              : `${candidate.move < 0 ? 'move left' : candidate.move > 0 ? 'move right' : 'hold position'} without firing`,
          ])),
        },
      },
    };
  }

  act(answers, params, apply) {
    const candidates = this.lastActionCandidates?.length ? this.lastActionCandidates : this.actionCandidates();
    const requested = answers?.action?.choice;
    const chosen = candidates.find(candidate => candidate.id === requested) || candidates.find(candidate => candidate.id === 'hold') || candidates[0];
    if (apply) {
      this.playerMove = chosen?.move ?? 0;
      if (chosen?.fire) this.fire();
    }
    const probability = chosen ? (answers?.action?.probabilities?.[chosen.id] ?? 0) : 0;
    return {
      label: chosen?.label || 'HOLD',
      why: chosen ? `Laya chose ${chosen.id} (${probability.toFixed(2)})` : 'no legal action',
    };
  }

  draw(ctx, w, h) {
    const x = v => v / WORLD_W * w, y = v => v / WORLD_H * h;
    ctx.fillStyle = 'rgb(8,8,8)'; ctx.fillRect(0, 0, w, h);

    for (const s of this.stars) {
      ctx.fillStyle = `rgb(${s.a | 0},${s.a | 0},${s.a | 0})`;
      ctx.fillRect(x(s.x), y(s.y), 1, 1);
    }
    ctx.strokeStyle = 'rgb(76,76,76)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(96)); ctx.lineTo(w, y(96)); ctx.stroke();

    for (const alien of this.aliens) if (alien.alive) this.drawAlien(ctx, x(this.alienX(alien)), y(this.alienY(alien)), alien.row, w, h);

    ctx.fillStyle = 'rgb(245,245,245)';
    for (const b of this.playerBullets) ctx.fillRect(x(b.x) - 1.5, y(b.y) - 5, 3, 10);
    ctx.fillStyle = 'rgb(175,175,175)';
    for (const b of this.enemyBullets) { ctx.fillRect(x(b.x) - 1.5, y(b.y) - 4, 3, 9); ctx.fillRect(x(b.x) - 4, y(b.y), 8, 2); }

    if (!(this.dead && Math.floor(this.dead * 12) % 2)) this.drawPlayer(ctx, x(this.playerX), y(PLAYER_Y));

    ctx.fillStyle = 'rgb(145,145,145)'; ctx.font = `${Math.max(10, h * 0.028)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText(`WAVE ${this.wave}   INVADERS ${this.alive().length}`, 16, 22);
    ctx.textAlign = 'right'; ctx.fillText('SPACE INVADERS / CANDIDATE CONTROLS', w - 16, 22); ctx.textAlign = 'left';
  }

  drawPlayer(ctx, cx, cy) {
    ctx.fillStyle = 'rgb(245,245,245)';
    ctx.fillRect(cx - 20, cy - 5, 40, 11);
    ctx.fillRect(cx - 13, cy - 11, 26, 7);
    ctx.fillRect(cx - 3, cy - 17, 6, 7);
  }

  drawAlien(ctx, cx, cy, row, w, h) {
    const sprites = [
      ['0011100','0111110','1101011','1111111','0101010'],
      ['0111110','1101011','1111111','0011100','0100010'],
      ['0011100','0111110','1101011','1111111','1010101'],
    ];
    const sprite = sprites[Math.min(2, row >> 1)], px = Math.max(2, Math.round(w / 310)), py = Math.max(2, Math.round(h / 205));
    ctx.fillStyle = row === 0 ? 'rgb(245,245,245)' : row < 3 ? 'rgb(215,215,215)' : 'rgb(185,185,185)';
    const sw = sprite[0].length * px, sh = sprite.length * py;
    for (let yy = 0; yy < sprite.length; yy++) for (let xx = 0; xx < sprite[yy].length; xx++) if (sprite[yy][xx] === '1') {
      ctx.fillRect(Math.round(cx - sw / 2 + xx * px), Math.round(cy - sh / 2 + yy * py), px, py);
    }
  }
}

const demo = {
  id: 'invaders', title: 'Space Invaders', checkpoint: 'english',
  keys: '← / → OR A / D TO MOVE · SPACE TO FIRE', touch: true,
  keyCodes: ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'],
  touchKeys: [['ArrowLeft', '←', 'Move left'], ['Space', '●', 'Fire'], ['ArrowRight', '→', 'Move right']],
  simulationSpeed: { min: 0.5, max: 1.5, step: 0.1, value: 1 },
  blurb: 'One board state, one control choice. The legal options are LEFT/HOLD/RIGHT and their FIRE variants when firing is available; JavaScript never ranks lanes or selects a target first.',
  params: [],
  answerLabel: 'ANSWER · CONTROL',
  answerForFeed: answers => ({
    probabilities: answers?.action?.probabilities || {},
    choice: answers?.action?.choice || 'unknown',
  }),
  input: (keys, pressed) => ({
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    fire: pressed.has('Space') || pressed.has('pointer'),
    restart: pressed.has('Space'),
  }),
  create: seed => new Invaders(seed),
};

if (!demos.some(d => d.id === demo.id)) demos.push(demo);
export default demo;
