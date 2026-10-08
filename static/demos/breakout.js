import demos from './index.js';
import { clamp, installGameSection, seeded } from './perception.js';

const W = 100, H = 100;
const PADDLE_Y = 91, PADDLE_HALF = 10, PADDLE_SPEED = 52;
const BALL_R = 1.65, BALL_SPEED = 41;
const BRICK_COLS = 10, BRICK_ROWS = 6, BRICK_W = 8.2, BRICK_H = 4.1, BRICK_GAP = 1.1;
const PADDLE_CANDIDATES = [
  { id: 'left', label: 'MOVE LEFT', description: 'move the paddle left now', move: -1 },
  { id: 'hold', label: 'HOLD', description: 'keep the paddle where it is now', move: 0 },
  { id: 'right', label: 'MOVE RIGHT', description: 'move the paddle right now', move: 1 },
];

function horizontalRelation(dx) {
  if (Math.abs(dx) <= 3.2) return 'centered over the paddle';
  const distance = Math.abs(dx) <= 11 ? 'slightly' : 'far';
  return dx < 0 ? `${distance} left of the paddle` : `${distance} right of the paddle`;
}

function heightBand(ballY) {
  const distance = PADDLE_Y - ballY;
  if (distance < 17) return 'close';
  if (distance < 42) return 'moderate';
  return 'far';
}

function motionPhrase(ball) {
  const vertical = ball.vy > 0 ? 'downward' : 'upward';
  if (Math.abs(ball.vx) < 4) return `${vertical}, almost straight`;
  return `${vertical} and ${ball.vx < 0 ? 'left' : 'right'}`;
}

installGameSection({
  id: 'breakout', navLabel: 'Breakout',
  titleHtml: 'See the board.<br>Choose the paddle move.',
  lead: 'Breakout gives Laya only the ball facts that matter for the next paddle move, then asks it to choose directly between the legal controls. JavaScript handles collisions and turns numbers into qualitative relations, but it does not predict the landing point.',
  sees: 'The ball’s horizontal relation to the paddle, its vertical distance, and its current motion. Absolute screen position and unrelated wall facts are omitted unless they change which controls are legal.',
  controls: 'Move with left/right or A/D. LEFT, HOLD and RIGHT are the actual Laya options; the returned choice is applied directly.',
});

export class Breakout {
  constructor(seed) {
    this.rand = seeded(seed);
    this.best = 0;
    this.crashes = 0;
    this.level = 1;
    this.optionTurn = 0;
    this.reset(true);
  }

  reset(first = false) {
    if (!first) this.level = 1;
    this.score = 0;
    this.dead = 0;
    this.cleared = 0;
    this.paddleX = W / 2;
    this.paddleMove = 0;
    this.spawnBricks();
    this.serve();
  }

