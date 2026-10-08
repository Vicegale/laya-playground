import assert from 'node:assert/strict';
import { executeWorkflow } from '../static/workflow-runtime.js';
import { locateStep, listCountSummary } from '../static/workflow-diagnostics.js';
import { publishVersion, pinVersion } from '../static/workflow-library.js';

const n = (id, type, config = {}) => ({ id, label: id, type, config });
const e = (from, port, to) => ({ id: `${from}-${port}-${to}`, from, fromPort: port, to });
const collection = (type, config = {}) => n(type, type, { source: '{{input.items}}', resultAs: 'result', ...config });
const flow = (...operations) => ({ name: 'Collections', nodes: [n('in', 'input'), ...operations, n('out', 'output', { value: '{{result}}' })], edges: [e('in', 'next', operations[0].id), ...operations.map((node, i) => e(node.id, 'done', operations[i + 1]?.id || 'out'))] });
const items = [{ name: 'Ada', active: true }, { name: 'Ben', active: false }, { name: 'Cleo', active: true }];
const pipeline = flow(collection('filter', { conditions: [{ left: 'item.active', op: 'eq', right: 'true' }], resultAs: 'kept' }), collection('map', { source: '{{kept}}', value: '{{item.name}}' }));
const input = { items };
const result = await executeWorkflow(pipeline, input);
assert.deepEqual(result.output, ['Ada', 'Cleo']);
assert.deepEqual(input, { items }, 'Source input stays unchanged');
assert.deepEqual(result.trace.filter(t => t.type === 'filter-test').map(t => t.kept), [true, false, true]);
const mappedSteps = result.trace.filter(t => t.type === 'map-value');
assert.deepEqual(mappedSteps.map(t => t.scope.locals.index), [0, 1]);
assert.equal(mappedSteps[0].scope.input.name, 'Ada');
assert.equal(mappedSteps[0].scope.locals.parentInput.items.length, 3);
assert.equal(locateStep(pipeline, mappedSteps[0]).node.id, 'map');

const jsonMap = collection('map', { format: 'json', value: '{"name": {{input.name}}, "position": {{index}}, "group": {{parentInput.group}}}' });
assert.deepEqual((await executeWorkflow(flow(jsonMap), { items, group: 'team' })).output, items.map((item, index) => ({ name: item.name, position: index, group: 'team' })));
assert.deepEqual((await executeWorkflow(flow(collection('map', { value: '{{item}}' })), { items: [null, false, 0, '', { x: 1 }, [2]] })).output, [null, false, 0, '', { x: 1 }, [2]]);
assert.deepEqual((await executeWorkflow(flow(collection('map', { value: '' })), { items: [1, 2] })).output, ['', '']);
assert.deepEqual((await executeWorkflow(flow(collection('filter', { match: 'any', conditions: [{ left: 'item.active', op: 'eq', right: 'true' }, { left: 'item.name', op: 'eq', right: 'Ben' }] })), { items })).output, items);
for (const type of ['map', 'filter']) {
  assert.deepEqual((await executeWorkflow(flow(collection(type)), { items: [] })).output, []);
  await assert.rejects(executeWorkflow(flow(collection(type)), { items: {} }), /expected an array/);
  await assert.rejects(executeWorkflow(flow(collection(type, { resultAs: '' })), { items }), /Store list as/);
}

const mapBody = {
  nodes: [n('in', 'input'), n('set', 'set', { assignments: [{ path: 'scratch', value: '{{input.name}}' }] }), n('out', 'output', { format: 'json', value: '{"name": {{scratch}}, "position": {{index}}}' })],
  edges: [e('in', 'next', 'set'), e('set', 'next', 'out')],
};
const nestedMap = await executeWorkflow(flow(collection('map', { mode: 'workflow', workflow: mapBody })), { items });
assert.deepEqual(nestedMap.output, items.map((item, i) => ({ name: item.name, position: i })));
assert.equal(nestedMap.context.vars.scratch, undefined, 'Body variables must not escape their item');
assert.ok(nestedMap.trace.filter(t => t.nodeId === 'set').every(t => !('scratch' in t.scope.variables)), 'Variables must not leak across items');
assert.deepEqual(nestedMap.trace.find(t => t.nodeId === 'set').workflowPath, ['map']);

