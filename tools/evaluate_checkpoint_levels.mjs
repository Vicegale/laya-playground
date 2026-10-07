// Real stock-model document parsing and admission; annotations are consulted only for grading.
// node tools/evaluate_checkpoint_levels.mjs --cases 120 --out /tmp/checkpoint-levels.json
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createShift } from '../static/demos/checkpoint-generator.js';
import { translateDocuments, requestPayload, decideAdmission, expectedAdmission } from '../static/demos/checkpoint.js';
import { LEVELS } from '../static/demos/checkpoint-levels.js';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const cases = Number(option('--cases', 120)), seed = option('--seed', 'level-evaluation-heldout');
const difficulties = option('--levels', Object.keys(LEVELS).join(',')).split(',');
const API = process.env.LAYA_API || 'http://127.0.0.1:8770', threshold = Number(option('--threshold', .6));
const entryPrompt = option('--entry-prompt', 'current');
assert.ok(['baseline', 'current'].includes(entryPrompt));
assert.ok(Number.isInteger(cases) && cases > 0 && cases <= 10000);
const health = await (await fetch(API + '/api/health')).json();
assert.equal(health.models.english, 'ready');
const reports = {};
for (const difficulty of difficulties) {
  const shift = createShift({ difficulty, seed, size: cases });
  const report = { cases, correct: 0, incorrect: 0, reviewed: 0, calls: 0, truncations: 0, maxTokens: 0,
    expected: { approve: 0, deny: 0 }, outcomes: { approve: 0, deny: 0, review: 0 }, faults: {}, questions: {}, failures: [], totalModelMs: 0 };
  const started = performance.now();
  for (let i = 0; i < cases; i++) {
    const item = shift.caseAt(i), plan = translateDocuments(item), responses = {}, sentRequests = [];
    for (const request of plan.requests) {
      const payload = structuredClone(requestPayload(request));
      if (entryPrompt === 'baseline' && payload.questions.route) payload.questions.route = { type: 'choice',
        instructions: request.id === 'declaration' ? 'What entry status does the traveler claim?' : 'What entry status does this document authorize?',
        criteria: { ordinary: 'holiday, transit, study or paid employment as an ordinary traveler',
          diplomatic: 'official embassy duties as an accredited diplomat', asylum: 'refugee protection and asylum' } };
      sentRequests.push(payload);
      const response = await fetch(API + '/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json(); responses[request.id] = result;
      report.calls++; report.totalModelMs += result.latency_ms;
      report.maxTokens = Math.max(report.maxTokens, result.usage?.input_tokens || 0);
      if (result.usage?.truncated) report.truncations++;
      for (const [qid, answer] of Object.entries(result.answers)) {
        // A withdrawn job states no current occupation; its meaningless sector reading is not graded.
        if (request.id === 'letter' && qid === 'sector' && !item.annotation.readings.letter.employment) continue;
        const key = request.id + '.' + qid, score = report.questions[key] ||= { correct: 0, total: 0 };
        const value = answer.type === 'noul' ? answer.noul >= .5 : answer.choice;
        score.total++; score.correct += Number(value === item.annotation.readings[request.id][qid]);
      }
    }
    const verdict = decideAdmission(item, plan, responses, threshold), expected = expectedAdmission(item);
    report.expected[expected]++; report.outcomes[verdict.decision]++;
    if (verdict.decision === 'review') report.reviewed++;
    else if (verdict.decision === expected) report.correct++;
    else report.incorrect++;
    for (const fault of item.generation.faults) {
      const row = report.faults[fault] ||= { cases: 0, correct: 0, incorrect: 0, reviewed: 0 };
      row.cases++; row[verdict.decision === 'review' ? 'reviewed' : verdict.decision === expected ? 'correct' : 'incorrect']++;
    }
    if (verdict.decision !== expected) report.failures.push({ arrival: i, expected, decision: verdict.decision, reasons: verdict.reasons,
      faults: item.generation.faults, requests: sentRequests, responses });
    if ((i + 1) % 40 === 0) console.log(difficulty, `${i + 1}/${cases}`, JSON.stringify({ correct: report.correct, incorrect: report.incorrect, reviewed: report.reviewed }));
  }
  report.wallMs = +(performance.now() - started).toFixed(1);
  assert.equal(report.truncations, 0, 'Documents must fit stock model context');
  reports[difficulty] = report;
  const { failures, faults, ...summary } = report; console.log(difficulty, JSON.stringify(summary));
}
const result = { tested: new Date().toISOString(), model: 'stock English', laya: health.version, device: health.device, seed, threshold, entryPrompt, reports };
const out = option('--out', null); if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
