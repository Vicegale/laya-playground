// Document checkpoint: deterministic document checks + Laya's interpretation of written purpose.
// Fixture annotations grade the game; they are never included in a model request or a verdict.
import { TODAY, PURPOSES, PURPOSE_LABELS, RULES } from './checkpoint-common.js';
export { TODAY, PURPOSES, PURPOSE_LABELS, RULES } from './checkpoint-common.js';
import { levelChecks, translateLevelDocuments, decideLevelAdmission, expectedLevelAdmission } from './checkpoint-levels.js';

const SCOPES = {
  tourism: 'Leisure visits and sightseeing only. Paid employment is not permitted.',
  work: 'Paid employment in repair and maintenance services.',
  transit: 'Transit through the station en route to another destination.',
  study: 'Enrollment in an academic course. Employment is not authorized.',
};
const ACTIVITIES = {
  tourism: 'I want to visit the observatory, see the old harbor, and enjoy a quiet holiday.',
  work: 'I have been hired to repair engines at the shipyard for a monthly salary.',
  transit: 'I am changing ships here on my way to the mining colony.',
  study: 'I am beginning a semester at the navigation academy.',
};
const NAMES = ['Mara Voss', 'Soren Vale', 'Nia Arden', 'Eli Ward', 'Rina Sol', 'Darin Holt',
  'Iris Noll', 'Oren Pike', 'Tessa Reed', 'Luka Moss', 'Ada Wynn', 'Finn Hale'];

export function createCase(index) {
  const kind = ['tourism', 'work', 'tourism', 'work', 'transit', 'tourism',
    'work', 'work', 'study', 'tourism', 'work', 'tourism'][index];
  if (!kind) throw new Error('Unknown traveler');
  const holder = NAMES[index], number = 'AS-' + (246738 + index * 137);
  const item = {
    id: 'arrival-' + String(index + 1).padStart(2, '0'),
    passport: { holder, number, country: ['Aster', 'Vela', 'Orion'][index % 3], expires: '2027-03-12' },
    permit: { holder, passportNumber: number, issued: '2026-09-18', expires: '2026-12-15', text: SCOPES[kind] },
    declaration: { holder, text: ACTIVITIES[kind] },
    letter: kind === 'work' ? { holder, signed: true, text: 'We confirm that this traveler is employed as a repair technician at our shipyard. Their paid position starts this week.' } : null,
    annotation: { declared: kind, permitted: kind, employment: kind === 'work' },
  };
  if (index === 1) { item.permit.text = SCOPES.tourism; item.annotation.permitted = 'tourism'; }
  if (index === 2) item.passport.expires = '2026-09-30';
  if (index === 3) item.permit.passportNumber = 'AS-246739';
  if (index === 5) item.permit.holder = 'Mara Voss';
  if (index === 7) item.letter = null;
  if (index === 9) item.permit.expires = '2026-10-01';
  if (index === 10) {
    item.letter.text = 'The job offer has been withdrawn. We cannot confirm employment; there is no position available for this traveler.';
    item.annotation.employment = false;
  }
  if (index === 11) item.declaration.text = 'I am here on holiday to visit my sister. I am not taking a job or enrolling in a course.';
  return item;
}

export const DECK = NAMES.map((_, i) => createCase(i));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  a.trim().length > 0 && a.normalize('NFC').trim().toLocaleLowerCase('en') === b.normalize('NFC').trim().toLocaleLowerCase('en');
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const unexpired = value => validDate(value) && value >= TODAY;

export function documentChecks(item) {
  if (item.difficulty) return levelChecks(item);
  const p = item.passport, permit = item.permit;
  const checks = [
    { id: 'passport', label: 'Passport present', ok: !!p, detail: p ? 'Passport supplied.' : 'No passport supplied.', fields: ['passport'] },
    { id: 'permit', label: 'Entry permit present', ok: !!permit, detail: permit ? 'Entry permit supplied.' : 'No entry permit supplied.', fields: ['permit'] },
  ];
  if (p) checks.push({ id: 'passport_date', label: 'Passport expiry', ok: unexpired(p.expires), detail: `Expires ${p.expires || '—'}; inspection date ${TODAY}.`, fields: ['passport.expires'] });
  if (permit) checks.push({ id: 'permit_date', label: 'Permit dates', ok: validDate(permit.issued) && permit.issued <= TODAY && unexpired(permit.expires),
    detail: `Valid ${permit.issued || '—'} through ${permit.expires || '—'}.`, fields: ['permit.issued', 'permit.expires'] });
  if (p && permit) checks.push(
    { id: 'name', label: 'Document holders', ok: same(p.holder, permit.holder) && same(p.holder, item.declaration.holder) && (!item.letter || same(p.holder, item.letter.holder)),
      detail: 'Compare the holder names across the submitted papers.', fields: ['passport.holder', 'permit.holder', 'declaration.holder', ...(item.letter ? ['letter.holder'] : [])] },
    { id: 'number', label: 'Passport numbers', ok: same(p.number, permit.passportNumber), detail: `${p.number} on passport; ${permit.passportNumber} on permit.`, fields: ['passport.number', 'permit.passportNumber'] },
  );
  return checks;
}

