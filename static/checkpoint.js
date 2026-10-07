import { h, bar, predict } from './ui.js';
import { health, onHealth } from './health.js';
import { PURPOSE_LABELS, RULES, translateDocuments, requestPayload, fingerprint, decideAdmission, gradeDecision } from './demos/checkpoint.js';
import { createShift, MAX_SHIFT_SIZE } from './demos/checkpoint-generator.js';
import { InspectionThroughput } from './demos/checkpoint-throughput.js';
import { InspectionHistory, HISTORY_LIMIT } from './demos/checkpoint-history.js';
import { LEVELS, DOCUMENTS, CITIES, LABELS, printedDocument } from './demos/checkpoint-levels.js';

const DECISIONS = { approve: 'Approved', deny: 'Denied', review: 'Review' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freshSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-');

function field(label, value, path) {
  return h('div', { class: 'cp-field', 'data-field': path }, h('dt', {}, label), h('dd', {}, value || '—'));
}

function portrait(index) {
  return h('div', { class: 'cp-portrait', 'aria-hidden': 'true', style: `--portrait-shift:${index % 3 * 3}px` },
    h('i', { class: 'cp-head' }), h('i', { class: 'cp-body' }), h('span', {}, 'ID / ' + String(index + 1).padStart(2, '0')));
}

export class Checkpoint {
  constructor(root) {
    this.root = root;
    this.position = 0; this.version = 0; this.mode = 'laya'; this.busy = false; this.auto = false;
    this.score = 0; this.cleared = 0; this.citations = 0; this.reviews = 0; this.visible = false;
    this.records = new Map(); this.threshold = 0.6; this.pace = 4500;
    this.instantAdvance = false; this.throughput = new InspectionThroughput();
    this.history = new InspectionHistory();
    this.shift = createShift({ seed: freshSeed(), difficulty: 'easy', maxFaults: 1 });
    this.build(); this.loadCase();
    onHealth(() => this.renderStatus());
    new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.renderStatus(); }).observe(root);
    this.timer = setInterval(() => this.pump(), 250);
    document.addEventListener('visibilitychange', () => { this.renderStatus(); this.pump(); });
    this.loadRecordings();
    document.addEventListener('keydown', e => {
      if (!this.visible || this.mode !== 'you' || this.busy || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const decision = { a: 'approve', d: 'deny', r: 'review' }[e.key.toLowerCase()];
      if (decision && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.judge(decision); }
    });
  }

  get live() { return health.connected && health.models?.english === 'ready'; }

  build() {
    const el = this.el = {};
    el.source = h('span', { class: 'cp-source', role: 'status' });
    el.counter = h('span', { class: 'cp-counter' });
    el.score = h('b'); el.cleared = h('b'); el.citations = h('b'); el.reviews = h('b');
    const stat = (label, value) => h('div', {}, h('span', {}, label), value);
    el.laya = h('button', { class: 'on', type: 'button', 'aria-pressed': 'true', onclick: () => this.setMode('laya') }, 'Laya inspects');
    el.you = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.setMode('you') }, 'You inspect');
    el.inspect = h('button', { class: 'solid', type: 'button', onclick: () => this.inspect() }, 'Inspect documents');
    el.auto = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.toggleAuto() }, 'Auto-run shift');
    el.next = h('button', { type: 'button', onclick: () => this.next() }, 'Next traveler');
    el.reset = h('button', { type: 'button', onclick: () => this.reset() }, 'New shift');
    el.instant = h('input', { id: 'cp-instant', type: 'checkbox', onchange: e => {
      this.instantAdvance = e.target.checked;
      if (this.instantAdvance && this.outcome) this.due = Date.now();
      this.renderStatus(); this.pump();
    } });
    el.levelButtons = {};
    el.levelInfo = h('p', { class: 'cp-level-info', role: 'status' });
    el.levels = h('div', { class: 'cp-levels', role: 'group', 'aria-label': 'Document difficulty' },
      ...Object.entries(LEVELS).map(([key, level]) => (el.levelButtons[key] = h('button', { type: 'button', 'data-difficulty': key,
        'aria-pressed': String(key === 'easy'), onclick: () => this.chooseDifficulty(key) }, h('b', {}, level.label), h('small', {}, level.documents)))), el.levelInfo);
    el.ruleTitle = h('h3'); el.rules = h('ol');
    el.authorityRegister = h('details', {}, h('summary', {}, 'Authority register'),
      h('div', { class: 'cp-authority-register' }, h('p', {}, 'Destination: Aster. Required vaccination: polio.'),
        h('p', {}, Object.entries(CITIES).map(([country, cities]) => country + ': ' + cities.join(', ')).join(' · ')),
        h('p', {}, Object.values(DOCUMENTS).filter(doc => doc.seal).map(doc => doc.title + ': ' + doc.seal).join(' · '))));
    el.desk = h('div', { class: 'cp-desk' });
    el.papers = h('div', { class: 'cp-papers' });
    el.person = h('div', { class: 'cp-traveler' });
    el.stamp = h('div', { class: 'cp-stamp', 'aria-hidden': 'true' });
    el.desk.append(h('div', { class: 'cp-window' }, h('div', { class: 'cp-window-label' }, 'Central transit authority', h('b', {}, 'DOCUMENT CONTROL / 07')), el.person,
      h('div', { class: 'cp-queue', 'aria-hidden': 'true' }, ...Array.from({ length: 4 }, () => h('i')))), el.papers, el.stamp);
    el.result = h('div', { class: 'cp-verdict', role: 'status', 'aria-live': 'polite' });
    el.readings = h('div', { class: 'cp-readings' });
    el.checks = h('div', { class: 'cp-checks' });
    el.human = h('div', { class: 'cp-human' }, ...Object.entries(DECISIONS).map(([key, label]) =>
      h('button', { type: 'button', 'data-decision': key, onclick: () => this.judge(key) }, label, h('small', {}, key[0].toUpperCase()))));
    el.threshold = h('input', { id: 'cp-threshold', type: 'range', min: 0.5, max: 0.95, step: 0.05, value: this.threshold,
      oninput: e => { this.threshold = +e.target.value; el.thresholdValue.textContent = Math.round(this.threshold * 100) + '%'; } });
    el.thresholdValue = h('output', { htmlFor: 'cp-threshold' }, '60%');
    el.translation = h('pre', { class: 'cp-json', tabindex: 0 });
    el.response = h('pre', { class: 'cp-json', tabindex: 0 });
    el.editor = h('details', { class: 'cp-editor' }, h('summary', {}, 'Edit the documents'));
    el.form = h('form', { onsubmit: e => this.saveEdits(e) });
    el.editor.append(el.form);
    el.shiftMode = h('select', { id: 'cp-shift-mode' }, h('option', { value: 'random' }, 'Random documents'), h('option', { value: 'demo' }, 'Recorded demo · 12 arrivals'));
    el.shiftSize = h('input', { id: 'cp-shift-size', type: 'number', min: 1, max: MAX_SHIFT_SIZE, step: 1, required: true, value: this.shift.size });
    el.seed = h('input', { id: 'cp-seed', type: 'text', maxLength: 64, value: this.shift.seed });
    el.invalidRate = h('input', { id: 'cp-invalid-rate', type: 'number', min: 0, max: 100, step: 1, required: true, value: 50 });
    el.maxFaults = h('select', { id: 'cp-max-faults' }, h('option', { value: 3 }, 'Mixed · 1–3 faults'), h('option', { value: 1 }, 'Simple · one fault'));
    const setting = (label, control) => h('div', {}, h('label', { htmlFor: control.id }, label), control);
    el.shiftSummary = h('summary');
    el.shiftError = h('p', { class: 'cp-config-error', role: 'status' });
    el.shiftForm = h('form', { onsubmit: e => this.startShift(e) },
      h('div', { class: 'cp-generator-grid' }, setting('Shift type', el.shiftMode), setting('Travelers · 1–10,000', el.shiftSize),
        setting('Invalid chance · %', el.invalidRate), setting('Seed · repeat a shift', el.seed), setting('Fault variation', el.maxFaults)),
      h('p', { class: 'fine' }, 'Random shifts vary names, dates, wording and document faults. New shift rolls a new seed; Start shift replays the seed entered here. Random wording needs the live model, or you can inspect it yourself.'),
      h('button', { type: 'submit', class: 'solid' }, 'Start shift'), el.shiftError);
    el.shiftMode.addEventListener('change', () => this.renderStatus());
    el.pace = h('select', { id: 'cp-pace', onchange: e => { this.pace = +e.target.value; } },
      ...[[4500, 'Read the papers · 4.5 seconds'], [8000, 'Take your time · 8 seconds'], [2000, 'Rush hour · 2 seconds']].map(([value, text]) => h('option', { value }, text)));
    el.throughputNumbers = {}; el.throughputCounts = {};
    el.throughputNote = h('p', { class: 'cp-throughput-note' });
    el.throughput = h('div', { class: 'cp-throughput', 'aria-label': 'Laya inspection throughput' },
      h('div', { class: 'cp-throughput-title' }, 'Throughput · completed travelers per minute'),
      ...Object.entries({ total: 'Total / min', correct: 'Correct / min', incorrect: 'Incorrect / min', review: 'Reviewed / min' }).map(([key, label]) => {
        el.throughputNumbers[key] = h('b', { 'data-rate': key }, '0');
        el.throughputCounts[key] = h('small', { 'data-count': key }, '0 inspections');
        return h('div', { class: 'cp-throughput-metric' }, h('span', {}, label), el.throughputNumbers[key], el.throughputCounts[key]);
      }), el.throughputNote);
    el.historyLists = {}; el.historyCounts = {};
    el.history = h('section', { class: 'cp-history', 'aria-label': 'Recent inspections' },
      h('h3', {}, 'Recent inspections'),
      h('p', { class: 'cp-history-note' }, 'Last five per result · current shift · newest first. Expand an inspection to see its saved papers and readings.'),
      h('div', { class: 'cp-history-grid' }, ...Object.entries(DECISIONS).map(([key, label]) => {
        el.historyLists[key] = h('div', { class: 'cp-history-list' });
        el.historyCounts[key] = h('small', {}, '0 / ' + HISTORY_LIMIT);
        return h('div', { class: 'cp-history-column', 'data-history-result': key },
          h('h4', {}, key === 'review' ? 'For review' : label, el.historyCounts[key]), el.historyLists[key]);
      })));
    this.clearHistory();
    this.root.append(
      h('div', { class: 'cp-toolbar' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Checkpoint pilot' }, el.laya, el.you), el.source,
        h('span', { class: 'sp' }), h('span', { class: 'cp-date' }, 'Inspection date / 06 Oct 2026')),
      el.levels, h('details', { class: 'cp-generator' }, el.shiftSummary, el.shiftForm),
      h('div', { class: 'cp-shift' }, el.counter, stat('Points', el.score), stat('Cleared', el.cleared), stat('Citations', el.citations), stat('Reviewed', el.reviews)),
      el.throughput,
      h('div', { class: 'cp-layout' },
        h('div', { class: 'cp-workspace' },
          h('div', { class: 'cp-actions' }, el.inspect, el.auto, el.next,
            h('label', { class: 'cp-instant-toggle', htmlFor: 'cp-instant' }, el.instant, 'Instant advance'), el.reset), el.desk, el.human, el.result, el.editor),
        h('aside', { class: 'cp-inspector', 'aria-label': 'Inspection desk' },
          h('div', { class: 'cp-rulebook' }, h('div', { class: 'cp-eyebrow' }, 'Bulletin / 06 Oct'), el.ruleTitle, el.rules, el.authorityRegister),
          h('div', { class: 'cp-evidence' }, h('h3', {}, 'What Laya reads'), el.readings),
          h('details', { class: 'cp-formal' }, h('summary', {}, 'Identity, numbers & dates · code checks'), el.checks),
          h('details', { class: 'cp-settings' }, h('summary', {}, 'Inspection settings'),
            h('label', { htmlFor: 'cp-threshold' }, 'Review below ', el.thresholdValue), el.threshold,
            h('p', { class: 'fine' }, 'A demo threshold, adjustable to see the trade-off between clearance and review.'),
            h('label', { htmlFor: 'cp-pace' }, 'Auto-run pace'),
            el.pace),
          h('details', { class: 'cp-translation' }, h('summary', {}, 'Documents → model input'),
            h('p', { class: 'fine' }, 'Each level sends the printed fields of each paper in a separate request. Code checks exact names, IDs, dates, measurements and seal codes; Laya reads purpose, appearance, job field, entry status, vaccination coverage and identity statements. Answer keys are used only for scoring.'), el.translation),
          h('details', { class: 'cp-response' }, h('summary', {}, 'Raw model responses'), el.response))),
      el.history,
    );
  }

  async loadRecordings() {
    try {
      const response = await fetch('static/data/checkpoint.json');
      if (!response.ok) return;
      const data = await response.json();
      for (const row of data.cases) this.records.set(row.fingerprint, { responses: row.responses, recorded: data.recorded, machine: data.machine });
    } catch { /* live calls and human play remain available without recordings */ }
    this.renderStatus();
  }

  loadCase() {
    this.version++; this.busy = false; this.finished = false;
    this.item = this.shift.caseAt(this.position);
    this.plan = translateDocuments(this.item); this.responses = {}; this.outcome = null; this.error = ''; this.source = null;
    this.render();
  }

  setMode(mode) {
    if (this.busy) return;
    this.mode = mode; this.auto = false;
    this.renderStatus(); this.renderVerdict();
  }

  renderStatus() {
    this.throughput.setRunning(this.mode === 'laya' && !this.finished &&
      (this.busy || (this.auto && this.visible && !document.hidden)));
    const el = this.el, record = this.records.get(fingerprint(this.plan.requests));
    el.source.textContent = this.live ? 'Live model · English' : record ? 'Recorded Laya · real answers' : health.connected ? 'Model loading' : 'Human play · start the local model for Laya';
    el.source.classList.toggle('connected', !!this.live);
    for (const [key, button] of [['laya', el.laya], ['you', el.you]]) {
      button.classList.toggle('on', key === this.mode); button.setAttribute('aria-pressed', String(key === this.mode));
      button.disabled = this.busy;
    }
    el.inspect.hidden = this.mode !== 'laya'; el.human.hidden = this.mode !== 'you';
    el.inspect.disabled = this.busy || !!this.outcome || this.finished || (!this.live && !record);
    el.inspect.textContent = this.busy ? 'Reading documents…' : 'Inspect documents';
    el.auto.disabled = this.mode !== 'laya' || this.finished || (!this.live && !record);
    el.auto.textContent = this.auto ? (this.visible && !document.hidden ? 'Stop auto-run' : 'Auto paused offscreen') : 'Auto-run shift';
    el.auto.setAttribute('aria-pressed', String(this.auto));
    el.next.disabled = this.busy || !this.outcome || this.finished;
    el.next.textContent = this.position === this.shift.size - 1 ? 'Finish shift' : 'Next traveler';
    el.reset.disabled = this.busy;
    el.threshold.disabled = this.busy;
    el.pace.disabled = this.instantAdvance;
    el.instant.disabled = this.mode !== 'laya';
    for (const button of el.human.querySelectorAll('button')) button.disabled = this.busy || !!this.outcome || this.finished;
    for (const input of el.form.querySelectorAll('input, textarea, button')) input.disabled = this.busy || this.finished;
    for (const input of el.shiftForm.querySelectorAll('input, select, button')) input.disabled = this.busy;
    for (const input of [el.shiftSize, el.seed, el.invalidRate, el.maxFaults]) input.disabled = this.busy || el.shiftMode.value === 'demo';
    const level = LEVELS[this.shift.difficulty];
    for (const [key, button] of Object.entries(el.levelButtons)) {
      button.disabled = this.busy; button.classList.toggle('on', key === this.shift.difficulty);
      button.setAttribute('aria-pressed', String(key === this.shift.difficulty));
    }
    el.levelInfo.textContent = level ? `${level.summary} ${this.plan.requests.length} submitted papers to read · ${this.plan.checks.length} exact checks. ${this.shift.difficulty === 'easy' ? 'Invalid arrivals have one fault.' : 'Invalid arrivals can have multiple faults.'}` : 'Original twelve-arrival recorded demonstration.';
    el.maxFaults.disabled ||= this.shift.difficulty === 'easy';
    el.shiftSummary.textContent = this.shift.mode === 'random'
      ? `Shift generator · ${level?.label || 'Classic'} · ${this.shift.size.toLocaleString()} random arrivals · ${Math.round(this.shift.invalidRate * 100)}% invalid chance`
      : 'Shift generator · recorded demo · 12 arrivals';
    this.renderThroughput();
  }

  renderThroughput() {
    const snapshot = this.throughput.snapshot(), el = this.el;
    for (const key of Object.keys(el.throughputNumbers)) {
      el.throughputNumbers[key].textContent = snapshot.perMinute[key].toLocaleString(undefined, { maximumFractionDigits: 1 });
      el.throughputCounts[key].textContent = `${snapshot.counts[key]} inspection${snapshot.counts[key] === 1 ? '' : 's'}`;
    }
    const source = snapshot.sources.length > 1 ? 'Mixed live / recorded' : snapshot.sources[0] === 'live' ? 'Live model' : snapshot.sources[0] === 'recorded' ? 'Recorded answers' : 'Awaiting Laya';
    el.throughputNote.textContent = `${source} · run average over ${(snapshot.elapsedMs / 1000).toFixed(1)} s active wall time. Total includes reviews${snapshot.counts.practice ? ` and ${snapshot.counts.practice} unscored practice inspections` : ''}. Human stamps excluded.`;
    el.throughput.dataset.elapsedMs = String(snapshot.elapsedMs);
    el.throughput.dataset.counts = JSON.stringify(snapshot.counts);
    el.throughput.dataset.running = String(snapshot.running);
  }

  chooseDifficulty(difficulty) {
    if (this.busy) return;
    this.shift = createShift({ ...this.shift, mode: 'random', difficulty,
      size: this.shift.mode === 'demo' ? 1000 : this.shift.size,
      seed: this.shift.seed || this.el.seed.value || freshSeed(), maxFaults: difficulty === 'easy' ? 1 : 3 });
    this.reset(false);
  }

  answerText(answer) {
    return answer.type === 'choice' ? (LABELS[answer.choice] || answer.choice)
      : answer.noul >= 0.5 ? 'Employment confirmed' : 'No confirmed job';
  }

  readingFooter(id) {
    const result = this.responses[id];
    if (!result) return h('div', { class: 'cp-paper-reading' }, h('span', {}, 'Laya reading'), h('b', {}, 'Awaiting inspection'));
    return h('div', { class: 'cp-paper-reading read' }, h('span', {}, 'Laya readings'),
      ...Object.values(result.answers).map(answer => {
        const p = answer.type === 'choice' ? answer.probabilities[answer.choice] : Math.max(answer.noul, 1 - answer.noul);
        return h('b', {}, `${this.answerText(answer)} · ${(p * 100).toFixed(1)}%`);
      }));
  }

  paper(id, kicker, title, ...contents) {
    return h('article', { class: 'cp-paper cp-' + id, 'data-document': id, 'data-field': id, 'aria-label': title },
      h('header', {}, h('span', {}, kicker), h('h3', {}, title)), ...contents,
      h('div', { class: 'cp-paper-bottom', 'aria-hidden': 'true' }, 'CTA / ' + this.item.id.toUpperCase(), h('span', {}, '▥ ▥ ▥')));
  }

  renderDocuments() {
    if (this.item.difficulty) return this.renderLevelDocuments();
    delete this.el.papers.dataset.difficulty;
    const item = this.item, p = item.passport, permit = item.permit;
    this.el.person.replaceChildren(portrait(this.position), h('span', {}, p?.holder || 'Unknown traveler'));
    const passport = p ? this.paper('passport', 'Republic of ' + p.country, 'Passport',
      h('div', { class: 'cp-passport-body' }, portrait(this.position), h('dl', {}, field('Holder', p.holder, 'passport.holder'), field('Passport no.', p.number, 'passport.number'), field('Expires', p.expires, 'passport.expires'))),
      h('div', { class: 'cp-security-line', 'aria-hidden': 'true' }, '◈'), h('p', { class: 'cp-machine-line', 'aria-hidden': 'true' }, `P<${p.country.toUpperCase()}<${p.holder.toUpperCase().replaceAll(' ', '<')}<<<<`)) : this.missing('passport', 'Passport missing');
    const entry = permit ? this.paper('permit', 'Ministry of transit', 'Entry permit',
      h('dl', { class: 'cp-permit-fields' }, field('Issued to', permit.holder, 'permit.holder'), field('Passport no.', permit.passportNumber, 'permit.passportNumber'),
        field('Valid from', permit.issued, 'permit.issued'), field('Until', permit.expires, 'permit.expires')),
      h('div', { class: 'cp-written', 'data-field': 'permit.text' }, h('span', {}, 'Authorization'), h('p', {}, permit.text)), this.readingFooter('permit')) : this.missing('permit', 'Entry permit missing');
    const declaration = this.paper('declaration', 'Signed at arrival', 'Travel declaration',
      h('dl', {}, field('Declared by', item.declaration.holder, 'declaration.holder')),
      h('div', { class: 'cp-written', 'data-field': 'declaration.text' }, h('span', {}, 'Purpose of visit'), h('p', {}, item.declaration.text)),
      h('div', { class: 'cp-signature', 'aria-hidden': 'true' }, item.declaration.holder), this.readingFooter('declaration'));
    const letter = item.letter ? this.paper('letter', item.letter.issuer || 'Aster harbor works', 'Employer letter',
      h('dl', {}, field('Concerning', item.letter.holder, 'letter.holder')),
      h('div', { class: 'cp-written', 'data-field': 'letter.text' }, h('span', {}, 'Employment statement'), h('p', {}, item.letter.text)),
      h('div', { class: 'cp-signature' }, item.letter.signed ? 'Signed / Personnel office' : 'Unsigned'), this.readingFooter('letter')) : this.missing('letter', 'No supporting letter', 'Required for work visits.');
    this.el.papers.replaceChildren(passport, entry, declaration, letter);
    this.highlight(this.outcome?.fields || []);
  }

  renderLevelDocuments() {
    const item = this.item;
    this.el.papers.dataset.difficulty = item.difficulty;
    this.el.person.replaceChildren(portrait(this.position), h('span', {}, item.passport?.holder || 'Unknown traveler'));
    this.el.papers.replaceChildren(...item.packet.map(id => {
      const doc = item[id], spec = DOCUMENTS[id];
      if (!doc) return this.missing(id, spec.title + ' missing');
      const content = spec.fields.filter(f => doc[f.key] !== undefined).map(f => {
        if (f.type === 'textarea') return h('div', { class: 'cp-written', 'data-field': `${id}.${f.key}` }, h('span', {}, f.label), h('p', {}, doc[f.key]));
        return field(f.label, Array.isArray(doc[f.key]) ? doc[f.key].join(', ') : f.type === 'checkbox' ? (doc[f.key] ? 'Signed' : 'Unsigned') : String(doc[f.key]), `${id}.${f.key}`);
      });
      return this.paper(id, id === 'passport' ? 'Republic of ' + doc.country : spec.authority, spec.title,
        ...(id === 'passport' ? [portrait(this.position)] : []), h('dl', { class: 'cp-level-fields' }, content), this.readingFooter(id));
    }));
    this.highlight(this.outcome?.fields || []);
  }

  missing(id, title, detail = 'This document has not been submitted.') {
    return h('div', { class: 'cp-missing', 'data-field': id }, h('span', { 'aria-hidden': 'true' }, '+'), h('b', {}, title), h('p', {}, detail));
  }

  renderReadings() {
    const el = this.el;
    el.readings.replaceChildren(...this.plan.requests.map(request => {
      const result = this.responses[request.id];
      return h('div', { class: 'cp-reading', 'data-reading': request.id }, h('div', { class: 'cp-reading-title' }, h('b', {}, request.title),
        h('span', {}, result ? `${result.latency_ms.toFixed(1)} ms` : 'Not read yet')),
        ...Object.entries(request.questions).map(([qid, question]) => {
          const answer = result?.answers[qid];
          const rows = answer?.type === 'choice' ? Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]).map(([key, p]) => bar(LABELS[key] || key, p, key === answer.choice))
            : answer ? [bar('Confirmed job', answer.noul, answer.noul >= 0.5, true), bar('No paid job', 1 - answer.noul, answer.noul < 0.5)] : [];
          return h('div', { class: 'cp-reading-question', 'data-question': qid }, h('p', { class: 'cp-question' }, question.instructions),
            rows.length ? rows : h('p', { class: 'fine' }, 'Inspect to see the probability distribution.'));
        }));
    }));
    el.translation.textContent = JSON.stringify({ exact_checks_by_code: this.plan.checks.map(({ fields, ...check }) => check), model_requests: this.plan.requests.map(requestPayload) }, null, 2);
    el.response.textContent = Object.keys(this.responses).length ? JSON.stringify(this.responses, null, 2) : 'No model calls yet.';
    el.checks.replaceChildren(...this.plan.checks.map(check => h('button', { type: 'button', class: 'cp-check', onclick: () => this.highlight(check.fields) },
      h('span', { class: check.ok ? 'pass' : 'fail' }, check.ok ? 'PASS' : 'FAIL'), h('span', {}, h('b', {}, check.label), h('small', {}, check.detail)))));
  }

  highlight(fields) {
    for (const el of this.el.papers.querySelectorAll('[data-field]')) el.classList.toggle('cp-flagged', fields.includes(el.dataset.field));
  }

  renderEditor() {
    if (this.item.difficulty) return this.renderLevelEditor();
    const item = this.item, inputs = [];
    const input = (label, name, value, type = 'text') => {
      const control = type === 'textarea' ? h('textarea', { id: 'cp-edit-' + name, name, rows: 3, maxLength: 320, required: true, value })
        : h('input', { id: 'cp-edit-' + name, name, type, maxLength: 80, required: true, value });
      inputs.push(h('div', {}, h('label', { htmlFor: control.id }, label), control));
    };
    if (item.passport) {
      input('Passport holder', 'passport_holder', item.passport.holder);
      input('Passport number', 'passport_number', item.passport.number);
      input('Passport expires', 'passport_expires', item.passport.expires, 'date');
    }
    input('Declaration holder', 'declaration_holder', item.declaration.holder);
    if (item.permit) {
      input('Permit holder', 'permit_holder', item.permit.holder);
      input('Permit passport number', 'permit_number', item.permit.passportNumber);
      input('Permit valid from', 'permit_issued', item.permit.issued, 'date');
      input('Permit expires', 'permit_expires', item.permit.expires, 'date');
      input('Permit authorization', 'permit_text', item.permit.text, 'textarea');
    }
    input('Travel declaration', 'declaration_text', item.declaration.text, 'textarea');
    if (item.letter) {
      input('Employer letter holder', 'letter_holder', item.letter.holder);
      input('Employer letter statement', 'letter_text', item.letter.text, 'textarea');
    }
    this.el.form.replaceChildren(h('p', { class: 'fine' }, 'Change the wording or a document field and inspect again. Edited papers become an unscored practice case.'),
      h('div', { class: 'cp-editor-grid' }, inputs), h('button', { type: 'submit', class: 'solid' }, 'Use edited papers'));
  }

  renderLevelEditor() {
    const inputs = [];
    for (const id of this.item.packet) {
      const doc = this.item[id]; if (!doc) continue;
      inputs.push(h('h4', {}, DOCUMENTS[id].title));
      for (const f of DOCUMENTS[id].fields.filter(f => doc[f.key] !== undefined)) {
        const attrs = { id: `cp-edit-${id}-${f.key}`, name: `${id}.${f.key}`, required: f.type !== 'checkbox', maxLength: f.type === 'textarea' ? 320 : 120,
          value: Array.isArray(doc[f.key]) ? doc[f.key].join(', ') : doc[f.key] };
        const control = f.type === 'textarea' ? h('textarea', { ...attrs, rows: 3 }) : h('input', { ...attrs,
          type: f.type === 'list' ? 'text' : f.type, ...(f.type === 'checkbox' ? { checked: doc[f.key] } : {}) });
        inputs.push(h('div', {}, h('label', { htmlFor: attrs.id }, f.label + (f.type === 'list' ? ' · comma separated' : '')), control));
      }
    }
    this.el.form.replaceChildren(h('p', { class: 'fine' }, 'Edit any printed field. Changes make this an unscored practice packet.'),
      h('div', { class: 'cp-editor-grid' }, inputs), h('button', { type: 'submit', class: 'solid' }, 'Use edited papers'));
  }

  saveEdits(event) {
    event.preventDefault(); if (this.busy || this.finished) return;
    const data = new FormData(this.el.form), item = structuredClone(this.item);
    if (item.difficulty) {
      for (const id of item.packet) if (item[id]) for (const f of DOCUMENTS[id].fields.filter(f => item[id][f.key] !== undefined)) {
        const key = `${id}.${f.key}`, value = data.get(key);
        item[id][f.key] = f.type === 'checkbox' ? data.has(key) : f.type === 'number' ? Number(value)
          : f.type === 'list' ? String(value).split(',').map(v => v.trim()).filter(Boolean) : String(value).trim();
      }
    } else {
      if (item.passport) {
        item.passport.holder = data.get('passport_holder').trim(); item.passport.number = data.get('passport_number').trim(); item.passport.expires = data.get('passport_expires');
      }
      item.declaration.holder = data.get('declaration_holder').trim(); item.declaration.text = data.get('declaration_text').trim();
      if (item.permit) {
        item.permit.holder = data.get('permit_holder').trim(); item.permit.passportNumber = data.get('permit_number').trim();
        item.permit.issued = data.get('permit_issued'); item.permit.expires = data.get('permit_expires'); item.permit.text = data.get('permit_text').trim();
      }
      if (item.letter) { item.letter.holder = data.get('letter_holder').trim(); item.letter.text = data.get('letter_text').trim(); }
    }
    item.custom = true; this.version++; this.auto = false; this.item = item; this.plan = translateDocuments(item);
    this.responses = {}; this.outcome = null; this.error = ''; this.source = null;
    this.el.editor.open = false; this.render();
  }

  async inspect() {
    if (this.busy || this.outcome || this.finished || this.mode !== 'laya') return;
    const ticket = this.version, plan = this.plan, responses = {};
    this.busy = true; this.error = ''; this.renderStatus(); this.renderVerdict();
    const started = performance.now();
    try {
      if (this.live) {
        this.source = 'live';
        for (const request of plan.requests) {
          if (ticket !== this.version) return;
          const result = await predict(requestPayload(request));
          if (result.usage?.truncated) throw new Error('The model could not read the whole document. Shorten the edited text and inspect again.');
          responses[request.id] = result;
        }
      } else {
        const record = this.records.get(fingerprint(plan.requests));
        if (!record) throw new Error('No recorded answer matches these papers. Start the local model to inspect them, or switch to You inspect.');
        this.source = 'recorded';
        await sleep(250); Object.assign(responses, structuredClone(record.responses));
      }
      if (ticket !== this.version) return;
      this.responses = responses; this.elapsed = performance.now() - started;
      const verdict = decideAdmission(this.item, plan, responses, this.threshold);
      this.judge(verdict.decision, verdict);
    } catch (error) {
      if (ticket === this.version) { this.error = error.message; this.responses = responses; this.auto = false; this.render(); }
    } finally {
      if (ticket === this.version) {
        this.busy = false; this.renderStatus(); this.renderVerdict();
        if (this.auto && this.instantAdvance) this.pump();
      }
    }
  }

  judge(decision, verdict = { reasons: ['Inspector decision.'], fields: [] }) {
    if (this.outcome || this.finished || (this.busy && this.mode === 'you')) return;
    const grade = gradeDecision(this.item, decision);
    this.outcome = { ...verdict, decision, grade };
    this.score += grade.points;
    if (grade.kind === 'correct') this.cleared++;
    if (grade.kind === 'citation') this.citations++;
    if (grade.kind === 'review') this.reviews++;
    if (this.mode === 'laya') this.throughput.record(grade.kind, this.source);
    this.addHistory(this.history.record({ arrival: this.position + 1, item: this.item, plan: this.plan,
      responses: this.responses, outcome: this.outcome, source: this.mode === 'you' ? 'human' : this.source,
      threshold: this.threshold, elapsed: this.mode === 'laya' ? this.elapsed : null }));
    this.due = Date.now() + (this.instantAdvance ? 0 : this.pace);
    this.render();
  }

  clearHistory() {
    this.history.reset();
    for (const [decision, list] of Object.entries(this.el.historyLists)) {
      list.replaceChildren(h('p', { class: 'cp-history-empty' }, 'No inspections yet.'));
      this.el.historyCounts[decision].textContent = '0 / ' + HISTORY_LIMIT;
    }
  }

  addHistory(inspection) {
    const { arrival, item, outcome, source } = inspection;
    const status = { correct: 'Correct', citation: 'Incorrect · citation', review: 'Secondary review', practice: 'Unscored practice' }[outcome.grade.kind];
    const row = h('details', { class: 'cp-history-entry', 'data-arrival': arrival, 'data-grade': outcome.grade.kind },
      h('summary', {}, h('span', {}, 'Arrival ' + arrival + ' · ' + (LEVELS[item.difficulty]?.label || 'Classic')),
        h('b', {}, item.passport?.holder || item.declaration?.holder || 'Unknown traveler'),
        h('small', {}, status + ' · ' + (source === 'human' ? 'You' : source === 'recorded' ? 'Recorded Laya' : 'Live Laya'))));
    // Build the full detail only when opened; keep existing entries open as auto-run adds new ones.
    row.addEventListener('toggle', () => {
      if (!row.open || row.querySelector('.cp-history-detail')) return;
      row.append(this.historyDetail(inspection));
    });
    const list = this.el.historyLists[outcome.decision];
    list.querySelector('.cp-history-empty')?.remove();
    list.prepend(row);
    while (list.childElementCount > HISTORY_LIMIT) list.lastElementChild.remove();
    this.el.historyCounts[outcome.decision].textContent = list.childElementCount + ' / ' + HISTORY_LIMIT;
  }

  historyDetail({ item, plan, responses, outcome, source, threshold, elapsed }) {
    const papers = item.packet || ['passport', 'permit', 'declaration', 'letter'];
    const calls = Object.values(responses);
    const detail = h('div', { class: 'cp-history-detail' },
      h('b', {}, DECISIONS[outcome.decision]), h('p', {}, outcome.reasons.join(' ')), h('p', {}, outcome.grade.text),
      ...(source === 'human' ? [] : [h('p', { class: 'cp-history-meta' }, `${calls.length} document calls · ${calls.reduce((sum, result) => sum + result.latency_ms, 0).toFixed(1)} ms model time · review below ${Math.round(threshold * 100)}%` + (source === 'live' ? ` · ${elapsed.toFixed(1)} ms round trip` : ''))]),
      h('h5', {}, 'Submitted papers'),
      ...papers.map(id => h('details', { class: 'cp-history-paper' }, h('summary', {}, DOCUMENTS[id].title + (item[id] ? '' : ' · not submitted')),
        h('pre', {}, item[id] ? printedDocument(item, id) : 'This document was not submitted.'))),
      h('details', {}, h('summary', {}, 'Exact checks · code'), h('ul', {}, ...plan.checks.map(check =>
        h('li', {}, (check.ok ? 'PASS · ' : 'FAIL · ') + check.label + ': ' + check.detail)))));
    if (calls.length) detail.append(h('details', {}, h('summary', {}, 'Saved model readings'), ...plan.requests.map(request =>
      h('div', { class: 'cp-reading' }, h('b', {}, request.title), ...Object.entries(request.questions).map(([qid, question]) => {
        const answer = responses[request.id]?.answers[qid];
        return h('div', { class: 'cp-reading-question' }, h('p', { class: 'cp-question' }, question.instructions),
          answer ? h('b', {}, this.answerText(answer)) : 'Not read',
          ...(answer?.type === 'choice' ? Object.entries(answer.probabilities).map(([key, p]) => bar(LABELS[key] || key, p, key === answer.choice))
            : answer ? [bar('Confirmed job', answer.noul, answer.noul >= 0.5), bar('No paid job', 1 - answer.noul, answer.noul < 0.5)] : []));
      })))));
    detail.append(h('details', {}, h('summary', {}, 'Saved model input & responses'),
      h('pre', { class: 'cp-json', tabindex: 0 }, JSON.stringify({ model_requests: plan.requests.map(requestPayload), responses }, null, 2))));
    return detail;
  }

  renderVerdict() {
    const el = this.el;
    el.stamp.textContent = this.outcome ? DECISIONS[this.outcome.decision].toUpperCase() : '';
    el.stamp.className = 'cp-stamp' + (this.outcome ? ' stamped ' + this.outcome.decision : '');
    this.root.dataset.result = this.outcome?.decision || (this.busy ? 'reading' : 'waiting');
    if (this.finished) {
      el.result.replaceChildren(h('b', {}, 'Shift complete.'), h('span', {}, `${this.cleared} correct inspections · ${this.citations} citations · ${this.reviews} reviewed · ${this.score} points.`));
    } else if (this.error) {
      el.result.replaceChildren(h('b', {}, 'Inspection unavailable.'), h('span', {}, this.error));
    } else if (this.outcome) {
      const modelMs = Object.values(this.responses).reduce((sum, result) => sum + result.latency_ms, 0);
      el.result.replaceChildren(h('b', {}, DECISIONS[this.outcome.decision]), h('span', {}, this.outcome.reasons.join(' ')),
        h('small', {}, this.outcome.grade.text),
        ...(Object.keys(this.responses).length ? [h('small', {}, `${this.source === 'live' ? 'Live Laya' : 'Recorded Laya'} · ${Object.keys(this.responses).length} document calls · ${modelMs.toFixed(1)} ms model time` + (this.source === 'live' ? ` · ${this.elapsed.toFixed(1)} ms round trip` : ''))] : []));
    } else el.result.replaceChildren(h('b', {}, this.busy ? 'Reading the submitted papers…' : this.mode === 'you' ? 'Your decision.' : 'Papers, please.'),
      h('span', {}, this.busy ? 'Each printed statement is translated into a typed answer.' : this.mode === 'you' ? 'Compare the documents with the entry rules. A / D / R to stamp.' : 'Inspect one traveler, or auto-run the whole shift.'));
  }

  render() {
    this.root.dataset.case = this.item.id;
    this.root.dataset.difficulty = this.item.difficulty || 'demo';
    const level = LEVELS[this.item.difficulty];
    this.el.ruleTitle.textContent = `${level?.label || 'Classic'} entry rules`;
    this.el.rules.replaceChildren(...(level?.rules || RULES).map(rule => h('li', {}, rule)));
    this.el.authorityRegister.hidden = !level || this.item.difficulty === 'easy';
    this.el.counter.textContent = 'Arrival ' + String(this.position + 1).padStart(2, '0') + ' / ' + this.shift.size.toLocaleString();
    this.el.score.textContent = this.score; this.el.cleared.textContent = this.cleared;
    this.el.citations.textContent = this.citations; this.el.reviews.textContent = this.reviews;
    this.renderDocuments(); this.renderReadings(); this.renderEditor(); this.renderStatus(); this.renderVerdict();
  }

  next() {
    if (this.busy || !this.outcome || this.finished) return;
    if (this.position === this.shift.size - 1) {
      this.finished = true; this.auto = false; this.renderStatus(); this.renderVerdict(); return;
    }
    this.position++; this.el.editor.open = false; this.loadCase();
  }

  startShift(event) {
    event.preventDefault(); if (this.busy) return;
    const el = this.el;
    try {
      this.shift = createShift({ mode: el.shiftMode.value, size: +el.shiftSize.value,
        seed: el.seed.value.trim() || freshSeed(), difficulty: this.shift.difficulty || 'easy', invalidRate: +el.invalidRate.value / 100, maxFaults: +el.maxFaults.value });
      el.shiftError.textContent = '';
      this.reset(false);
    } catch (error) { el.shiftError.textContent = error.message; }
  }

  reset(reroll = true) {
    if (this.busy) return;
    if (reroll && this.shift.mode === 'random') this.shift = createShift({ ...this.shift, seed: freshSeed() });
    this.el.shiftMode.value = this.shift.mode;
    if (this.shift.mode === 'random') {
      this.el.shiftSize.value = this.shift.size; this.el.seed.value = this.shift.seed;
      this.el.invalidRate.value = this.shift.invalidRate * 100; this.el.maxFaults.value = this.shift.maxFaults;
    }
    this.el.shiftError.textContent = '';
    this.position = 0; this.score = 0; this.cleared = 0; this.citations = 0; this.reviews = 0; this.auto = false;
    this.throughput.reset();
    this.clearHistory();
    this.el.editor.open = false; this.loadCase();
  }

  toggleAuto() {
    if (this.mode !== 'laya' || this.finished) return;
    this.auto = !this.auto; this.renderStatus(); this.pump();
  }

  pump() {
    if (!this.auto) { if (this.busy) this.renderStatus(); return; }
    this.renderStatus();
    if (!this.visible || document.hidden || this.busy || this.finished) return;
    if (!this.outcome) this.inspect();
    else if (Date.now() >= this.due) {
      this.next();
      if (this.auto && this.instantAdvance && !this.finished) this.inspect();
    }
  }
}

for (const root of document.querySelectorAll('[data-checkpoint]')) new Checkpoint(root);