// A Filter predicate can ask Laya and then return a boolean through a Condition.
const predicate = {
  nodes: [n('in', 'input'), n('decide', 'decision', { decisionType: 'noul', key: 'keep', state: '{{input.name}}', question: 'Keep this name?' }), n('rule', 'condition', { conditions: [{ left: 'decisions.keep.noul', op: 'gte', right: '0.5' }] }), n('yes', 'output', { format: 'json', value: 'true' }), n('no', 'output', { format: 'json', value: 'false' })],
  edges: [e('in', 'next', 'decide'), e('decide', 'true', 'rule'), e('decide', 'false', 'rule'), e('rule', 'true', 'yes'), e('rule', 'false', 'no')],
};
const requests = [];
const predict = async req => { requests.push(req); return { answers: { keep: { noul: req.state === 'Ben' ? 0.1 : 0.9 } } }; };
const filtered = await executeWorkflow(flow(collection('filter', { mode: 'workflow', workflow: predicate })), { items }, { predict });
assert.deepEqual(filtered.output, [items[0], items[2]], 'Filter returns original objects rather than predicate outputs');
assert.deepEqual(requests.map(r => r.state), ['Ada', 'Ben', 'Cleo']);
assert.equal(filtered.trace.find(t => t.nodeId === 'filter').keptCount, 2);
assert.equal(filtered.trace.filter(t => t.nodeId === 'decide')[1].location, 'Collections → filter (item 2) → decide');

for (const invalid of ['false', '0', 'null', '{}', '[]']) {
  const format = invalid === 'false' ? 'value' : 'json';
  const badBody = { nodes: [n('out', 'output', { format, value: invalid })], edges: [] };
  await assert.rejects(executeWorkflow(flow(collection('filter', { mode: 'workflow', workflow: badBody })), { items }), error => {
    assert.equal(error.step.iterations[0].index, 0);
    assert.equal(error.step.nodeId, 'out');
    return /must return true or false/.test(error.message);
  });
}
await assert.rejects(executeWorkflow(flow(collection('map', { value: '{{item.missing}}' })), { items }), error => error.step.type === 'map-value' && error.step.references[0].missing && /undefined/.test(error.message));
await assert.rejects(executeWorkflow(flow(collection('map', { mode: 'workflow', workflow: { nodes: [n('in', 'input')], edges: [] } })), { items }), error => error.step.nodeId === 'in' && /unconnected output/.test(error.message));

// A linked library subflow can be composed within a Map body; its own output
// contract does not inherit a Filter's strict boolean requirement.
const library = publishVersion({ version: 1, entries: [] }, { id: 'name', kind: 'subflow', name: 'Name', workflow: { nodes: [n('out', 'output', { value: '{{input.name}}' })], edges: [] }, input: {} });
const linked = n('linked', 'subflow', { ...pinVersion(library.entries[0]), input: '{{item}}', resultAs: 'name' });
const linkedBody = { nodes: [linked, n('out', 'output', { value: '{{name}}' })], edges: [e('linked', 'done', 'out')] };
assert.deepEqual((await executeWorkflow(flow(collection('map', { mode: 'workflow', workflow: linkedBody })), { items })).output, ['Ada', 'Ben', 'Cleo']);
const linkedPredicate = { nodes: [linked, n('out', 'output', { format: 'json', value: 'true' })], edges: [e('linked', 'done', 'out')] };
assert.deepEqual((await executeWorkflow(flow(collection('filter', { mode: 'workflow', workflow: linkedPredicate })), { items })).output, items);

