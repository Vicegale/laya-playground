import assert from 'node:assert/strict';
import { EditorHistory } from '../static/workflow-history.js';

const initial = { workflow: { nodes: [{ config: { workflow: { nodes: [] } } }], edges: [] }, runInput: { text: 'initial' } };
const history = new EditorHistory(initial, 3);
const edited = structuredClone(initial);
edited.workflow.nodes[0].config.workflow.nodes.push({ id: 'nested' });
history.commit(edited);
edited.workflow.nodes[0].config.workflow.nodes[0].id = 'later';
assert.deepEqual(history.undo(), initial, 'undo restores the entire nested graph');
assert.equal(history.redo().workflow.nodes[0].config.workflow.nodes[0].id, 'nested', 'snapshots are detached');

history.endGroup();
history.commit({ text: 'a' }, 'field');
history.commit({ text: 'ab' }, 'field');
history.commit({ text: 'abc' }, 'field');
assert.equal(history.undo().workflow.nodes[0].config.workflow.nodes[0].id, 'nested', 'typing is one edit');
assert.deepEqual(history.redo(), { text: 'abc' });
history.undo();
history.commit({ text: 'replacement' }, 'field');
assert.equal(history.canRedo, false, 'a new edit replaces the redo branch');

for (let i = 0; i < 10; i++) history.commit({ value: i });
assert.equal(history.entries.length, 4, 'history is bounded');
assert.deepEqual(history.undo(), { value: 8 });
assert.deepEqual(history.undo(), { value: 7 });
assert.deepEqual(history.undo(), { value: 6 });
assert.equal(history.undo(), null);
assert.deepEqual(history.redo(), { value: 7 });
console.log('workflow history tests passed');