// Each question reads the relevant printed document text, without a fixture label or a precomputed semantic answer.
export function translateDocuments(item) {
  if (item.difficulty) return translateLevelDocuments(item);
  const requests = [];
  if (item.permit) requests.push({
    id: 'permit', title: 'Entry permit',
    model: 'english', lang: 'en', state: item.permit.text,
    questions: { purpose: { type: 'choice', instructions: 'What type of visit is permitted by this document?', criteria: PURPOSES } },
  });
  requests.push({
    id: 'declaration', title: 'Travel declaration',
    model: 'english', lang: 'en', state: item.declaration.text,
    questions: { purpose: { type: 'choice', instructions: 'What is the purpose of this visit?', criteria: PURPOSES } },
  });
  if (item.letter) requests.push({
    id: 'letter', title: 'Employer letter',
    model: 'english', lang: 'en', state: item.letter.text,
    questions: { employment: { type: 'noul', instructions: 'Does this letter confirm that the traveler has a paid job?' } },
  });
  return { checks: documentChecks(item), requests };
}

export function requestPayload(request) {
  const { state, questions, model, lang } = request;
  return { state, questions, model, lang };
}

export function fingerprint(requests) {
  return JSON.stringify(requests.map(requestPayload));
}

function purposeReading(result) {
  const answer = result?.answers?.purpose;
  if (answer?.type !== 'choice' || !Object.hasOwn(PURPOSES, answer.choice)) throw new Error('Missing visit-purpose answer.');
  const p = answer.probabilities?.[answer.choice];
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('Invalid purpose probability.');
  return { value: answer.choice, probability: p };
}

export function decideAdmission(item, plan, responses, threshold = 0.6) {
  if (item.difficulty) return decideLevelAdmission(item, plan, responses, threshold);
  const failures = plan.checks.filter(c => !c.ok);
  // A formal rejection does not conceal the independent model readings; the UI still presents both.
  if (failures.length) return { decision: 'deny', reasons: failures.map(c => c.label + ': failed.'), fields: failures.flatMap(c => c.fields) };
  const allowed = purposeReading(responses.permit), declared = purposeReading(responses.declaration);
  const uncertain = [allowed, declared].some(r => r.probability < threshold);
  if (uncertain) return { decision: 'review', reasons: ['A purpose reading is below the review threshold.'], fields: ['permit.text', 'declaration.text'] };
  if (allowed.value !== declared.value) return { decision: 'deny', reasons: [`Permit: ${PURPOSE_LABELS[allowed.value]}. Declaration: ${PURPOSE_LABELS[declared.value]}. The purposes disagree.`], fields: ['permit.text', 'declaration.text'] };
  if (declared.value === 'work') {
    if (!item.letter || !item.letter.signed) return { decision: 'deny', reasons: ['Work visits require a signed employer letter.'], fields: ['letter'] };
    const p = responses.letter?.answers?.employment?.noul;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('Missing employment confirmation answer.');
    if (Math.max(p, 1 - p) < threshold) return { decision: 'review', reasons: ['Employment confirmation needs a second inspection.'], fields: ['letter.text'] };
    if (p < 0.5) return { decision: 'deny', reasons: ['The employer letter does not confirm employment.'], fields: ['letter.text'] };
  }
  return { decision: 'approve', reasons: ['The documents pass the formal checks and their purposes agree.'], fields: [] };
}

export function expectedAdmission(item) {
  if (item.custom) return null;  // edited documents have no hidden answer key
  if (item.difficulty) return expectedLevelAdmission(item);
  if (documentChecks(item).some(c => !c.ok)) return 'deny';
  if (item.annotation.declared !== item.annotation.permitted) return 'deny';
  if (item.annotation.declared === 'work' && (!item.letter?.signed || !item.annotation.employment)) return 'deny';
  return 'approve';
}

export function gradeDecision(item, decision) {
  const expected = expectedAdmission(item);
  if (expected === null) return { kind: 'practice', points: 0, text: 'Custom papers inspected. This practice case is not scored.' };
  if (decision === 'review') return { kind: 'review', points: 0, text: 'Sent to secondary inspection. No citation; no clearance points.' };
  if (decision === expected) return { kind: 'correct', points: 10, text: 'Correct inspection. +10 clearance points.' };
  return { kind: 'citation', points: -5, text: `Citation: this traveler should have been ${expected === 'approve' ? 'admitted' : 'denied'}. −5 points.` };
}
