// Structural/truth regressions only; real model quality is measured separately.
import assert from 'node:assert/strict';
import { createShift } from '../static/demos/checkpoint-generator.js';
import { translateDocuments, decideAdmission, expectedAdmission, requestPayload, gradeDecision } from '../static/demos/checkpoint.js';
import { LEVELS, idealLevelReadings } from '../static/demos/checkpoint-levels.js';
import { LEVEL_FAULTS } from '../static/demos/checkpoint-level-generator.js';
for (const difficulty of Object.keys(LEVELS)) {
  const shift = createShift({ difficulty, seed: 'levels-coverage', size: 10000 });
  const counts = { approve: 0, deny: 0 }, coverage = new Set(), routes = new Set(), numbers = new Set();
  for (let i = 0; i < shift.size; i++) {
    const item = shift.caseAt(i), plan = translateDocuments(item), intended = item.generation.faults.length ? 'deny' : 'approve';
    assert.equal(expectedAdmission(item), intended, `${difficulty}/${i}: constructed truth`);
    const ideal = idealLevelReadings(item, plan);
    assert.equal(decideAdmission(item, plan, ideal).decision, intended, `${difficulty}/${i}: policy`);
    counts[intended]++; routes.add(item.annotation.readings.declaration.route);
    item.generation.faults.forEach(f => coverage.add(f));
    assert.ok(item.generation.faults.length <= (difficulty === 'easy' ? 1 : 3));
    if (item.passport) { assert.ok(!numbers.has(item.passport.number)); numbers.add(item.passport.number); }
    for (const request of plan.requests) {
      assert.equal(request.model, 'english'); assert.equal(request.lang, 'en');
      assert.ok(request.state.length < 1100, 'Bound short document inputs');
      assert.ok(!/\{\w+\}/.test(request.state), 'Unexpanded template');
      assert.deepEqual(Object.keys(requestPayload(request)), ['state', 'questions', 'model', 'lang']);
    }
    if (i < 100) {
      const altered = structuredClone(item); altered.annotation = { readings: {} }; altered.generation = { faults: ['invented'] }; altered.packet.reverse();
      assert.deepEqual(translateDocuments(altered), plan, 'No generator truth or packet ordering in inference');
      assert.equal(decideAdmission(altered, plan, ideal).decision, intended, 'No annotations in runtime policy');
    }
  }
  for (const f of LEVEL_FAULTS[difficulty]) assert.ok(coverage.has(f), `${difficulty}: uncovered ${f}`);
  assert.ok(counts.approve > 4400 && counts.approve < 5600);
  if (difficulty === 'hard') assert.deepEqual([...routes].sort(), ['asylum', 'diplomatic', 'ordinary']);
  assert.deepEqual(shift.caseAt(831), createShift({ ...shift }).caseAt(831));
  assert.notDeepEqual(shift.caseAt(831), createShift({ ...shift, seed: 'other' }).caseAt(831));
  for (let i = 0; i < 100; i++) {
    const good = createShift({ difficulty, seed: 'valid-boundary', size: 100, invalidRate: 0 }).caseAt(i);
    assert.equal(expectedAdmission(good), 'approve');
    const custom = structuredClone(good); custom.custom = true; assert.equal(gradeDecision(custom, 'approve').kind, 'practice');
  }
  console.log(difficulty, JSON.stringify({ cases: shift.size, counts, faultFamilies: coverage.size, routes: [...routes] }));
}
assert.throws(() => createShift({ difficulty: 'impossible' }), RangeError);
// Prove a wrong semantic reading can affect a valid packet: generator truth cannot rescue it.
const shift = createShift({ difficulty: 'hard', seed: 'policy-boundary', size: 100, invalidRate: 0 });
const ordinary = Array.from({ length: shift.size }, (_, i) => shift.caseAt(i)).find(item => item.access && item.annotation.declared === 'tourism');
const plan = translateDocuments(ordinary), readings = idealLevelReadings(ordinary, plan);
readings.vaccination.answers.coverage = { type: 'choice', choice: 'other', probabilities: { polio: .05, other: .95 } };
assert.equal(decideAdmission(ordinary, plan, readings).decision, 'deny');
readings.vaccination.answers.coverage = { type: 'choice', choice: 'polio', probabilities: { polio: .55, other: .45 } };
assert.equal(decideAdmission(ordinary, plan, readings).decision, 'review');
// A valid diplomatic exemption cannot be rejected for absence of the ordinary permit.
const diplomat = Array.from({ length: shift.size }, (_, i) => shift.caseAt(i)).find(item => item.diplomatic);
assert.equal(diplomat.permit, null); assert.ok(!diplomat.access);
assert.equal(decideAdmission(diplomat, translateDocuments(diplomat), idealLevelReadings(diplomat)).decision, 'approve');
// Entry status stays a real model choice. Neither the access permit nor fixture truth bypasses it.
const routeReadings = idealLevelReadings(ordinary, plan);
assert.deepEqual(Object.keys(plan.requests.find(r => r.id === 'declaration').questions.route.criteria).sort(), ['asylum', 'diplomatic', 'ordinary']);
routeReadings.declaration.answers.route = { type: 'choice', choice: 'ordinary', probabilities: { ordinary: .59, diplomatic: .3, asylum: .11 } };
const uncertainRoute = decideAdmission(ordinary, plan, routeReadings);
assert.equal(uncertainRoute.decision, 'review');
assert.match(uncertainRoute.reasons.join(' '), /entry status needs review \(Ordinary entry: 59\.00%; below 60%\)/);
routeReadings.declaration.answers.route = { type: 'choice', choice: 'diplomatic', probabilities: { ordinary: .1, diplomatic: .8, asylum: .1 } };
assert.equal(decideAdmission(ordinary, plan, routeReadings).decision, 'deny');
routeReadings.declaration.answers.route = { type: 'choice', choice: 'ordinary', probabilities: { ordinary: .6, diplomatic: .3, asylum: .1 } };
assert.equal(decideAdmission(ordinary, plan, routeReadings).decision, 'approve');
console.log('Level rules, every fault family, truthful packets, direct model-dependent cross-checks and no label leakage verified.');
