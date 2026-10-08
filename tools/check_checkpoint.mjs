// Check document translation, admission policy, and the fidelity of recorded model answers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK, TODAY, createCase, documentChecks, translateDocuments, requestPayload, fingerprint, decideAdmission, expectedAdmission, gradeDecision } from '../static/demos/checkpoint.js';

const readings = (permit, declaration, p = 0.95, employment = 0.95) => ({
  permit: { answers: { purpose: { type: 'choice', choice: permit, probabilities: { [permit]: p } } } },
  declaration: { answers: { purpose: { type: 'choice', choice: declaration, probabilities: { [declaration]: p } } } },
  letter: { answers: { employment: { type: 'noul', noul: employment } } },
});
function verdict(item, responses, threshold) { return decideAdmission(item, translateDocuments(item), responses, threshold); }
assert.equal(verdict(createCase(0), readings('tourism', 'tourism')).decision, 'approve');
assert.equal(verdict(createCase(1), readings('tourism', 'work')).decision, 'deny');
assert.equal(verdict(createCase(0), readings('tourism', 'tourism', 0.55)).decision, 'review');
assert.equal(verdict(createCase(2), readings('tourism', 'tourism')).decision, 'deny');
assert.equal(verdict(createCase(3), readings('work', 'work')).decision, 'deny');
assert.equal(verdict(createCase(5), readings('tourism', 'tourism')).decision, 'deny');
assert.equal(verdict(createCase(6), readings('work', 'work')).decision, 'approve');
assert.equal(verdict(createCase(7), readings('work', 'work')).decision, 'deny');
assert.equal(verdict(createCase(10), readings('work', 'work', 0.95, 0.05)).decision, 'deny');
assert.equal(verdict(createCase(6), readings('work', 'work', 0.95, 0.52)).decision, 'review');

const edited = createCase(0); edited.custom = true;
assert.equal(expectedAdmission(edited), null);
assert.equal(gradeDecision(edited, 'approve').kind, 'practice');
edited.passport.expires = TODAY;
assert.equal(documentChecks(edited).find(c => c.id === 'passport_date').ok, true);
edited.passport.expires = '2027-02-30';
assert.equal(documentChecks(edited).find(c => c.id === 'passport_date').ok, false);
edited.passport.expires = '2027-03-12'; edited.permit.issued = '2026-10-07';
assert.equal(documentChecks(edited).find(c => c.id === 'permit_date').ok, false);
edited.permit = null;
assert.equal(verdict(edited, readings('tourism', 'tourism')).decision, 'deny');

// No answer-key annotations or fabricated comparison conclusions can enter the semantic request.
for (const item of DECK) {
  const plan = translateDocuments(item);
  for (const request of plan.requests) {
    assert.deepEqual(Object.keys(requestPayload(request)), ['state', 'questions', 'model', 'lang']);
    assert.equal(request.state, request.id === 'permit' ? item.permit.text : request.id === 'declaration' ? item.declaration.text : item.letter.text);
    assert.ok(!Object.hasOwn(requestPayload(request), 'annotation'));
  }
}

const recording = JSON.parse(readFileSync(new URL('../static/data/checkpoint.json', import.meta.url)));
for (const item of DECK) {
  const plan = translateDocuments(item), record = recording.cases.find(row => row.id === item.id);
  assert.ok(record, `Missing recording for ${item.id}`);
  assert.equal(record.fingerprint, fingerprint(plan.requests), `Stale recording for ${item.id}`);
  for (const request of plan.requests) {
    assert.equal(record.responses[request.id].usage.output_tokens, 0);
    assert.equal(record.responses[request.id].usage.truncated, false);
  }
  const result = decideAdmission(item, plan, record.responses);
  assert.ok(['approve', 'deny', 'review'].includes(result.decision));
}
console.log(`Checkpoint policy, document translation, and ${DECK.length} faithful recordings verified.`);
