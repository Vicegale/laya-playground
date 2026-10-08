import assert from 'node:assert/strict';
import { InspectionHistory, HISTORY_LIMIT } from '../static/demos/checkpoint-history.js';

const history = new InspectionHistory();
const input = { arrival: 1, item: { passport: { holder: 'Original traveler' }, packet: ['passport'] },
  plan: { requests: [{ state: 'Original document' }], checks: [{ ok: true }] },
  responses: { passport: { answers: { nationality: { choice: 'aster', probabilities: { aster: 0.8 } } } } },
  outcome: { decision: 'approve', grade: { kind: 'citation' }, reasons: ['Original reason'] }, source: 'live' };
history.record(input);
input.item.passport.holder = 'Edited traveler';
input.plan.requests[0].state = 'Next document';
input.plan.checks[0].ok = false;
input.responses.passport.answers.nationality.probabilities.aster = 0.1;
input.outcome.reasons[0] = 'Next reason';
const saved = history.results.approve[0];
assert.equal(saved.item.passport.holder, 'Original traveler');
assert.equal(saved.plan.requests[0].state, 'Original document');
assert.equal(saved.plan.checks[0].ok, true);
assert.equal(saved.responses.passport.answers.nationality.probabilities.aster, 0.8);
assert.deepEqual(saved.outcome.reasons, ['Original reason']);
// Verdict buckets must preserve mistakes, rather than sorting by the grading key.
assert.equal(saved.outcome.grade.kind, 'citation');
assert.equal(history.results.deny.length, 0);
for (let arrival = 2; arrival <= 10000; arrival++) {
  for (const decision of ['approve', 'deny', 'review']) history.record({ ...input, arrival, outcome: { decision } });
}
for (const rows of Object.values(history.results)) {
  assert.equal(rows.length, HISTORY_LIMIT);
  assert.deepEqual(rows.map(row => row.arrival), [10000, 9999, 9998, 9997, 9996]);
}
assert.throws(() => history.record({ outcome: { decision: 'unknown' } }));
history.reset();
assert.deepEqual(history.results, { approve: [], deny: [], review: [] });
console.log('Recent inspections: immutable papers/readings/reasons, verdict buckets, five-per-result bounds at 10,000 arrivals, newest-first order and shift reset verified.');
