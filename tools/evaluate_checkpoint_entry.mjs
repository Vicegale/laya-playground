// Compare full printed-document entry-status prompts on the unchanged stock model.
// node tools/evaluate_checkpoint_entry.mjs --per-group 12 --out /tmp/checkpoint-entry.json
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createShift } from '../static/demos/checkpoint-generator.js';
import { translateDocuments, requestPayload } from '../static/demos/checkpoint.js';
import { printedDocument } from '../static/demos/checkpoint-levels.js';

const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const API = process.env.LAYA_API || 'http://127.0.0.1:8770', seed = option('--seed', 'entry-development-20261007');
const perGroup = Number(option('--per-group', 12)), threshold = .6;
assert.ok(Number.isInteger(perGroup) && perGroup > 0 && perGroup <= 300);
const variants = {
  baseline: {
    instructions: id => id === 'declaration' ? 'What entry status does the traveler claim?' : 'What entry status does this document authorize?',
    criteria: { ordinary: 'holiday, transit, study or paid employment as an ordinary traveler',
      diplomatic: 'official embassy duties as an accredited diplomat', asylum: 'refugee protection and asylum' },
  },
  plain: {
    instructions: () => 'Which kind of visit is described?',
    criteria: { ordinary: 'Work, study, tourism or transit.', diplomatic: 'Embassy duties as a diplomat.', asylum: 'Refugee protection or asylum.' },
  },
  concrete: {
    instructions: () => 'Which reason for entering is described?',
    criteria: { ordinary: 'A civilian visit: a paid job, studying, a holiday or traveling through.',
      diplomatic: 'A diplomatic mission: accredited government representative with official embassy duties.',
      asylum: 'Refugee protection: asylum and protected residence.' },
  },
  intent: {
    instructions: () => 'What is the traveler coming to do?',
    criteria: { ordinary: 'Take a paid job, attend school, go on holiday or pass through on a journey.',
      diplomatic: 'Represent a government as a diplomat at an embassy.', asylum: 'Seek protection as a refugee under asylum.' },
  },
  visit: {
    instructions: () => 'What does the printed statement describe?',
    criteria: { ordinary: 'Employment, education, vacation or onward travel.',
      diplomatic: 'An official diplomatic mission or embassy posting.', asylum: 'Asylum, refugee protection or protected residence.' },
  },
  purpose: {
    instructions: () => 'What is the purpose of entry?',
    criteria: { ordinary: 'Paid employment, academic study, sightseeing and holidays, or a connecting journey.',
      diplomatic: 'Official embassy duties by an accredited diplomat.', asylum: 'Refugee protection and asylum.' },
  },
  roles: {
    instructions: () => 'What kind of traveler is described?',
    criteria: { ordinary: 'A worker, tourist, student or transit passenger.',
      diplomatic: 'A diplomat on an official embassy mission.', asylum: 'A refugee seeking asylum or protected residence.' },
  },
  passengers: {
    instructions: () => 'What kind of traveler is described?',
    criteria: { ordinary: 'A paid worker, holiday visitor, student, or passenger on an onward journey.',
      diplomatic: 'An accredited diplomat representing a government at an embassy.', asylum: 'A refugee seeking protection and asylum.' },
  },
  classify: {
    instructions: () => 'Is the person a regular visitor, a diplomat, or a refugee?',
    criteria: { ordinary: 'A regular visitor coming for work, tourism, education or transit.',
      diplomatic: 'A diplomat coming for official embassy duties.', asylum: 'A refugee coming for asylum and protection.' },
  },
  civilian: {
    instructions: () => 'Which type of entry is described?',
    criteria: { ordinary: 'Ordinary civilian travel for personal reasons or a paid job.',
      diplomatic: 'Official diplomatic service at an embassy.', asylum: 'Refugee protection and asylum.' },
  },
  baselineFirst: {
    instructions: id => id === 'declaration' ? 'What entry status does the traveler claim?' : 'What entry status does this document authorize?',
    criteria: { ordinary: 'holiday, transit, study or paid employment as an ordinary traveler',
      diplomatic: 'official embassy duties as an accredited diplomat', asylum: 'refugee protection and asylum' }, statementFirst: true,
  },
  rolesFirst: {
    instructions: () => 'What kind of traveler is described?',
    criteria: { ordinary: 'A worker, tourist, student or transit passenger.',
      diplomatic: 'A diplomat on an official embassy mission.', asylum: 'A refugee seeking asylum or protected residence.' }, statementFirst: true,
  },
  current: null,
};
const selected = option('--variants', 'baseline,plain,concrete,intent,visit,purpose').split(',');
for (const name of selected) assert.ok(Object.hasOwn(variants, name), name);
const health = await (await fetch(API + '/api/health')).json();
assert.equal(health.models.english, 'ready');
const shift = createShift({ difficulty: 'hard', seed, size: 10000, invalidRate: 0 });
const groups = Object.fromEntries(['work', 'study', 'tourism', 'transit', 'diplomatic', 'asylum'].map(key => [key, []]));
for (let i = 0; i < shift.size && Object.values(groups).some(rows => rows.length < perGroup); i++) {
  const item = shift.caseAt(i), route = item.annotation.readings.declaration.route;
  const key = route === 'ordinary' ? item.annotation.declared : route;
  if (groups[key].length < perGroup) groups[key].push(item);
}
for (const rows of Object.values(groups)) assert.equal(rows.length, perGroup);
const samples = [];
for (const [group, items] of Object.entries(groups)) for (const item of items) {
  for (const request of translateDocuments(item).requests.filter(r => r.questions.route)) samples.push({
    id: `${group}/${item.id}/${request.id}`, group, expected: item.annotation.readings[request.id].route, request });
}
// Wording not drawn from the generator; labels are used for evaluation only.
const extra = [
  ['ordinary', 'I have been hired as a physician at Vela Medical Center for a monthly salary.'],
  ['ordinary', 'I accepted a nursing position at the hospital. My shifts begin on Monday.'],
  ['ordinary', 'The bakery hired me to bake bread. I receive wages each week.'],
  ['ordinary', 'I will spend a week hiking and taking photographs on vacation.'],
  ['ordinary', 'I am visiting my parents and enjoying a holiday with them.'],
  ['ordinary', 'My bus departs for another country tonight. I am here between connections.'],
  ['ordinary', 'I am passing through to board a connecting flight.'],
  ['ordinary', 'I enrolled in a university degree and came to attend my first term.'],
  ['ordinary', 'I am joining a language school to study full time.'],
  ['diplomatic', 'I represent my government as an accredited diplomat on an embassy assignment.'],
  ['diplomatic', 'My official diplomatic posting is at our embassy in Aster.'],
  ['diplomatic', 'I am an ambassador entering for official diplomatic service.'],
  ['asylum', 'I fled persecution and seek refugee protection in this country.'],
  ['asylum', 'I am requesting asylum and a place of protected residence.'],
  ['asylum', 'I was granted protection as a refugee and am arriving under my asylum grant.'],
  ['ordinary', 'I am a civilian electrician hired to repair wiring at the embassy. A private contractor pays my wages.'],
  ['ordinary', 'I am here on holiday to visit a friend who is a refugee. I will return home after my vacation.'],
  ['ordinary', 'I am a nurse joining a hospital as a volunteer for my vacation.'],
  ['diplomatic', 'I am an accredited diplomat taking up my paid embassy posting for the government.'],
  ['diplomatic', 'As an ambassador, I represent my country on an official diplomatic mission.'],
  ['asylum', 'I seek asylum because I fled persecution. I hope to find work after receiving refugee protection.'],
  ['asylum', 'I am arriving under a grant of asylum as a recognized refugee. I intend to study after settling here.'],
];
if (!args.includes('--no-extra')) for (const [i, [expected, text]] of extra.entries()) {
  const item = structuredClone(groups[expected === 'ordinary' ? 'work' : expected][i % perGroup]);
  item.declaration.text = text;
  const request = translateDocuments(item).requests.find(r => r.id === 'declaration');
  request.state = printedDocument(item, 'declaration');
  samples.push({ id: 'authored/' + i, group: 'authored-' + expected, expected, request });
}
if (!args.includes('--no-extra')) {
  const item = structuredClone(groups.work[0]);
  item.declaration = { holder: 'Luka Rook', stayDays: 18, heightCm: 166, weightKg: 61, appearance: 'Bald head, with no hair.',
    fingerprint: 'FP-719409-390', text: 'I have been hired as a physician at Vela Medical Center for a monthly salary.' };
  const request = translateDocuments(item).requests.find(r => r.id === 'declaration');
  samples.push({ id: 'screenshot-physician', group: 'authored-ordinary', expected: 'ordinary', request });
}
const reports = {}, rows = [];
for (const name of selected) {
  const report = reports[name] = { total: 0, correct: 0, reviewed: 0, confidentlyWrong: 0, truncations: 0, byGroup: {} };
  const started = performance.now();
  for (const sample of samples) {
    const request = requestPayload(sample.request);
    request.questions = structuredClone(request.questions);
    if (variants[name]) request.questions.route = { type: 'choice', instructions: variants[name].instructions(sample.request.id), criteria: variants[name].criteria };
    if (variants[name]?.statementFirst) {
      const first = request.state.indexOf('\n'), statement = request.state.indexOf('\nPrinted statement:');
      assert.ok(statement > first);
      request.state = [request.state.slice(0, first), request.state.slice(statement + 1), request.state.slice(first + 1, statement)].join('\n');
    }
    const response = await fetch(API + '/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json(), answer = result.answers.route, p = answer.probabilities[answer.choice];
    assert.deepEqual(Object.keys(answer.probabilities).sort(), ['asylum', 'diplomatic', 'ordinary']);
    const correct = answer.choice === sample.expected, reviewed = p < threshold;
    const group = report.byGroup[sample.group] ||= { total: 0, correct: 0, reviewed: 0, confidentlyWrong: 0, probabilitySum: 0 };
    for (const counts of [report, group]) { counts.total++; counts.correct += Number(correct); counts.reviewed += Number(reviewed); counts.confidentlyWrong += Number(!correct && !reviewed); }
    group.probabilitySum += p;
    report.truncations += Number(!!result.usage?.truncated);
    rows.push({ variant: name, id: sample.id, group: sample.group, expected: sample.expected, request, result });
  }
  report.wallMs = +(performance.now() - started).toFixed(1);
  assert.equal(report.truncations, 0);
  console.log(name, JSON.stringify(report));
}
const out = option('--out', null);
if (out) writeFileSync(out, JSON.stringify({ tested: new Date().toISOString(), model: 'stock English', laya: health.version,
  seed, perGroup, threshold, reports, rows }, null, 2) + '\n');
