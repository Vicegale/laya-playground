// Check constructed truth, reproducibility and coverage over a large generated shift.
import assert from 'node:assert/strict';
import { createShift, generateCase, FAULTS, MAX_SHIFT_SIZE } from '../static/demos/checkpoint-generator.js';
import { DECK, translateDocuments, requestPayload, decideAdmission, expectedAdmission } from '../static/demos/checkpoint.js';

function idealReadings(item) {
  const choice = kind => ({ answers: { purpose: { type: 'choice', choice: kind, probabilities: { [kind]: 0.99 } } } });
  return { permit: choice(item.annotation.permitted), declaration: choice(item.annotation.declared),
    letter: { answers: { employment: { type: 'noul', noul: item.annotation.employment ? 0.99 : 0.01 } } } };
}

const shift = createShift({ size: MAX_SHIFT_SIZE, seed: 'coverage-2026', invalidRate: 0.5, maxFaults: 3 });
const counts = { approve: 0, deny: 0 }, faultCounts = {}, names = new Set(), numbers = new Set(), texts = new Set();
for (let i = 0; i < shift.size; i++) {
  const item = shift.caseAt(i), plan = translateDocuments(item);
  const intended = item.generation.faults.length ? 'deny' : 'approve';
  assert.equal(expectedAdmission(item), intended, `Invalid generated truth at ${i}`);
  assert.equal(decideAdmission(item, plan, idealReadings(item)).decision, intended, `Policy disagrees with constructed truth at ${i}`);
  counts[intended]++;
  names.add(item.declaration.holder);
  if (item.passport) { assert.ok(!numbers.has(item.passport.number)); numbers.add(item.passport.number); }
  for (const fault of item.generation.faults) faultCounts[fault] = (faultCounts[fault] || 0) + 1;
  assert.ok(item.generation.faults.length <= 3);
  for (const request of plan.requests) {
    texts.add(request.state);
    assert.ok(request.state.length < 320, 'Generated wording must fit the editor');
    assert.ok(!/\{\w+\}/.test(request.state), 'Unexpanded template');
    assert.deepEqual(Object.keys(requestPayload(request)), ['state', 'questions', 'model', 'lang']);
  }
  // Annotation changes must not affect input or admission: only constructed papers + model answers count.
  const altered = structuredClone(item); altered.annotation = { declared: 'invented', permitted: 'invented', employment: !item.annotation.employment };
  assert.deepEqual(translateDocuments(altered), plan);
  assert.equal(decideAdmission(altered, plan, idealReadings(item)).decision, intended);
}
assert.ok(counts.approve > 4500 && counts.approve < 5500, 'Requested random mix drifted');
for (const fault of FAULTS) assert.ok(faultCounts[fault] > 0, `Missing fault family ${fault}`);
assert.ok(names.size > 900 && texts.size > 1000, 'Insufficient variety');
assert.deepEqual(shift.caseAt(7890), createShift({ ...shift }).caseAt(7890));
assert.notDeepEqual(shift.caseAt(7890), createShift({ ...shift, seed: 'another-seed' }).caseAt(7890));
const mutated = shift.caseAt(500); mutated.declaration.text = 'Changed by caller';
assert.notEqual(shift.caseAt(500).declaration.text, mutated.declaration.text, 'Cases must not share mutable data');
for (let i = 0; i < 1000; i++) {
  assert.equal(expectedAdmission(generateCase('valid', i, { invalidRate: 0 })), 'approve');
  const bad = generateCase('invalid', i, { invalidRate: 1, maxFaults: 1 });
  assert.equal(expectedAdmission(bad), 'deny'); assert.equal(bad.generation.faults.length, 1);
}
const demo = createShift({ mode: 'demo' });
assert.equal(demo.size, DECK.length);
assert.deepEqual(demo.caseAt(3), DECK[3]);
for (const options of [{ size: 0 }, { size: 10001 }, { size: 1.5 }, { seed: '' }, { invalidRate: 1.1 }, { maxFaults: 2 }, { mode: 'unknown' }]) {
  assert.throws(() => createShift(options), RangeError);
}
assert.throws(() => shift.caseAt(-1), RangeError);
assert.throws(() => shift.caseAt(shift.size), RangeError);
console.log(JSON.stringify({ cases: shift.size, counts, names: names.size, distinctTexts: texts.size, faultCounts }, null, 2));
console.log('Generated truth, no answer-key leakage, seeded replay, bounds and all fault families verified.');