// Nested collection operations keep distinct item locations and original order.
const innerMap = collection('map', { source: '{{item.values}}', value: '{{item}}' });
const outer = flow(collection('map', { mode: 'workflow', workflow: flow(innerMap) }));
const nested = await executeWorkflow(outer, { items: [{ values: [1, 2] }, { values: [3] }] });
assert.deepEqual(nested.output, [[1, 2], [3]]);
assert.deepEqual(nested.trace.find(t => t.type === 'map-value').iterations.map(i => i.index), [0, 0]);
const big = await executeWorkflow(flow(collection('map')), { items: Array.from({ length: 1100 }, (_, i) => i) });
assert.equal(big.output.length, 1100);
assert.equal(big.output[1099], 1099);
assert.equal(big.trace.length, 1000);
assert.equal(big.traceOmitted, 103);
// Counts refer to full lists, including empty and shortened previews. Progress
// survives a nested failure without publishing the partial result variable.
assert.deepEqual(result.trace.find(t => t.type === 'filter').listCounts, { input: 3, output: 2, processed: 3 });
assert.deepEqual(result.trace.find(t => t.type === 'map').listCounts, { input: 2, output: 2, processed: 2 });
assert.equal(listCountSummary(result.trace.find(t => t.type === 'filter')), '3 in → 2 out');
assert.deepEqual(result.trace.at(-1).listCounts, { input: 2, output: 2 });
assert.equal(result.trace[0].listCounts, undefined, 'An object containing a list is not itself a list');
for (const type of ['map', 'filter']) {
  const empty = await executeWorkflow(flow(collection(type)), { items: [] });
  assert.deepEqual(empty.trace.find(t => t.type === type).listCounts, { input: 0, output: 0, processed: 0 });
}
const progress = [];
await executeWorkflow(pipeline, input, { onTrace: ({trace}) => {
  const step = trace.find(t => t.type === 'filter');
  if (step?.listCounts) progress.push({ ...step.listCounts, summary: listCountSummary(step) });
}});
assert.ok(progress.some(p => p.processed === 2 && p.output === 1 && p.summary === '3 in → 1 produced · 2/3 processed'));
const failingBody = { nodes: [n('out', 'output', { value: '{{item.value}}' })], edges: [] };
await assert.rejects(executeWorkflow(flow(collection('map', {mode:'workflow', workflow:failingBody})), {items:[{value:1},{}]}), error => {
  const parent = error.trace.find(t => t.type === 'map');
  assert.deepEqual(parent.listCounts, {input:2,output:1,processed:1});
  assert.equal(listCountSummary(parent), '2 in → 1 produced · 1/2 processed');
  assert.equal(parent.status, 'error');
  return true;
});
const identityBody = {nodes:[n('out','output',{value:'{{input}}'})],edges:[]};
const listSubflow = {nodes:[n('in','input'),n('sub','subflow',{workflow:identityBody,resultAs:'result'}),n('out','output',{value:'{{result}}'})],edges:[e('in','next','sub'),e('sub','done','out')]};
const lists = await executeWorkflow(listSubflow, Array.from({length:50},(_,i)=>i));
for (const step of lists.trace) assert.deepEqual(step.listCounts,{input:50,output:50});
assert.ok(lists.trace.at(-1).output.length < 50);
const eachBody = {nodes:[n('out','output',{value:'{{item}}'})],edges:[]};
const each = await executeWorkflow(flow(n('each','foreach',{source:'{{input.items}}',collectAs:'result',workflow:eachBody})),{items:[1,2,3]});
assert.deepEqual(each.trace.find(t=>t.type==='foreach').listCounts,{input:3,output:3,processed:3});
const scoped = nested.trace.filter(t=>t.type==='map');
assert.deepEqual(scoped.map(t=>t.listCounts.input),[2,2,1]);
assert.equal(listCountSummary({status:'success',listCounts:{output:0}}),'0 out');
assert.equal(listCountSummary({status:'running',listCounts:{input:50}}),'50 in');
assert.equal(listCountSummary({}), '');
console.log('Workflow Map/Filter checks passed.');
