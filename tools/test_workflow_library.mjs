import assert from 'node:assert/strict';
import { WorkflowLibrary, LIBRARY_KEY, publishVersion, pinVersion, validateLibrary } from '../static/workflow-library.js';
import { executeWorkflow } from '../static/workflow-runtime.js';
import { EditorHistory } from '../static/workflow-history.js';

const body = {
  name: 'Customer name', librarySource: { id: 'previous', version: 3 },
  nodes: [{ id: 'in', type: 'input', config: {} }, { id: 'out', type: 'output', config: { value: '{{input.name}}' } }],
  edges: [{ id: 'e', from: 'in', fromPort: 'next', to: 'out' }],
};
let data = publishVersion({ version: 1, entries: [] }, { id: 'customer', kind: 'subflow', name: 'Customer name', workflow: body, input: { name: 'Ada' } });
const v1 = pinVersion(data.entries[0]);
assert.equal(v1.libraryRef.version, 1);
assert.equal(v1.workflow.librarySource, undefined, 'draft provenance does not become published provenance');
body.nodes[1].config.value = 'Hello {{input.name}}';
assert.equal(v1.workflow.nodes[1].config.value, '{{input.name}}', 'published versions do not share mutable draft data');
data = publishVersion(data, { id: 'customer', kind: 'subflow', name: 'Customer greeting', workflow: body, input: { name: 'Ada' }, baseVersion: 1 });
assert.equal(data.entries[0].versions.length, 2);
assert.equal(v1.libraryRef.version, 1, 'existing pins never auto-update');
assert.equal(pinVersion(data.entries[0], 1).workflow.nodes[1].config.value, '{{input.name}}', 'old versions stay available');
assert.throws(() => publishVersion(data, { id: 'customer', kind: 'subflow', name: 'stale', workflow: body, baseVersion: 1 }), /newer version/);
assert.throws(() => publishVersion(data, { id: 'customer', kind: 'template', name: 'wrong kind', workflow: body, baseVersion: 2 }), /cannot change kind/);

const caller = {
  nodes: [{ id: 'i', type: 'input', config: {} }, { id: 's', type: 'subflow', config: { ...v1, input: '{{input.customer}}', resultAs: 'result' } }, { id: 'o', type: 'output', config: { value: '{{result}}' } }],
  edges: [{ id: 'a', from: 'i', fromPort: 'next', to: 's' }, { id: 'b', from: 's', fromPort: 'done', to: 'o' }],
};
assert.equal((await executeWorkflow(JSON.parse(JSON.stringify(caller)), { customer: { name: 'Ada' } })).output, 'Ada', 'exports run from embedded bodies without the library');
const history = new EditorHistory(caller);
Object.assign(caller.nodes[1].config, pinVersion(data.entries[0]));
history.commit(caller);
assert.equal((await executeWorkflow(caller, { customer: { name: 'Ada' } })).output, 'Hello Ada');
const undone = history.undo();
assert.equal(undone.nodes[1].config.libraryRef.version, 1);
assert.equal((await executeWorkflow(undone, { customer: { name: 'Ada' } })).output, 'Ada');
assert.equal(data.entries[0].versions.length, 2, 'canvas undo does not delete published versions');

const memory = new Map();
const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const library = new WorkflowLibrary(storage);
storage.setItem(LIBRARY_KEY, JSON.stringify(data));
assert.equal(library.find('customer').versions.at(-1).number, 2);
assert.equal(library.find('missing'), null);
const template = library.publish({ id: 'template', kind: 'template', name: 'Example', workflow: caller, input: { customer: { name: 'Grace' } } });
assert.deepEqual(template.versions[0].input, { customer: { name: 'Grace' } });
assert.throws(() => pinVersion(template), /Only subflows/);
assert.throws(() => validateLibrary({ version: 1, entries: [{ id: 'broken' }] }), /Invalid library/);
storage.setItem = () => { throw new Error('Quota exceeded'); };
assert.throws(() => library.publish({ id: 'new', kind: 'subflow', name: 'New', workflow: body, input: {} }), /Quota exceeded/);
assert.equal(library.find('new'), null, 'failed persistence does not report a new entry');
console.log('workflow library tests passed');
