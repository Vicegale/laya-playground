// Record the real model readings for the exact document deck used by the static checkpoint.
// LAYA_API=http://127.0.0.1:8770 node tools/record_checkpoint.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DECK, translateDocuments, requestPayload, fingerprint, decideAdmission, expectedAdmission } from '../static/demos/checkpoint.js';

const API = process.env.LAYA_API || 'http://127.0.0.1:8770';
const health = await (await fetch(API + '/api/health')).json();
if (health.models?.english !== 'ready') throw new Error('Start server.py and wait for the English checkpoint.');
async function predict(request) {
  const response = await fetch(API + '/api/predict', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload(request)),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  if (result.usage.truncated) throw new Error('Checkpoint input was truncated.');
  return result;
}

const warm = translateDocuments(DECK.find(item => item.letter)).requests;
for (const request of warm) await predict(request);
const cases = [], counts = { correct: 0, wrong: 0, review: 0 }, times = [];
for (const item of DECK) {
  const plan = translateDocuments(item), responses = {};
  for (const request of plan.requests) {
    responses[request.id] = await predict(request);
    times.push(responses[request.id].latency_ms);
  }
  const verdict = decideAdmission(item, plan, responses), expected = expectedAdmission(item);
  const kind = verdict.decision === 'review' ? 'review' : verdict.decision === expected ? 'correct' : 'wrong';
  counts[kind]++;
  cases.push({ id: item.id, fingerprint: fingerprint(plan.requests), responses });
  console.log(`${item.id}: ${verdict.decision.padEnd(7)} expected ${expected.padEnd(7)} ${kind}`);
}
times.sort((a, b) => a - b);
const summary = { ...counts, document_calls: times.length, median_document_ms: times[times.length >> 1] };
const data = { recorded: new Date().toISOString(), machine: process.env.MACHINE || `local ${health.device} (${health.torch})`,
  laya: health.version, threshold: 0.6, summary, cases };
writeFileSync(fileURLToPath(new URL('../static/data/checkpoint.json', import.meta.url)), JSON.stringify(data, null, 2) + '\n');
console.log('Recorded checkpoint:', JSON.stringify(summary));
