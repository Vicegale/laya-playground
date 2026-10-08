import assert from 'node:assert/strict';
import { executeWorkflow, WorkflowExecutionError } from '../static/workflow-runtime.js';
import { previewValue, locateStep } from '../static/workflow-diagnostics.js';

const n = (id, type, config = {}) => ({ id, label: id, type, config });
const e = (from, port, to) => ({ id: `${from}-${port}-${to}`, from, fromPort: port, to });
const decision = state => n('classify', 'decision', { key: 'label', state, options: [{ key: 'yes' }, { key: 'no' }] });
const body = {
  nodes: [n('in', 'input'), decision('{{item.text}}'), n('out', 'output', { value: '{{decisions.label.choice}}' })],
  edges: [e('in', 'next', 'classify'), e('classify', 'yes', 'out')],
};
const flow = {
  name: 'List', nodes: [n('start', 'input'), n('loop', 'foreach', { source: '{{input.items}}', workflow: body, collectAs: 'results' }), n('end', 'output', { value: '{{results}}' })],
  edges: [e('start', 'next', 'loop'), e('loop', 'done', 'end')],
};
let calls = 0;
const predict = async () => { calls++; return { answers: { label: { choice: 'yes', probabilities: { yes: 0.8, no: 0.2 } } } }; };
const updates = [];
let failure;
try { await executeWorkflow(flow, { items: [{ text: 'first' }, { title: 'wrong field' }] }, { predict, onTrace: ({ trace }) => updates.push(trace.map(t => ({ sequence: t.sequence, status: t.status, requestSent: t.requestSent }))) }); }
catch (error) { failure = error; }
assert.ok(failure instanceof WorkflowExecutionError);
assert.match(failure.message, /item.text.*missing/);
assert.equal(calls, 1, 'Missing state must fail before requesting inference');
assert.equal(failure.step.nodeId, 'classify');
assert.equal(failure.step.location, 'List → loop (item 2) → classify');
assert.deepEqual(failure.step.workflowPath, ['loop']);
assert.equal(failure.step.iterations[0].index, 1);
assert.equal(failure.step.scope.locals.item.title, 'wrong field');
assert.equal(failure.step.scope.locals.index, 1);
assert.equal(failure.step.stateType, 'undefined');
assert.equal(failure.step.requestSent, false);
assert.equal(failure.step.references[0].missing, true);
assert.equal(failure.trace.find(t => t.nodeId === 'out').status, 'success');
assert.equal(failure.trace.find(t => t.nodeId === 'loop').status, 'error');
assert.ok(failure.trace.every(t => typeof t.durationMs === 'number'));
assert.ok(updates.some(rows => rows.some(t => t.status === 'running' && t.requestSent)), 'Waiting step streams before inference returns');
assert.equal(updates.at(-1).find(t => t.sequence === failure.step.sequence).status, 'error');
assert.equal(locateStep(flow, failure.step).node.id, 'classify');
assert.equal(locateStep(flow, failure.step).frames.length, 2);
assert.equal(locateStep({ nodes: [], edges: [] }, failure.step), null);

const simple = state => ({ nodes: [decision(state), n('done', 'output', { value: 'finished' })], edges: [e('classify', 'yes', 'done')] });
for (const empty of [null, '', '   ', {}, []]) {
  calls = 0;
  await assert.rejects(executeWorkflow(simple('{{input}}'), empty, { predict }), /empty/);
  assert.equal(calls, 0);
}
for (const value of [false, 0]) {
  assert.equal((await executeWorkflow(simple('{{input}}'), value, { predict })).output, 'finished');
}
const mixed = await executeWorkflow(simple('Text {{input.absent}} end'), {}, { predict });
assert.equal(mixed.trace[0].status, 'warning');
assert.equal(mixed.trace[0].state, 'Text  end');
assert.equal(mixed.trace[0].references[0].missing, true);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'model unavailable', model: 'test' }), { status: 503 });
  await assert.rejects(executeWorkflow(simple('{{input}}'), 'data'), error => {
    assert.equal(error.step.httpStatus, 503);
    assert.equal(error.step.response.model, 'test');
    assert.equal(error.step.requestSent, true);
    return /model unavailable/.test(error.message);
  });
} finally { globalThis.fetch = originalFetch; }

const condition = { nodes: [n('check', 'condition', { conditions: [{ left: 'input.missing', op: 'not_exists', right: '' }] }), n('done', 'output', { value: 'okay' })], edges: [e('check', 'true', 'done')] };
const checked = await executeWorkflow(condition, {});
assert.equal(checked.output, 'okay');
assert.equal(checked.trace[0].tests[0].passed, true);
assert.equal(checked.trace[0].references[0].missing, true);
assert.equal(checked.trace[0].status, 'success', 'Intentional missing-field tests are not warnings');
assert.equal(checked.trace[0].edgeId, 'check-true-done');

const disconnected = await executeWorkflow({ nodes: [n('in', 'input')], edges: [] }, 'text');
assert.equal(disconnected.trace[0].status, 'warning');
assert.match(disconnected.trace[0].warnings[0], /No connection.*next/);
await assert.rejects(executeWorkflow({ nodes: [n('in', 'input')], edges: [e('in', 'next', 'deleted')] }, {}), error => error.step.nodeId === 'in' && /missing node/.test(error.message));
await assert.rejects(executeWorkflow({ nodes: [n('out', 'output', { format: 'json', value: '{"x": {{input.missing}}}' })], edges: [] }, {}), error => error.step.references[0].missing && error.step.status === 'error');

const large = { text: 'x'.repeat(30000), items: Array.from({ length: 600 }, (_, i) => ({ i })) };
const preview = previewValue(large);
large.items[0].i = 99;
assert.equal(preview.items[0].i, 0, 'Trace values remain detached from live objects');
assert.match(preview.text, /characters omitted/);
assert.equal(preview.items.length, 13);
assert.ok(JSON.stringify(preview).length < 10000);
const longFlow = structuredClone(flow);
longFlow.nodes[1].config.workflow = { nodes: [n('in', 'input'), n('out', 'output', { value: '{{item.i}}' })], edges: [e('in', 'next', 'out')] };
const longRun = await executeWorkflow(longFlow, large);
assert.equal(longRun.output.length, 600, 'Preview truncation must never truncate actual data');
assert.equal(longRun.trace.length, 1000);
assert.equal(longRun.traceOmitted, 203);
assert.equal(longRun.trace.at(-1).sequence, 1203);
assert.ok(longRun.trace.every(t => t.status !== 'running'));
assert.equal(JSON.parse(JSON.stringify(failure.trace)).at(-1).state, '[undefined]');
console.log('Workflow diagnostics checks passed.');