  spawnBricks() {
    this.bricks = [];
    const total = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP;
    const startX = (W - total) / 2;
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS; col++) {
        this.bricks.push({
          x: startX + col * (BRICK_W + BRICK_GAP),
          y: 14 + row * (BRICK_H + 1.0),
          w: BRICK_W, h: BRICK_H, alive: true, row,
        });
      }
    }
  }

  serve() {
    const dir = this.rand() < 0.5 ? -1 : 1;
    this.ball = { x: W / 2, y: 73, vx: dir * BALL_SPEED * 0.52, vy: -BALL_SPEED * 0.85 };
  }

  setModelDriven(enabled) { this.modelDriven = enabled; if (!enabled) this.paddleMove = 0; }

  collideBrick(ball, brick) {
    return brick.alive && ball.x + BALL_R >= brick.x && ball.x - BALL_R <= brick.x + brick.w &&
      ball.y + BALL_R >= brick.y && ball.y - BALL_R <= brick.y + brick.h;
  }

  physicsStep(ball, dt, bricks, mutateScore = false) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R < 1) { ball.x = 1 + BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.x + BALL_R > W - 1) { ball.x = W - 1 - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y - BALL_R < 5) { ball.y = 5 + BALL_R; ball.vy = Math.abs(ball.vy); }

    for (const brick of bricks) {
      if (!this.collideBrick(ball, brick)) continue;
      const prevX = ball.x - ball.vx * dt, prevY = ball.y - ball.vy * dt;
      const wasLeft = prevX + BALL_R <= brick.x;
      const wasRight = prevX - BALL_R >= brick.x + brick.w;
      if (wasLeft || wasRight) ball.vx *= -1;
      else ball.vy *= -1;
      brick.alive = false;
      if (mutateScore) {
        this.score += 10 + (BRICK_ROWS - 1 - brick.row) * 2;
        this.best = Math.max(this.best, this.score);
      }
      break;
    }
  }

  update(dt, input = {}) {
    if (this.dead) {
      this.dead -= dt;
      if (this.dead <= 0 || input.restart) { this.dead = 0; this.paddleX = W / 2; this.serve(); }
      return;
    }
    if (this.cleared) {
      this.cleared -= dt;
      if (this.cleared <= 0) { this.cleared = 0; this.level++; this.spawnBricks(); this.serve(); }
      return;
    }

    const move = this.modelDriven ? this.paddleMove : (input.left === input.right ? 0 : input.left ? -1 : 1);
    this.paddleX = clamp(this.paddleX + move * PADDLE_SPEED * dt, PADDLE_HALF + 1, W - PADDLE_HALF - 1);

    const beforeY = this.ball.y;
    this.physicsStep(this.ball, dt, this.bricks, true);

    if (this.ball.vy > 0 && beforeY + BALL_R <= PADDLE_Y - 1.8 && this.ball.y + BALL_R >= PADDLE_Y - 1.8 && Math.abs(this.ball.x - this.paddleX) <= PADDLE_HALF + BALL_R) {
      const hit = clamp((this.ball.x - this.paddleX) / PADDLE_HALF, -1, 1);
      const speed = BALL_SPEED * (1 + Math.min(0.22, (this.level - 1) * 0.035));
      this.ball.vx = speed * hit * 0.86 + this.ball.vx * 0.25;
      this.ball.vy = -Math.sqrt(Math.max(speed * speed * 0.55, speed * speed - this.ball.vx * this.ball.vx));
      this.ball.y = PADDLE_Y - 1.8 - BALL_R;
    }

    if (this.ball.y - BALL_R > H) {
      this.crashes++;
      this.dead = 0.75;
      this.best = Math.max(this.best, this.score);
      this.paddleMove = 0;
    }

    if (!this.bricks.some(b => b.alive)) {
      this.score += 100;
      this.best = Math.max(this.best, this.score);
      this.cleared = 0.7;
    }
  }

  legalActions() {
    return PADDLE_CANDIDATES.filter(candidate => {
      if (candidate.move < 0) return this.paddleX > PADDLE_HALF + 1.5;
      if (candidate.move > 0) return this.paddleX < W - PADDLE_HALF - 1.5;
      return true;
    });
  }

  observe() {
    const candidates = this.legalActions();
    const rotation = this.optionTurn++ % candidates.length;
    const optionOrder = candidates.map((_, i) => (i + rotation) % candidates.length);
    this.lastCandidates = candidates;
    const state = [
      'Goal: catch the ball with the paddle.',
      `Ball relative to paddle: ${horizontalRelation(this.ball.x - this.paddleX)}.`,
      `Vertical distance: ${heightBand(this.ball.y)}.`,
      `Ball motion: ${motionPhrase(this.ball)}.`,
    ].join(' ');
    return {
      state,
      questions: {
        move: {
          type: 'choice',
          option_order: optionOrder,
          instructions: 'Which paddle control best positions the paddle to catch the ball?',
          criteria: Object.fromEntries(candidates.map(candidate => [candidate.id, candidate.description])),
        },
      },
    };
  }

  act(answers, params, apply) {
    const candidates = this.lastCandidates?.length ? this.lastCandidates : this.legalActions();
    const requested = answers?.move?.choice;
    const chosen = candidates.find(candidate => candidate.id === requested) || candidates.find(candidate => candidate.id === 'hold') || candidates[0];
    if (apply) this.paddleMove = chosen?.move ?? 0;
    const probability = chosen ? (answers?.move?.probabilities?.[chosen.id] ?? 0) : 0;
    return {
      label: chosen?.label || 'HOLD',
      why: chosen ? `Laya chose ${chosen.id} (${probability.toFixed(2)})` : 'no legal move',
    };
  }

  draw(ctx, w, h) {
    const sx = v => v / W * w, sy = v => v / H * h;
    ctx.fillStyle = 'rgb(8,8,8)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgb(55,55,55)'; ctx.lineWidth = 1; ctx.strokeRect(sx(1), sy(5), sx(98), sy(91));

    for (const b of this.bricks) if (b.alive) {
      const shade = 238 - b.row * 18;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(sx(b.x), sy(b.y), sx(b.w), sy(b.h));
    }

    ctx.fillStyle = 'rgb(245,245,245)';
    ctx.fillRect(sx(this.paddleX - PADDLE_HALF), sy(PADDLE_Y), sx(PADDLE_HALF * 2), Math.max(4, sy(2.4)));
    ctx.beginPath(); ctx.arc(sx(this.ball.x), sy(this.ball.y), Math.max(3, sx(BALL_R)), 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgb(145,145,145)'; ctx.font = `${Math.max(10, h * 0.028)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText(`LEVEL ${this.level}   BRICKS ${this.bricks.filter(b => b.alive).length}`, 16, 22);
    ctx.textAlign = 'right'; ctx.fillText('BREAKOUT / CANDIDATE POSITIONS', w - 16, 22); ctx.textAlign = 'left';
  }
}

const demo = {
  id: 'breakout', title: 'Breakout', checkpoint: 'english',
  keys: '← / → OR A / D TO MOVE', touch: true,
  keyCodes: ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'],
  touchKeys: [['ArrowLeft', '←', 'Move left'], ['ArrowRight', '→', 'Move right']],
  simulationSpeed: { min: 0.5, max: 1.5, step: 0.1, value: 1 },
  blurb: 'One board state, one choice. LEFT, HOLD and RIGHT are the actual options; JavaScript does not rank them or predict the future landing point.',
  params: [],
  answerLabel: 'ANSWER · PADDLE ACTION',
  answerForFeed: answers => ({
    probabilities: answers?.move?.probabilities || {},
    choice: answers?.move?.choice || 'unknown',
  }),
  input: (keys, pressed) => ({
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    restart: pressed.has('Space'),
  }),
  create: seed => new Breakout(seed),
};

if (!demos.some(d => d.id === demo.id)) demos.push(demo);
export default demo;
