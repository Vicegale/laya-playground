// Game stages. Each `.game-mount[data-demo]` gets its own stage and decision feed.
//
// With the local model connected, Laya plays live: the simulation runs on a fixed timestep and
// a separate async loop asks the model for decisions. Demos may wait for a fresh answer before
// moving (Snake does); other games keep moving during inference. Without a model
// (a static deployment, or while checkpoints load) the stage replays a recorded run made by
// tools/record_run.mjs: real model decisions, reproduced step for step from a seed.
import demos from './demos/index.js';
import { Stage } from './dither.js';
import { STEP, MAX_RATE, answersFrom } from './sim.js';
import { h, bar, predict } from './ui.js';

const ROWS = ['state', 'action', 'timing'];   // the feed rows whose text, and so whose height, changes while a game runs
const TOUCH_ONLY = matchMedia('(hover: none) and (pointer: coarse)').matches;   // a phone or tablet with no keyboard

const TONES = ['#0c0c0c', '#ffc609'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRAW_INTERVAL = 1000 / 60;  // pixel dithering must not run at a high-refresh display's full rate
const keys = new Set(), pressed = new Set(), stages = [];
let health = window.layaHealth ?? null;   // null: unknown, false: no server, object: checkpoint states

class GameStage {
  constructor(mount, demo) {
    Object.assign(this, { demo, pilot: 'laya', paused: reducedMotion, ratio: 0, mode: null, run: undefined, epoch: 0, acc: 0, feedDirty: true, rowMin: {} });
    this.params = Object.fromEntries(demo.params.map(p => [p.id, p.value]));
    this.simulationRate = demo.simulationSpeed?.value ?? 1;
    this.build(mount);
    this.stage = new Stage(this.el.canvas, { w: 768, h: 432, tones: TONES });
    this.width = this.el.canvas.clientWidth;
    this.start('replay');
    fetch(`static/data/run-${demo.id}.json`).then(r => r.ok ? r.json() : null).catch(() => null).then(run => {
      this.run = run && (!demo.recordingVersion || run.recordingVersion === demo.recordingVersion) ? run : null;
      if (this.mode === 'replay') this.start('replay');
    });
    new IntersectionObserver(es => { this.ratio = es[0].isIntersecting ? es[0].intersectionRatio : 0; }, { threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(mount);
    this.decide();
  }

  build(mount) {
    const el = this.el = {}, d = this.demo, dd = k => (el[k] = h('dd', {}, '—'));
    const pick = (values, on) => { const box = h('div', { class: 'seg', role: 'group' });
      box.append(...values.map(([v, label], i) => h('button', { class: i ? '' : 'on', onclick: e => { for (const b of box.children) b.classList.toggle('on', b === e.target); on(v); } }, label))); return box; };
    const canPlay = d.touch || !TOUCH_ONLY;   // a keyboard game on a phone: do not offer a control that cannot work
    el.canvas = h('canvas', { class: 'pixelated', tabindex: 0, 'aria-label': d.title + ' game stage', onpointerdown: () => { if (this.pilot === 'you') pressed.add('pointer'); } });
    el.score = h('b', {}, '0000'); el.best = h('b', {}, '0000'); el.crashes = h('b', {}, '000'); el.msg = h('span');
    el.pause = h('button', { onclick: () => { this.paused = !this.paused; } });
    el.banner = h('p', { class: 'banner' });
    if (d.simulationSpeed) {
      const speed = d.simulationSpeed, value = h('output', {}, `${this.simulationRate.toFixed(1)}×`);
      el.speed = h('label', { class: 'game-speed' }, 'SIMULATION SPEED',
        h('input', { type: 'range', min: speed.min, max: speed.max, step: speed.step, value: this.simulationRate,
          'aria-label': d.title + ' simulation speed', oninput: e => {
            this.simulationRate = Number(e.target.value);
            value.textContent = `${this.simulationRate.toFixed(1)}×`;
          } }), value);
    }
    el.pad = d.touchKeys ? h('div', { class: 'game-pad', role: 'group', 'aria-label': d.title + ' direction controls', hidden: true },
      ...d.touchKeys.map(([code, symbol, label]) => h('button', { type: 'button', 'aria-label': label, onclick: () => {
        if (this.pilot !== 'you') return;
        pressed.add(code); el.canvas.focus({ preventScroll: true });
      } }, symbol))) : null;
    mount.append(
      h('div', {},
        h('div', { class: 'stage' }, el.canvas, el.banner,
          h('div', { class: 'hud' }, h('span', {}, 'SCORE ', el.score), h('span', {}, 'BEST ', el.best), h('span', { class: 'sp' }), h('span', {}, 'CRASHES ', el.crashes)),
          h('div', { class: 'stage-msg' }, el.msg)),
        h('div', { class: 'controls' }, canPlay && pick([['laya', 'LAYA PLAYS'], ['you', 'YOU PLAY']], v => { this.pilot = v; el.canvas.focus({ preventScroll: true }); }), el.pause, h('span', { class: 'keys' }, canPlay ? d.keys : 'PLAY IT YOURSELF ON A KEYBOARD')), el.speed, el.pad),
      h('dl', { class: 'feed' },
        h('dt', {}, 'SOURCE'), dd('source'), h('dt', {}, 'STATE SENT'), dd('state'), h('dt', {}, 'QUESTION'), dd('question'),
        ...(d.showCriteria ? [h('dt', {}, 'OPTIONS SENT'), dd('criteria')] : []),
        h('dt', {}, d.answerLabel || 'ANSWER'), dd('bars'), h('dt', {}, 'ACTION'), dd('action'), h('dt', {}, 'TIMING'), dd('timing')));
  }

  // ---------------------------------------------------------------- modes
  ready() { return !!health && health.models[this.demo.checkpoint] === 'ready'; }
  wantMode() { return this.pilot === 'you' ? 'you' : this.ready() ? 'live' : 'replay'; }

  start(mode) {
    this.mode = mode; this.epoch++; this.step = 0; this.ri = 0; this.pending = null; this.acc = 0;
    this.feed = null; this.feedDirty = true; this.stamps = []; this.count = 0; this.lat = { model: 0, rtt: 0 }; this.error = '';
    const seed = mode === 'replay' && this.run ? this.run.seed : (Math.random() * 2 ** 32) >>> 0;
    this.inst = this.demo.create(seed);
    this.inst.setModelDriven?.(mode !== 'you');
  }

  tick(input) {
    if (this.mode === 'replay') {
      const d = this.run.decisions;
      if (this.pending && d[this.ri][1] === this.step) {
        const rec = d[this.ri++], answers = answersFrom(this.pending, rec[2]);
        this.note(this.pending, answers, this.inst.act(answers, this.run.params, true), rec[3]);
        this.pending = null;
      }
      if (!this.pending && this.ri < d.length && d[this.ri][0] === this.step) this.pending = this.inst.observe();
    }
    this.inst.update(STEP, input); this.step++;
    if (this.mode === 'replay' && this.step >= this.run.steps) this.start('replay');   // loop the recording
  }

  note(obs, answers, action, ms, rtt) {
    const k = this.count++ ? 0.12 : 1;
    this.lat.model += (ms - this.lat.model) * k; if (rtt != null) this.lat.rtt += (rtt - this.lat.rtt) * k;
    this.stamps.push(this.step); while (this.stamps[0] < this.step - 1 / STEP) this.stamps.shift();
    this.feed = { obs, answers, action }; this.feedDirty = true;
  }

  async decide() {   // live mode only: one request in flight, as fast as the model answers
    for (;;) {
      if (this.mode !== 'live' || !this.active || this.paused || this.inst.dead || document.hidden) { await sleep(80); continue; }   // never call the model for a page nobody is watching
      if (this.inst.needsDecision && !this.inst.needsDecision()) { await sleep(10); continue; }
      const mine = this.epoch, obs = this.inst.observe(), t0 = performance.now();
      let res;
      try { res = await predict({ state: obs.state, questions: obs.questions, model: this.demo.checkpoint }); this.error = ''; }
      catch (e) { this.error = e.message; this.feedDirty = true; await sleep(1000); continue; }
      const rtt = performance.now() - t0;
      if (mine !== this.epoch) continue;   // restarted while this was in flight
      this.note(obs, res.answers, this.inst.act(res.answers, this.params, !this.paused), res.latency_ms, rtt);
      if (rtt < 1000 / MAX_RATE) await sleep(1000 / MAX_RATE - rtt);
    }
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, active, now) {
    this.active = active;
    const want = this.wantMode();
    if (want !== this.mode) this.start(want);
    const playable = this.mode !== 'replay' || this.run;
    if (active && !this.paused && playable) {
      // Scale only simulation time; live inference continues at its wall-clock pace.
      this.acc += dt * this.simulationRate;
      const input = this.mode === 'you' ? this.demo.input(keys, pressed) : {};
      let stepped = false;
      while (this.acc >= STEP) { this.tick(input); this.acc -= STEP; stepped = true; for (const k in input) input[k] = false; }
      if (stepped) pressed.clear();   // a frame with no step (displays faster than the timestep) keeps the press for the next one
    }
    if (!active && this.drawn) return;   // off-stage: keep the last frame, but never leave the canvas blank
    if (this.drawn && now - this.lastDraw < DRAW_INTERVAL - 0.5) return;
    this.lastDraw = now;
    this.drawn = true;
    const { el, inst } = this;
    inst.draw(this.stage.ctx, this.stage.w, this.stage.h); this.stage.present();
    el.score.textContent = String(inst.score).padStart(4, '0');
    el.best.textContent = String(inst.best).padStart(4, '0');
    el.crashes.textContent = String(inst.crashes).padStart(3, '0');
    el.pause.textContent = this.paused ? (this.step ? 'RESUME' : 'START') : 'PAUSE';
    if (el.pad) el.pad.hidden = this.pilot !== 'you';
    el.msg.textContent = this.paused ? 'PAUSED' : inst.won ? 'BOARD CLEARED' : inst.dead ? 'CRASH' : this.error ? 'MODEL UNREACHABLE'
      : !playable ? (this.run === null ? 'RUNS WITH THE LOCAL MODEL' : 'LOADING') : '';
    this.renderBanner();
    if (this.feedDirty) this.renderFeed();
  }

  // What is on screen: a recording on the public site, a recording while local checkpoints load, or the live model.
  // Only the public recording points at running it locally; everyone else already is.
  renderBanner() {
    const local = health !== false && health !== null, text = this.mode === 'live' ? 'Live. The model on this machine is playing.'
      : this.mode === 'you' ? 'You are playing. Same physics, no model.'
      : local ? 'Recorded run. The model is loading and will take over shortly.'
      : 'Recorded run: real decisions, replayed.';
    if (this.bannerText === text) return;
    this.bannerText = text;
    this.el.banner.replaceChildren(text, ...(this.mode === 'replay' && !local ? [' ', h('a', { class: 'nw', href: './#run-it' }, 'Run it locally'), ' to watch it play\u00a0live.'] : []));
    this.el.banner.classList.toggle('live', this.mode === 'live');
  }

  renderFeed() {
    this.feedDirty = false;
    const { el, run } = this;
    el.source.textContent = this.mode === 'live' ? `live model · ${this.demo.checkpoint} checkpoint`
      : this.mode === 'you' ? 'you are playing · the model is idle'
      : run ? `recorded run · ${run.machine} ·\u00a0${run.recorded.replace(/-/g, '\u2011')}` : '—';
    if (!this.feed) { for (const k of ['state', 'question', 'criteria', 'action', 'timing']) if (el[k]) el[k].textContent = '—'; return el.bars.replaceChildren(); }
    const { obs, answers, action } = this.feed, [qid, q] = Object.entries(obs.questions)[0];
    const a = this.demo.answerForFeed ? this.demo.answerForFeed(answers) : answers[qid];
    el.state.textContent = typeof obs.state === 'string' ? obs.state : JSON.stringify(obs.state);
    el.question.textContent = q.instructions;
    if (el.criteria) el.criteria.replaceChildren(...Object.entries(q.criteria).map(([key, description]) =>
      h('div', {}, `${key}: ${description}`)));
    el.bars.replaceChildren(...Object.entries(a.probabilities).map(([k, p]) => bar(k, p, k === a.choice)));
    el.action.replaceChildren(h('b', {}, action.label), h('span', { class: 'why' }, action.why));
    const rateUnit = this.demo.simulationSpeed ? 'decisions per simulation second' : 'decisions a second';
    el.timing.textContent = `${this.lat.model.toFixed(1)} ms per decision · ${this.stamps.length} ${rateUnit} · ${this.count} so far`;
    // These rows change on every decision. One may grow to fit a longer sentence, but it never shrinks back:
    // otherwise everything under it jumps thirty times a second.
    for (const k of ROWS) { const tall = el[k].offsetHeight; if (tall > (this.rowMin[k] || 0)) el[k].style.minHeight = (this.rowMin[k] = tall) + 'px'; }
  }
}

// ------------------------------------------------------------------ input goes to the stage in view while YOU play
const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
addEventListener('keydown', e => {
  const s = stages.find(s => s.active);
  if (!s || s.pilot !== 'you' || typing(e) || !(s.demo.keyCodes || ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']).includes(e.code)) return;
  e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code === 'ArrowUp' && s.demo.id === 'flappy' ? 'Space' : e.code).add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); pressed.clear(); });   // a key held while switching apps would otherwise stay held

// ------------------------------------------------------------------ one loop for every stage; only the most visible one runs
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (document.hidden) return;
  const top = stages.reduce((a, s) => (s.ratio > (a ? a.ratio : 0) ? s : a), null);
  for (const s of stages) s.frame(dt, s === top && s.ratio > 0, now);
}

addEventListener('laya:health', e => { health = e.detail; });
addEventListener('resize', () => stages.forEach(s => {   // phones fire resize whenever the URL bar moves
  const w = s.el.canvas.clientWidth; if (w === s.width) return;
  s.width = w; s.stage.layout(); s.drawn = false;
  s.rowMin = {}; for (const k of ROWS) s.el[k].style.minHeight = ''; s.feedDirty = true;   // the text wraps differently now: measure the rows again
}));
for (const mount of document.querySelectorAll('.game-mount')) {
  const demo = demos.find(d => d.id === mount.dataset.demo);
  if (demo) stages.push(new GameStage(mount, demo));
}
requestAnimationFrame(loop);
