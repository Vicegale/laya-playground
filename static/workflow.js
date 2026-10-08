import { clone, executeWorkflow } from './workflow-runtime.js';
import { EditorHistory } from './workflow-history.js';
import { createLibraryUI } from './workflow-library-ui.js';
import { createTraceUI } from './workflow-trace-ui.js';
import { locateStep } from './workflow-diagnostics.js';
import { canvasLayout, hasBody, nodeKey } from './workflow-canvas-model.js';
import { parseCSV } from './workflow-csv.js';

const { Graph } = window.X6 || {};
if (!Graph) throw new Error('AntV X6 failed to load.');

const $ = sel => document.querySelector(sel);
const eventFor = el => el?.tagName === 'SELECT' ? 'change' : 'input';
function showUiError(error) {
  console.error(error);
  const summary = $('#runSummary');
  if (summary) summary.textContent = `UI error: ${error?.message || error}`;
}
function on(el, event, handler) {
  if (!el) return;
  el.addEventListener(event, e => {
    try {
      const result = handler(e);
      if (result && typeof result.then === 'function') result.catch(showUiError);
    } catch (error) {
      showUiError(error);
    }
  });
}
const uid = prefix => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

const COLORS = {
  input: '#8ecae6', csv: '#78d5bc', 'csv-output': '#78d5bc', decision: '#e9c46a', condition: '#b8c0ff', switch: '#a4b6ff', set: '#90be6d', foreach: '#f4a261', map: '#67d4d2', filter: '#f2a8d0', groupby: '#97c5ff', subflow: '#c77dff', output: '#80ed99',
};
const ICONS = { input: 'IN', csv: 'CSV', 'csv-output': 'CSV', decision: '◆', condition: '◇', switch: '⑂', set: '=', foreach: '↻', map: '↦', filter: '▽', groupby: '▤', 'map-value': '↦', 'filter-test': '▽', subflow: '◫', output: 'OUT' };
const TYPES = [
  ['input', 'Input', 'Entry point and runtime input'],
  ['csv', 'CSV Input', 'Read a file into rows'],
  ['decision', 'Decision', 'Ask Laya one typed question'],
  ['condition', 'Condition', 'Branch on an exact rule'],
  ['switch', 'Switch', 'Route an exact value across named cases'],
  ['set', 'Set', 'Save values for later steps'],
  ['foreach', 'For Each', 'Run a nested workflow for every item'],
  ['map', 'Map', 'Transform every item into a new value'],
  ['filter', 'Filter', 'Keep items that pass a rule or predicate'],
  ['groupby', 'Group By', 'Collect list items into groups by a field'],
  ['subflow', 'Subflow', 'Run a nested workflow once'],
  ['output', 'Output', 'Return a workflow value'],
  ['csv-output', 'CSV Output', 'Download rows with original and new columns'],
];

function emptyWorkflow() { return { version: 1, name: 'Workflow', nodes: [], edges: [] }; }
function childWorkflow(name = 'Nested workflow') {
  const input = makeNode('input', 80, 120); input.label = 'Scope';
  const out = makeNode('output', 420, 120); out.label = 'Result'; out.config.value = '{{input}}';
  return { version: 1, name, nodes: [input, out], edges: [{ id: uid('edge'), from: input.id, fromPort: 'next', to: out.id }] };
}
function makeNode(type, x = 220, y = 160) {
  const node = { id: uid(type), type, label: TYPES.find(t => t[0] === type)?.[1] || type, position: { x, y }, config: {} };
  if (type === 'decision') node.config = {
    decisionType: 'choice', key: `decision_${Math.random().toString(36).slice(2, 6)}`,
    state: '{{input}}', question: 'Which option best describes this?', resultAs: '',
    options: [{ key: 'option_a', label: 'Option A', description: 'The first case.' }, { key: 'option_b', label: 'Option B', description: 'The second case.' }],
    threshold: 0.5, trueCriterion: '', falseCriterion: '',
  };
  if (type === 'condition') node.config = { mode: 'all', conditions: [{ left: 'input.value', op: 'eq', right: 'example' }] };
  if (type === 'switch') node.config = { value: '{{input.value}}', cases: [{ key: 'case_a', format: 'text', value: 'a' }, { key: 'case_b', format: 'text', value: 'b' }] };
  if (type === 'set') node.config = { assignments: [{ path: 'value', value: '{{input.value}}' }] };
  if (type === 'foreach') node.config = { source: '{{input.items}}', itemVar: 'item', indexVar: 'index', collectAs: 'results', workflow: childWorkflow('Loop body') };
  if (type === 'map') node.config = { source: '{{input.items}}', resultAs: 'mapped', mode: 'value', format: 'value', value: '{{item}}', workflow: childWorkflow('Map body') };
  if (type === 'filter') {
    const body = childWorkflow('Filter predicate');
    Object.assign(body.nodes.find(n => n.type === 'output').config, { format: 'json', value: 'true' });
    node.config = { source: '{{input.items}}', resultAs: 'filtered', mode: 'conditions', match: 'all', conditions: [{ left: 'item.active', op: 'eq', right: 'true' }], workflow: body };
  }
  if (type === 'groupby') node.config = { source: '{{input.items}}', key: '{{item.category}}', resultAs: 'groups', outputFormat: 'keyed' };
  if (type === 'subflow') node.config = { resultAs: 'subflowResult', workflow: childWorkflow('Subflow') };
  if (type === 'output') node.config = { format: 'value', value: '{{input}}' };
  if (type === 'csv') node.config = { mode: 'file', content: '', filename: '', delimiter: 'auto', resultAs: 'rows' };
  if (type === 'csv-output') node.config = { source: '{{rows}}', columns: '{{rowsCsv.columns}}', filename: 'tagged.csv', delimiter: ',', bom: true };
  return node;
}

function listClassifierExample() {
  const root = emptyWorkflow(); root.name = 'Classify a list';
  const input = makeNode('input', 60, 160); input.label = 'Input';
  const loop = makeNode('foreach', 320, 150); loop.label = 'For each item';
  loop.config.source = '{{input.items}}'; loop.config.itemVar = 'item'; loop.config.indexVar = 'index'; loop.config.collectAs = 'classified';
  const body = emptyWorkflow(); body.name = 'For each item';
  const bi = makeNode('input', 50, 140); bi.label = 'Loop item';
  const dec = makeNode('decision', 290, 120); dec.label = 'Classify item'; dec.config.key = 'classify'; dec.config.state = '{{item.text}}'; dec.config.question = 'Which category best describes this item?';
  dec.config.options = [
    { key: 'alpha', label: 'Alpha', description: 'The text belongs to category alpha.' },
    { key: 'beta', label: 'Beta', description: 'The text belongs to category beta.' },
    { key: 'other', label: 'Other', description: 'The text belongs to neither alpha nor beta.' },
  ];
  const bo = makeNode('output', 590, 120); bo.label = 'Collect result'; bo.config.format = 'json'; bo.config.value = '{"index": {{index}}, "item": {{item}}, "category": {{decisions.classify.choice}}, "confidence": {{decisions.classify.confidence}}}';
  body.nodes = [bi, dec, bo];
  body.edges = [
    { id: uid('edge'), from: bi.id, fromPort: 'next', to: dec.id },
    { id: uid('edge'), from: dec.id, fromPort: 'alpha', to: bo.id },
    { id: uid('edge'), from: dec.id, fromPort: 'beta', to: bo.id },
    { id: uid('edge'), from: dec.id, fromPort: 'other', to: bo.id },
  ];
  loop.config.workflow = body;
  const out = makeNode('output', 610, 150); out.label = 'Results'; out.config.value = '{{classified}}';
  root.nodes = [input, loop, out];
  root.edges = [
    { id: uid('edge'), from: input.id, fromPort: 'next', to: loop.id },
    { id: uid('edge'), from: loop.id, fromPort: 'done', to: out.id },
  ];
  return { workflow: root, input: { items: [{ text: 'Example text for alpha.' }, { text: 'Example text for beta.' }] } };
}

function branchExample() {
  const root = emptyWorkflow(); root.name = 'Semantic branch + exact rule';
  const input = makeNode('input', 60, 150);
  const dec = makeNode('decision', 280, 120); dec.label = 'Interpret'; dec.config.key = 'kind'; dec.config.state = '{{input.text}}'; dec.config.question = 'Which description best fits the text?';
  dec.config.options = [
    { key: 'allowed', label: 'Allowed', description: 'The text clearly describes an allowed case.' },
    { key: 'blocked', label: 'Blocked', description: 'The text clearly describes a blocked case.' },
    { key: 'unclear', label: 'Unclear', description: 'The text does not provide enough information.' },
  ];
  const set = makeNode('set', 550, 40); set.label = 'Mark accepted'; set.config.assignments = [{ path: 'status', value: 'accepted' }];
  const cond = makeNode('condition', 550, 170); cond.label = 'High confidence?'; cond.config.conditions = [{ left: 'decisions.kind.confidence', op: 'gte', right: '0.75' }];
  const yes = makeNode('output', 820, 90); yes.label = 'Accepted'; yes.config.value = '{{status}}';
  const review = makeNode('output', 820, 220); review.label = 'Review'; review.config.value = 'manual_review';
  root.nodes = [input, dec, set, cond, yes, review];
  root.edges = [
    { id: uid('edge'), from: input.id, fromPort: 'next', to: dec.id },
    { id: uid('edge'), from: dec.id, fromPort: 'allowed', to: set.id },
    { id: uid('edge'), from: dec.id, fromPort: 'blocked', to: review.id },
    { id: uid('edge'), from: dec.id, fromPort: 'unclear', to: review.id },
    { id: uid('edge'), from: set.id, fromPort: 'next', to: cond.id },
    { id: uid('edge'), from: cond.id, fromPort: 'true', to: yes.id },
    { id: uid('edge'), from: cond.id, fromPort: 'false', to: review.id },
  ];
  return { workflow: root, input: { text: 'Describe something here.' } };
}

function switchExample() {
  const root = emptyWorkflow(); root.name = 'Route by email type';
  const input = makeNode('input', 50, 180);
  const route = makeNode('switch', 330, 180); route.label = 'Route email type';
  route.config = { value: '{{input.email_type}}', cases: [{ key: 'support', format: 'text', value: 'support' }, { key: 'billing', format: 'text', value: 'billing' }] };
  const outputs = ['support', 'billing', 'default'].map((key, i) => {
    const node = makeNode('output', 650, 60 + i * 175); node.label = key === 'default' ? 'Other email' : `${key} email`;
    node.config = { format: 'json', value: `{"route":"${key}","email": {{input}}}` }; return node;
  });
  root.nodes = [input, route, ...outputs];
  root.edges = [{ id: uid('edge'), from: input.id, fromPort: 'next', to: route.id }, ...outputs.map((node, i) => ({ id: uid('edge'), from: route.id, fromPort: ['support', 'billing', 'default'][i], to: node.id }))];
  return { workflow: root, input: { email_type: 'support', subject: 'I cannot sign in.' } };
}

function groupEmailsExample() {
  const root = emptyWorkflow(); root.name = 'Group emails and export';
  const csv = makeNode('csv', 50, 140); csv.label = 'Read tagged emails';
  csv.config.filename = 'tagged-emails.csv';
  csv.config.content = 'id,email_type,subject\r\n001,support,Cannot sign in\r\n002,billing,Invoice question\r\n003,support,Reset my password\r\n004,sales,Request a demo\r\n005,billing,Refund request\r\n';
  const group = makeNode('groupby', 350, 140); group.label = 'Group email types';
  group.config = { source: '{{rows}}', key: '{{item.email_type}}', resultAs: 'email_groups', outputFormat: 'list' };
  const each = makeNode('foreach', 650, 140); each.label = 'Export each group';
  const output = makeNode('csv-output', 50, 120); output.label = 'Export group CSV';
  output.config = { source: '{{group.items}}', columns: '{{rowsCsv.columns}}', filename: 'emails-{{group.key}}.csv', delimiter: ',', bom: true };
  each.config = { source: '{{email_groups}}', itemVar: 'group', indexVar: 'groupIndex', collectAs: 'exports', workflow: { version: 1, name: 'Export email group', nodes: [output], edges: [] } };
  const summary = makeNode('output', 980, 140); summary.label = 'Group counts';
  summary.config.value = '{{email_groups}}';
  root.nodes = [csv, group, each, summary];
  root.edges = [[csv, 'next', group], [group, 'done', each], [each, 'done', summary]].map(([from, port, to]) => ({ id: uid('edge'), from: from.id, fromPort: port, to: to.id }));
  return { workflow: root, input: {} };
}

function keyedGroupsExample() {
  const example = groupEmailsExample(); const root = example.workflow;
  root.name = 'Export other emails';
  const [csv, group] = root.nodes;
  csv.config.content = csv.config.content.replace('004,sales,Request a demo', '004,other,Team meeting notes');
  group.config = { ...group.config, resultAs: 'groups', outputFormat: 'keyed' };
  const output = makeNode('csv-output', 650, 140); output.label = 'Export other emails';
  output.config = { source: '{{groups.other}}', columns: '{{rowsCsv.columns}}', filename: 'other-emails.csv', delimiter: ',', bom: true };
  root.nodes = [csv, group, output];
  root.edges = [[csv, 'next', group], [group, 'done', output]].map(([from, port, to]) => ({ id: uid('edge'), from: from.id, fromPort: port, to: to.id }));
  return example;
}

function mapFilterExample() {
  const root = emptyWorkflow(); root.name = 'Filter and map a list';
  const input = makeNode('input', 50, 140);
  const filter = makeNode('filter', 300, 140); filter.label = 'Keep active items';
  const map = makeNode('map', 550, 140); map.label = 'Extract names'; map.config.source = '{{filtered}}'; map.config.value = '{{item.name}}';
  const out = makeNode('output', 800, 140); out.config.value = '{{mapped}}';
  root.nodes = [input, filter, map, out];
  root.edges = [[input, 'next', filter], [filter, 'done', map], [map, 'done', out]].map(([from, port, to]) => ({ id: uid('edge'), from: from.id, fromPort: port, to: to.id }));
  return { workflow: root, input: { items: [{ name: 'Ada', active: true }, { name: 'Ben', active: false }, { name: 'Cleo', active: true }] } };
}

function csvTaggingExample() {
  const root = emptyWorkflow(); root.name = 'Tag CSV rows';
  const csv = makeNode('csv', 50, 140); csv.label = 'Read CSV';
  csv.config.filename = 'messages.csv';
  csv.config.content = 'id,text\r\n001,"I need help resetting my password."\r\n002,"Please send me a copy of my invoice."\r\n003,"Can you add a dark mode?"\r\n';
  const map = makeNode('map', 340, 140); map.label = 'Tag each row';
  Object.assign(map.config, { source: '{{rows}}', resultAs: 'tagged', mode: 'workflow', keepOriginal: true });
  const body = emptyWorkflow(); body.name = 'Tag row';
  const input = makeNode('input', 50, 140); input.label = 'CSV row';
  const decision = makeNode('decision', 310, 140); decision.label = 'Classify message';
  Object.assign(decision.config, { key: 'category', state: '{{item.text}}', question: 'What is this message about?', options: [
    { key: 'support', label: 'Support', description: 'Help fixing a problem or accessing an account.' },
    { key: 'billing', label: 'Billing', description: 'An invoice, payment, charge or subscription billing.' },
    { key: 'feature', label: 'Feature request', description: 'A request to add or improve product functionality.' },
    { key: 'other', label: 'Other', description: 'Another topic.' },
  ] });
  const output = makeNode('output', 590, 140); output.label = 'New columns';
  Object.assign(output.config, { format: 'json', value: '{"category": {{decisions.category.choice}}, "confidence": {{decisions.category.confidence}}}' });
  body.nodes = [input, decision, output];
  body.edges = [{ id: uid('edge'), from: input.id, fromPort: 'next', to: decision.id }, ...decision.config.options.map(o => ({ id: uid('edge'), from: decision.id, fromPort: o.key, to: output.id }))];
  map.config.workflow = body;
  const download = makeNode('csv-output', 680, 140); download.label = 'Tagged CSV'; download.config.source = '{{tagged}}';
  root.nodes = [csv, map, download];
  root.edges = [{ id: uid('edge'), from: csv.id, fromPort: 'next', to: map.id }, { id: uid('edge'), from: map.id, fromPort: 'done', to: download.id }];
  return { workflow: root, input: {} };
}

const EXAMPLES = { list: listClassifierExample, branch: branchExample, collections: mapFilterExample, csv: csvTaggingExample, switch: switchExample, groups: groupEmailsExample, 'keyed-groups': keyedGroupsExample };
let workflow = clone(listClassifierExample().workflow);
let runInput = clone(listClassifierExample().input);
let stack = [{ workflow, label: workflow.name }];
let selectedNodeId = null;
let selectedEdgeId = null;
let graph;
let renderingGraph = false;
let dirty = false;
let running = false;
let history;
let libraryUI;
let traceUI;
let restoredInputText = null;
let lastInputText = null;
let canvasRecords = { nodes: [], edges: [] };
const expansion = new Map();
let previewSelection = null;
const currentPath = () => stack.slice(1).map(s => s.owner);
const selectedRecord = () => previewSelection || canvasRecords.nodes.find(r => !r.preview && r.node.id === selectedNodeId) || null;
const contextRecords = () => stack.slice(1).map((frame, i) => { const path = currentPath().slice(0, i); const node = stack[i].workflow.nodes.find(n => n.id === frame.owner); return { path, node, key: nodeKey(path, node.id) }; });

function isReadOnly() { return stack.some(s => s.linked); }

function editorSnapshot() {
  return { workflow, runInput, inputText: $('#runInput').value };
}
function updateEditingTools() {
  updateInputPanel();
  $('#undoBtn').disabled = !history?.canUndo;
  $('#redoBtn').disabled = !history?.canRedo;
  const node = currentNode();
  $('#duplicateBtn').disabled = isReadOnly() || !node || node.type === 'input';
  const source = currentWorkflow().librarySource;
  $('#canvasMode').textContent = isReadOnly() ? 'Pinned library body · read only' : source ? `Library draft · based on v${source.version}` : '';
  document.querySelectorAll('.palette-node').forEach(b => { b.disabled = isReadOnly(); });
}
function restoreEdit(snapshot) {
  if (!snapshot) return;
  traceUI?.markEdited();
  previewSelection = null;
  const owners = stack.slice(1).map(s => s.owner);
  workflow = snapshot.workflow; runInput = snapshot.runInput;
  stack = [{ workflow, label: workflow.name || 'Workflow' }];
  for (const id of owners) {
    const owner = currentWorkflow().nodes.find(n => n.id === id);
    if (!owner?.config?.workflow) break;
    stack.push({ workflow: owner.config.workflow, label: owner.label, owner: id, linked: !!owner.config.libraryRef });
  }
  if (!currentNode()) selectedNodeId = null;
  if (!currentWorkflow().edges.some(e => e.id === selectedEdgeId)) selectedEdgeId = null;
  $('#workflowName').value = workflow.name || 'Workflow';
  $('#runInput').value = snapshot.inputText ?? (typeof runInput === 'string' ? runInput : pretty(runInput));
  persist(); renderGraph(); updateEditingTools();
}
function duplicateNode() {
  const source = currentNode();
  if (isReadOnly() || !source || source.type === 'input') return;
  const copy = clone(source);
  copy.id = uid(copy.type);
  copy.label = `${source.label || source.type} copy`;
  copy.position = { x: source.position.x + 32, y: source.position.y + 32 };
  if (copy.type === 'decision') copy.config.key = `decision_${uid('copy').slice(5)}`;
  currentWorkflow().nodes.push(copy);
  selectedNodeId = copy.id; selectedEdgeId = null;
  previewSelection = null; markDirty(); renderGraph(true);
}

function currentWorkflow() { return stack.at(-1).workflow; }
function currentNode() { return currentWorkflow().nodes.find(n => n.id === selectedNodeId) || null; }
function markDirty(group = null) {
  traceUI?.markEdited();
  dirty = true; persist(); history?.commit(editorSnapshot(), group); updateEditingTools();
}
function persist() {
  const status = $('#saveState');
  try {
    localStorage.setItem('laya-workflow-v1', JSON.stringify(editorSnapshot()));
    status.textContent = 'saved locally'; status.classList.remove('save-error'); status.title = '';
  } catch {
    status.textContent = 'not saved · export workflow'; status.classList.add('save-error');
    status.title = 'Browser storage is full or unavailable. Export the workflow to keep the embedded CSV and your edits.';
  }
}
function restore() {
  try {
    const raw = localStorage.getItem('laya-workflow-v1'); if (!raw) return false;
    const saved = JSON.parse(raw); if (!saved?.workflow?.nodes) return false;
    restoredInputText = typeof saved.inputText === 'string' ? saved.inputText : null;
    workflow = saved.workflow; runInput = saved.runInput ?? {}; stack = [{ workflow, label: workflow.name || 'Workflow' }]; return true;
  } catch { return false; }
}

function portsFor(node) {
  const input = node.type === 'input' ? [] : [{ id: 'in', group: 'in' }];
  let outs = [];
  if (node.type === 'input' || node.type === 'csv' || node.type === 'set') outs = ['next'];
  if (node.type === 'decision') outs = node.config.decisionType === 'noul' ? ['true', 'false'] : (node.config.options || []).map(o => o.key).filter(Boolean);
  if (node.type === 'condition') outs = ['true', 'false'];
  if (node.type === 'switch') outs = [...new Set((Array.isArray(node.config.cases) ? node.config.cases : []).map(c => String(c?.key ?? '').trim()).filter(k => k && k !== 'default')), 'default'];
  if (['foreach', 'map', 'filter', 'groupby', 'subflow'].includes(node.type)) outs = ['done'];
  return [...input, ...outs.map(id => ({ id: `out:${id}`, group: 'out' }))];
}
function nodeMeta(node) {
  if (node.type === 'decision') return node.config.decisionType === 'noul' ? 'yes / no' : `${node.config.options?.length || 0} options`;
  if (node.type === 'switch') return `${node.config.cases?.length || 0} cases + default`;
  if (node.type === 'condition') return `${node.config.conditions?.length || 0} condition(s)`;
  if (node.type === 'foreach') return `for each ${node.config.itemVar || 'item'}`;
  if (node.type === 'map') return node.config.mode === 'workflow' ? 'map · nested body' : 'map · value template';
  if (node.type === 'filter') return node.config.mode === 'workflow' ? 'filter · nested predicate' : `${node.config.conditions?.length || 0} filter rule(s)`;
  if (node.type === 'groupby') return node.config.outputFormat === 'keyed' ? 'groups by name' : 'group list by key';
  if (node.type === 'subflow') return node.config.libraryRef ? `linked · v${node.config.libraryRef.version}` : 'nested workflow';
  if (node.type === 'set') return `${node.config.assignments?.length || 0} assignment(s)`;
  if (node.type === 'output') return 'terminal';
  if (node.type === 'csv-output') return 'download CSV';
  if (node.type === 'csv') return node.config.filename || 'load CSV rows';
  return 'workflow input';
}

Graph.registerNode('wf-node', {
  inherit: 'rect', width: 244, height: 130,
  markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'icon' }, { tagName: 'text', selector: 'title' }, { tagName: 'text', selector: 'meta' }],
  attrs: {
    // Rect's inherited text style centers all text elements; our layout uses offsets from the top left.
    text: { refX: 0, refY: 0, textAnchor: 'start' },
    body: { rx: 12, ry: 12, strokeWidth: 1.5, fill: '#101217', stroke: '#343a46' },
    icon: { x: 15, y: 25, fontSize: 12, fontWeight: 700, fill: '#e9edf5' },
    title: { x: 42, y: 25, fontSize: 13, fontWeight: 700, fill: '#f4f6fa', textAnchor: 'start' },
    meta: { x: 15, y: 45, fontSize: 10, fill: '#8f98a8', textAnchor: 'start' },
  },
  ports: { groups: {
    in: { position: 'left', attrs: { circle: { r: 5, magnet: true, stroke: '#727b8b', strokeWidth: 1.5, fill: '#0c0e12' } } },
    out: { position: 'right', attrs: { circle: { r: 5, magnet: true, stroke: '#d7dde8', strokeWidth: 1.5, fill: '#0c0e12' } } },
  } },
}, true);

function graphNode(node, record) {
  return {
    id: record?.cellId || node.id, shape: 'wf-node', x: record?.x ?? node.position?.x ?? 100, y: record?.y ?? node.position?.y ?? 100,
    width: record?.width || 244, height: record?.height || 130, zIndex: record?.path.length * 3 + 2,
    ports: portsFor(node), data: { modelId: node.id, type: node.type, path: record?.path || currentPath(), preview: !!record?.preview, expanded: !!record?.expanded },
    attrs: {
      body: { stroke: COLORS[node.type] || '#657086', fill: record?.expanded ? '#101923' : '#101217' },
      icon: { text: ICONS[node.type] || '?' }, title: { text: node.label || node.type }, meta: { text: nodeMeta(node) },
    },
  };
}
function graphEdge(edge, record) {
  return {
    id: record?.cellId || edge.id, source: { cell: record?.from || edge.from, port: `out:${edge.fromPort || 'next'}` }, target: { cell: record?.to || edge.to, port: 'in' },
    zIndex: record?.path.length * 3 + 1, data: { preview: !!record?.preview },
    router: { name: record?.preview ? 'orth' : 'manhattan', args: { padding: 16, excludeTerminals: ['source', 'target'], excludeNodes: canvasRecords.nodes.filter(r => r.preview).map(r => r.cellId) } }, connector: { name: 'rounded', args: { radius: 8 } },
    attrs: { line: { stroke: '#596273', strokeWidth: 1.5, targetMarker: { name: 'classic', size: 7 } } },
    labels: edge.fromPort && !['next', 'done'].includes(edge.fromPort) ? [{ attrs: { label: { text: edge.fromPort, fill: '#9aa3b2', fontSize: 10 }, body: { fill: '#0d0f13', stroke: '#343a46', rx: 5, ry: 5 } } }] : [],
  };
}

function renderGraph(fit = false) {
  const wf = currentWorkflow();
  canvasRecords = canvasLayout(wf, currentPath(), expansion);
  if (previewSelection) previewSelection = canvasRecords.nodes.find(r => r.key === previewSelection.key) || null;
  renderingGraph = true;
  try {
    const cells = canvasRecords.nodes.map(r => graph.createNode(graphNode(r.node, r)));
    for (const record of canvasRecords.edges) {
      try { cells.push(graph.createEdge(graphEdge(record.edge, record))); } catch (e) { console.warn('Skipping invalid edge', record.edge, e); }
    }
    graph.resetCells(cells);
  } finally {
    renderingGraph = false;
  }
  renderBreadcrumbs(); renderInspector();
  if (fit && wf.nodes.length) graph.zoomToFit({ padding: 28, maxScale: 1 });
  $('#canvasNotice').textContent = canvasRecords.omitted ? 'Large nested view shortened. Open a body to view its canvas.' : '';
  traceUI?.canvasChanged();
}

function syncNodeCell(node) {
  const cell = graph.getCellById(node.id); if (!cell) return;
  cell.attr({ body: { stroke: COLORS[node.type] }, icon: { text: ICONS[node.type] }, title: { text: node.label || node.type }, meta: { text: nodeMeta(node) } });

  const desiredPorts = portsFor(node);
  const desiredIds = new Set(desiredPorts.map(port => port.id));
  const existingPorts = typeof cell.getPorts === 'function' ? cell.getPorts() : [];
  const existingIds = new Set(existingPorts.map(port => port.id));

  const stalePortIds = existingPorts
    .map(port => port.id)
    .filter(id => id && !desiredIds.has(id));
  if (stalePortIds.length) cell.removePorts(stalePortIds);

  const missingPorts = desiredPorts.filter(port => !existingIds.has(port.id));
  if (missingPorts.length) cell.addPorts(missingPorts);

  const wf = currentWorkflow();
  for (const edge of [...wf.edges]) {
    if (edge.from === node.id && !desiredIds.has(`out:${edge.fromPort}`)) removeEdge(edge.id, false, false);
  }
}

function initGraph() {
  graph = new Graph({
    // Full nested-canvas replacements and immediate trace highlights need their
    // views mounted before the next UI action.
    async: false,
    container: $('#workflowCanvas'), grid: { visible: true, size: 16, type: 'mesh', args: { color: '#20242c', thickness: 1 } },
    background: { color: '#0a0c10' }, panning: { enabled: true },
    interacting: view => isReadOnly() || view?.cell?.getData()?.preview ? { nodeMovable: false, magnetConnectable: false, edgeMovable: false, edgeLabelMovable: false, arrowheadMovable: false, vertexMovable: false, vertexAddable: false, vertexDeletable: false } : view?.cell?.getData()?.expanded ? { nodeMovable: false } : true,
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.35, maxScale: 2 },
    connecting: {
      snap: { radius: 20 }, allowBlank: false, allowLoop: false, allowNode: false,
      validateConnection({ sourcePort, targetPort, sourceCell, targetCell }) { return !isReadOnly() && !sourceCell?.getData()?.preview && !targetCell?.getData()?.preview && !!sourcePort?.startsWith('out:') && targetPort === 'in'; },
      createEdge() { return graph.createEdge(graphEdge({ id: uid('edge'), from: '', fromPort: 'next', to: '' })); },
    },
    highlighting: { magnetAvailable: { name: 'stroke', args: { padding: 4, attrs: { stroke: '#e9c46a' } } } },
  });
  graph.on('node:click', ({ node }) => { const record = canvasRecords.nodes.find(r => r.cellId === node.id); previewSelection = record?.preview ? record : null; selectedNodeId = record?.preview ? null : node.id; selectedEdgeId = null; renderInspector(); });
  graph.on('edge:click', ({ edge }) => { if (edge.getData()?.preview) return; previewSelection = null; selectedEdgeId = edge.id; selectedNodeId = null; renderInspector(); });
  graph.on('blank:click', () => { previewSelection = null; selectedNodeId = selectedEdgeId = null; renderInspector(); });
  graph.on('scale', () => traceUI?.transformLayer());
  graph.on('translate', () => traceUI?.transformLayer());
  graph.on('node:change:position', ({ node }) => { if (!renderingGraph) traceUI?.moveSurface(node); });
  graph.on('node:moved', ({ node }) => {
    if (renderingGraph || node.getData()?.preview) return;
    const model = currentWorkflow().nodes.find(n => n.id === node.id); if (!model) return;
    const record = canvasRecords.nodes.find(r => r.cellId === node.id);
    const p = node.position(); model.position = { x: Math.round((model.position?.x || 0) + p.x - (record?.x || 0)), y: Math.round((model.position?.y || 0) + p.y - (record?.y || 0)) }; markDirty(`move:${node.id}`); renderGraph();
  });
  graph.on('edge:connected', ({ edge }) => {
    if (renderingGraph || edge.getData()?.preview) return;
    const src = edge.getSource(); const tgt = edge.getTarget();
    if (!src?.cell || !tgt?.cell || !src.port?.startsWith('out:')) { edge.remove(); return; }
    const id = edge.id || uid('edge');
    if (currentWorkflow().edges.some(e => e.id === id)) return;
    currentWorkflow().edges.push({ id, from: src.cell, fromPort: src.port.slice(4), to: tgt.cell });
    edge.setLabels(!['next', 'done'].includes(src.port.slice(4)) ? [src.port.slice(4)] : []);
    markDirty();
    renderGraph();
  });
  let lastCanvasWidth = 0;
  new ResizeObserver(() => { const rect = $('#workflowCanvas').getBoundingClientRect(); graph.resize(rect.width, rect.height); if (Math.abs(rect.width - lastCanvasWidth) > 5 && graph.getNodes().length) graph.zoomToFit({ padding: 28, maxScale: 1 }); lastCanvasWidth = rect.width; traceUI?.transformLayer(); }).observe($('#workflowCanvas'));
  graph.on('edge:removed', ({ edge, options }) => {
    if (renderingGraph || options?.ui === false) return;
    const i = currentWorkflow().edges.findIndex(e => e.id === edge.id);
    if (i >= 0) { currentWorkflow().edges.splice(i, 1); markDirty(); }
  });
}

function addNode(type, x, y) {
  if (isReadOnly()) return;
  const rect = $('#workflowCanvas').getBoundingClientRect();
  let pos = { x: rect.width / 2 - 98, y: rect.height / 2 - 37 };
  try { pos = graph.clientToLocal(x ?? rect.left + rect.width / 2, y ?? rect.top + rect.height / 2); } catch {}
  const node = makeNode(type, Math.round(pos.x), Math.round(pos.y));
  currentWorkflow().nodes.push(node); selectedNodeId = node.id; selectedEdgeId = null; previewSelection = null; markDirty(); renderGraph(true);
}

function removeEdge(id, refreshInspector = true, record = true) {
  if (isReadOnly()) return;
  const wf = currentWorkflow();
  const i = wf.edges.findIndex(e => e.id === id);
  if (i >= 0) wf.edges.splice(i, 1);
  graph.getCellById(id)?.remove({ ui: false });
  if (selectedEdgeId === id) selectedEdgeId = null;
  if (record) markDirty();
  if (refreshInspector) renderGraph();
}

function removeNode(id) {
  if (isReadOnly()) return;
  const wf = currentWorkflow(); wf.nodes = wf.nodes.filter(n => n.id !== id); wf.edges = wf.edges.filter(e => e.from !== id && e.to !== id);
  selectedNodeId = null; markDirty(); renderGraph();
}

function field(label, html, help = '') { return `<label class="wf-field"><span>${label}</span>${html}${help ? `<small>${help}</small>` : ''}</label>`; }
function disclosure(title, content) { return `<details class="wf-disclosure"><summary>${title}</summary><div>${content}</div></details>`; }
function referenceHelp(node) {
  const name = String(node.type === 'foreach' ? node.config.collectAs || 'results' : node.config.resultAs || ({csv:'rows',map:'mapped',filter:'filtered',groupby:'groups',subflow:'subflowResult'}[node.type]));
  const ref = `{{${name}}}`;
  if (node.type === 'groupby' && node.config.outputFormat === 'keyed') return `<b>Use a group</b><code>${esc(`{{${name}.other}}`)}</code><small>Rows in “other” · ${esc(`{{${name}.other.length}}`)} for the count.</small>`;
  if (node.type === 'groupby') return `<b>Use the groups</b><code>${esc(ref)}</code><small>In For Each: {{item.key}}, {{item.items}}, {{item.count}}.</small>`;
  return `<b>Use ${node.type === 'subflow' ? 'the result' : 'this list'} in the next step</b><code>${esc(ref)}</code>${node.type === 'csv' ? `<small>Original columns: ${esc(`{{${name}Csv.columns}}`)}</small>` : ''}`;
}
function refreshReferenceHelp(node) { const el = $('#nodeReferenceHelp'); if (el) el.innerHTML = referenceHelp(node); }
const itemReferenceGuide = () => disclosure('Item references', '<p class="hint"><code>{{item}}</code> is the current item; <code>{{index}}</code> starts at 0. <code>{{input}}</code> also refers to the item. Use <code>{{parentInput}}</code> for the caller’s input.</p>');
function textInput(name, value, placeholder = '') { return `<input data-field="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}">`; }
function textarea(name, value, rows = 4, placeholder = '') { return `<textarea data-field="${name}" rows="${rows}" spellcheck="false" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`; }
function checkbox(name, checked, label, help = '') { return `<label class="wf-checkbox"><input type="checkbox" data-field="${name}" ${checked ? 'checked' : ''}><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`; }
function csvDelimiter(value, auto = false) {
  return `<select data-field="delimiter">${[...(auto ? [['auto', 'Detect automatically']] : []), [',', 'Comma (,)'], [';', 'Semicolon (;)'], ['\t', 'Tab'], ['|', 'Pipe (|)']].map(([key, label]) => `<option value="${esc(key)}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
}
function refreshCSVPreview(node) {
  const slot = $('#csvPreview'); if (!slot) return;
  if (node.config.mode === 'template') { slot.innerHTML = '<p class="hint">CSV text is resolved when the flow runs.</p>'; return; }
  if (!node.config.content) { slot.innerHTML = '<p class="hint">Load a UTF-8 file or paste CSV below. The first row contains column names.</p>'; return; }
  try {
    const { rows, columns } = parseCSV(node.config.content, { delimiter: node.config.delimiter ?? 'auto' });
    const visibleColumns = columns.slice(0, 12);
    slot.innerHTML = `<p class="csv-summary">${rows.length} rows · ${columns.length} columns${node.config.filename ? ` · ${esc(node.config.filename)}` : ''}</p><div class="csv-table-wrap"><table><thead><tr>${visibleColumns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 5).map(row => `<tr>${visibleColumns.map(c => `<td>${esc(row[c].length > 100 ? row[c].slice(0, 100) + '…' : row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="hint">Preview: up to 5 rows${columns.length > 12 ? ' and 12 columns' : ''}. Cell values stay text.</p>`;
  } catch (error) { slot.innerHTML = `<p class="csv-error" role="status">${esc(error.message)}</p>`; }
}

const OPS = [
  ['eq', 'equals'], ['neq', 'does not equal'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['contains', 'contains'], ['not_contains', 'does not contain'],
  ['exists', 'exists'], ['not_exists', 'does not exist'], ['empty', 'is empty'], ['not_empty', 'is not empty'], ['starts_with', 'starts with'], ['ends_with', 'ends with'],
];
function conditionRows(node) {
  return (node.config.conditions || []).map((c, i) => `<div class="wf-repeater condition-row" data-index="${i}">
    <input data-cond="left" value="${esc(c.left)}" placeholder="input.status" aria-label="Condition ${i + 1} field">
    <select data-cond="op" aria-label="Condition ${i + 1} operator">${OPS.map(([v,l]) => `<option value="${v}" ${c.op === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-cond="right" value="${esc(c.right ?? '')}" placeholder="value" aria-label="Condition ${i + 1} comparison value" ${['exists','not_exists','empty','not_empty'].includes(c.op) ? 'disabled' : ''}>
    <button type="button" class="icon-btn danger" data-remove-cond="${i}" aria-label="Remove condition">×</button>
  </div>`).join('');
}
function assignmentRows(node) {
  return (node.config.assignments || []).map((a, i) => `<div class="wf-repeater assignment-row" data-index="${i}">
    <input data-assign="path" value="${esc(a.path)}" placeholder="status">
    <input data-assign="value" value="${esc(a.value)}" placeholder="{{input.value}}">
    <button type="button" class="icon-btn danger" data-remove-assign="${i}" aria-label="Remove assignment">×</button>
  </div>`).join('');
}
function optionRows(node) {
  return (node.config.options || []).map((o, i) => `<div class="wf-option" data-index="${i}">
    <div class="wf-option-head"><input data-option="key" value="${esc(o.key)}" placeholder="option_key"><button type="button" class="icon-btn danger" data-remove-option="${i}" aria-label="Remove option">×</button></div>
    <input data-option="label" value="${esc(o.label || '')}" placeholder="Display label">
    <textarea data-option="description" rows="2" placeholder="What this option means to Laya">${esc(o.description || '')}</textarea>
  </div>`).join('');
}

function switchRows(node) {
  return (Array.isArray(node.config.cases) ? node.config.cases : []).map((c, i) => `<div class="wf-option" data-index="${i}">
    <div class="wf-option-head"><span class="case-number">${i + 1}</span><button type="button" class="icon-btn danger" data-remove-case="${i}" aria-label="Remove case ${i + 1}">×</button></div>
    <label class="case-field">Branch name<input data-case="key" value="${esc(c.key)}" placeholder="branch_name" aria-label="Case ${i + 1} port"></label>
    <label class="case-field">Matches<input data-case="value" value="${esc(typeof c.value === 'string' ? c.value : JSON.stringify(c.value))}" placeholder="billing" aria-label="Case ${i + 1} matching value"></label>
    <select data-case="format" aria-label="Case ${i + 1} value format"><option value="text" ${c.format !== 'json' ? 'selected' : ''}>Text or reference</option><option value="json" ${c.format === 'json' ? 'selected' : ''}>JSON or reference</option></select>
  </div>`).join('');
}

function renderInspector() {
  updateEditingTools();
  const box = $('#inspector');
  $('.workflow-main').classList.toggle('has-selection', !!(selectedNodeId || selectedEdgeId || previewSelection));
  if (previewSelection) {
    const record = previewSelection;
    box.innerHTML = `<div class="inspector-head"><div><b>${esc(record.node.label)}</b><small>${esc(record.node.type)} · nested view</small></div><button type="button" class="icon-btn close-inspector" aria-label="Close inspector">×</button></div><div id="nodeRunDetails"></div><button type="button" class="soft wide" id="editPreviewNode">Edit node ↗</button><p class="hint">${esc(record.path.join(' → '))}</p>`;
    on($('#editPreviewNode'), 'click', () => editRecord(record));
    on($('.close-inspector'), 'click', closeInspector);
    traceUI?.refreshInspector(); return;
  }
  if (selectedEdgeId) {
    const edge = currentWorkflow().edges.find(e => e.id === selectedEdgeId);
    const labelFor = id => currentWorkflow().nodes.find(n => n.id === id)?.label || id;
    box.innerHTML = edge ? `<div class="inspector-head"><div><b>Connection</b><small>${esc(edge.fromPort || 'next')}</small></div><button type="button" class="icon-btn close-inspector" aria-label="Close inspector">×</button></div><p class="muted">${esc(labelFor(edge.from))} → ${esc(labelFor(edge.to))}</p><button class="danger wide" id="deleteEdge">Delete connection</button>` : '<p class="muted">Select a node to edit it.</p>';
    if ($('#deleteEdge')) $('#deleteEdge').disabled = isReadOnly();
    on($('.close-inspector'), 'click', closeInspector);
    on($('#deleteEdge'), 'click', () => removeEdge(selectedEdgeId)); return;
  }
  const node = currentNode();
  if (!node) { box.innerHTML = '<div class="inspector-empty"><b>Inspector</b><p>Select a node to edit its behavior. Show body previews on the canvas, or use Edit body to open their editor.</p></div>'; return; }
  const key = nodeKey(currentPath(), node.id);
  const disclosureStates = box.dataset.nodeKey === key ? new Map([...box.querySelectorAll('.node-settings, .wf-disclosure')].map(d => [d.querySelector('summary').textContent, d.open])) : new Map();
  let body = field('Label', textInput('label', node.label));
  if (node.type === 'csv') {
    body += field('Read from', `<select data-field="mode"><option value="file" ${node.config.mode !== 'template' ? 'selected' : ''}>File or pasted CSV</option><option value="template" ${node.config.mode === 'template' ? 'selected' : ''}>Workflow text</option></select>`);
    if (node.config.mode === 'template') body += field('CSV text', textarea('source', node.config.source ?? '{{input}}', 3), 'Text or a reference, e.g. {{input.csv}}.');
    else body += '<button type="button" class="soft wide" id="loadCSVBtn">Choose CSV file…</button><input type="file" id="csvFile" accept=".csv,.tsv,text/csv,text/tab-separated-values" hidden><div id="csvPreview"></div>' + disclosure('Paste or edit CSV', textarea('content', node.config.content ?? '', 7, 'id,text\n001,Hello'));
    body += field('Store rows as', textInput('resultAs', node.config.resultAs ?? 'rows'));
    body += disclosure('CSV options', field('Delimiter', csvDelimiter(node.config.delimiter ?? 'auto', true)) + '<p class="hint">The first row supplies column names. Cell values stay text. File contents are included in saved workflows.</p>');
  }
  if (node.type === 'csv-output') {
    body += field('Rows to export', textarea('source', node.config.source ?? '{{rows}}', 2), 'A row list, e.g. {{tagged}} or {{groups.other}}.');
    body += field('Filename', textInput('filename', node.config.filename ?? 'tagged.csv'));
    body += field('Sort by', textInput('sortBy', node.config.sortBy ?? '', 'Optional column, e.g. email_type'), 'Blank keeps the current row order.');
    body += disclosure('Columns and file options',
      field('Original columns', textInput('columns', node.config.columns ?? '{{rowsCsv.columns}}'), 'Reference or JSON list. Blank infers columns; new fields are appended.') +
      field('Sort direction', `<select data-field="sortDirection"><option value="asc" ${node.config.sortDirection !== 'desc' ? 'selected' : ''}>Ascending (A → Z)</option><option value="desc" ${node.config.sortDirection === 'desc' ? 'selected' : ''}>Descending (Z → A)</option></select>`) +
      field('Delimiter', csvDelimiter(node.config.delimiter ?? ',')) +
      checkbox('bom', node.config.bom !== false, 'Spreadsheet compatibility', 'Include a UTF-8 marker for accented and non-Latin text.'));
    body += '<p class="hint">Run, then <b>Download CSV</b> from this node. The file contains every row.</p>';
  }
  if (node.type === 'decision') {
    body += field('Question type', `<select data-field="decisionType"><option value="choice" ${node.config.decisionType !== 'noul' ? 'selected' : ''}>choice</option><option value="noul" ${node.config.decisionType === 'noul' ? 'selected' : ''}>noul</option></select>`);
    body += field('Result key', textInput('key', node.config.key, 'classification'), 'Available later as decisions.KEY.');
    body += field('State', textarea('state', node.config.state, 4, '{{input}}'), 'Templates can reference input, variables, loop items, and earlier decisions.');
    body += field('Question', textarea('question', node.config.question, 3));
    if (node.config.decisionType === 'noul') {
      body += field('True criterion', textarea('trueCriterion', node.config.trueCriterion, 2, 'What true means'));
      body += field('False criterion', textarea('falseCriterion', node.config.falseCriterion, 2, 'What false means'));
      body += field('True threshold', `<input data-field="threshold" type="number" min="0" max="1" step="0.01" value="${esc(node.config.threshold ?? 0.5)}">`);
    } else {
      body += `<div class="section-label">Options / criteria</div><div id="optionList">${optionRows(node)}</div><button type="button" class="soft wide" id="addOption">+ Add option</button>`;
    }
    body += field('Also store choice as', textInput('resultAs', node.config.resultAs || '', 'optional variable'));
  }
  if (node.type === 'switch') {
    body += field('Value to match', textarea('value', node.config.value ?? '{{input.value}}', 2), 'An existing value, e.g. {{item.email_type}}.');
    body += `<div class="section-label">Cases · first match wins</div><div id="switchCaseList">${switchRows(node)}</div><button type="button" class="soft wide" id="addSwitchCase">+ Add case</button>`;
    body += '<p class="switch-default"><b>default</b> → no case matches</p>';
    body += disclosure('Matching and connections', '<p class="hint">Exact, case-sensitive matching. Text keeps CSV values as strings; JSON supports numbers, booleans and null. References retain their type. Missing values fail.</p><p class="hint">Connect each case and <b>default</b> to a next step. Renaming or removing a branch removes its connections; Undo restores them.</p>');
  }
  if (node.type === 'condition') {
    body += field('Match', `<select data-field="mode"><option value="all" ${node.config.mode !== 'any' ? 'selected' : ''}>All conditions</option><option value="any" ${node.config.mode === 'any' ? 'selected' : ''}>Any condition</option></select>`);
    body += `<div class="section-label">Conditions</div><div id="conditionList">${conditionRows(node)}</div><button type="button" class="soft wide" id="addCondition">+ Add condition</button>`;
  }
  if (node.type === 'groupby') {
    body += field('Items to group', textarea('source', node.config.source ?? '{{input.items}}', 2));
    body += field('Group by', textarea('key', node.config.key ?? '{{item.category}}', 2), 'A field from each item, e.g. {{item.email_type}}.');
    body += field('Store groups as', textInput('resultAs', node.config.resultAs ?? 'groups'));
    const keyed = node.config.outputFormat === 'keyed';
    body += field('Output format', `<select data-field="outputFormat"><option value="keyed" ${keyed ? 'selected' : ''}>Keyed object · access by name</option><option value="list" ${!keyed ? 'selected' : ''}>Group list · iterate groups</option></select>`);
    body += disclosure('Grouping and references', '<p class="hint">Keeps original rows and their order within each group. Keys are case-sensitive; missing keys fail at the relevant item.</p>' + (keyed ? '<p class="hint">Only encountered groups exist. Names with dots use brackets, e.g. <code>["feature.request"]</code>. Keys become text; conflicting typed keys fail. Use Group list to keep their types distinct.</p>' : '<p class="hint">Groups are ordered by first appearance, each with <code>key</code>, <code>items</code> and <code>count</code>. Use For Each to process each group.</p>'));
  }
  if (node.type === 'set') {
    body += `<div class="section-label">Assignments</div><div id="assignmentList">${assignmentRows(node)}</div><button type="button" class="soft wide" id="addAssignment">+ Add assignment</button>`;
    body += `<p class="hint">Assignments write into workflow variables. Use <code>{{variable}}</code> in later nodes.</p>`;
  }
  if (node.type === 'foreach') {
    body += field('Items', textarea('source', node.config.source, 2, '{{input.items}}'), 'A list to process, one item at a time.');
    body += `<button type="button" class="soft wide open-nested" data-nested="workflow">Edit body ↗</button>`;
    body += field('Store results as', textInput('collectAs', node.config.collectAs || 'results'));
    body += disclosure('Item variable names', field('Item', textInput('itemVar', node.config.itemVar || 'item')) + field('Index', textInput('indexVar', node.config.indexVar || 'index'), 'Starts at 0.'));
  }
  if (node.type === 'map' || node.type === 'filter') {
    const map = node.type === 'map';
    body += field('Items', textarea('source', node.config.source ?? '{{input.items}}', 2), 'A list, e.g. {{rows}} or {{filtered}}.');
    body += field(map ? 'Transform using' : 'Keep items using', `<select data-field="mode"><option value="${map ? 'value' : 'conditions'}" ${node.config.mode !== 'workflow' ? 'selected' : ''}>${map ? 'Inline value' : 'Inline rules'}</option><option value="workflow" ${node.config.mode === 'workflow' ? 'selected' : ''}>Nested workflow</option></select>`);
    if (node.config.mode === 'workflow') {
      body += `<button type="button" class="soft wide open-nested">Edit ${map ? 'body' : 'predicate'} ↗</button><p class="hint">${map ? 'Return one value per item.' : 'Return a boolean: true keeps the original item; false removes it.'}</p>`;
    } else if (map) {
      body += field('Value format', `<select data-field="format"><option value="value" ${node.config.format !== 'json' ? 'selected' : ''}>Value or text</option><option value="json" ${node.config.format === 'json' ? 'selected' : ''}>JSON template</option></select>`);
      body += field('New value', textarea('value', node.config.value ?? '{{item}}', 5), node.config.format === 'json' ? 'Example: {"name": {{item.name}}, "position": {{index}}}' : 'Example: {{item.name}}. Exact references keep their type.');
    } else {
      body += field('Match', `<select data-field="match"><option value="all" ${node.config.match !== 'any' ? 'selected' : ''}>All rules</option><option value="any" ${node.config.match === 'any' ? 'selected' : ''}>Any rule</option></select>`);
      body += `<div class="section-label">Keep when</div><div id="conditionList">${conditionRows(node)}</div><button type="button" class="soft wide" id="addCondition">+ Add rule</button>`;
    }
    if (map) body += checkbox('keepOriginal', !!node.config.keepOriginal, 'Keep original fields', 'Add returned fields to each row; matching names replace existing values.');
    body += field('Store list as', textInput('resultAs', node.config.resultAs ?? (map ? 'mapped' : 'filtered')));
    body += itemReferenceGuide();
    if (!map) body += disclosure('Filter behavior', '<p class="hint">Matching items pass through unchanged and in order. With no rules, “All” keeps everything and “Any” keeps nothing. Nested predicates must return true or false using Output → JSON template.</p>');
  }
  if (node.type === 'subflow') {
    const ref = node.config.libraryRef;
    if (ref) {
      const entry = libraryUI?.find(ref.id);
      const latest = entry?.versions.at(-1);
      const newer = latest && latest.number > ref.version;
      body += `<div class="library-link"><b>${esc(ref.name)} · v${esc(ref.version)}</b><p>${newer ? `v${latest.number} is available. Updating replaces the pinned body and can be undone.` : entry ? 'Pinned to this published version.' : 'Library item unavailable here. The embedded version still runs.'}</p>${newer ? '<button type="button" class="soft wide" id="updateLinkedBtn">Update to v' + latest.number + '</button>' : ''}${entry ? '<button type="button" class="soft wide" id="editLinkedBtn">Edit latest draft</button>' : ''}</div>`;
    }
    body += field('Input', textarea('input', node.config.input ?? '{{input}}', 2, '{{input}}'), 'Value passed to the subflow.');
    body += field('Store output as', textInput('resultAs', node.config.resultAs || 'subflowResult'));
    body += `<button type="button" class="soft wide open-nested" data-nested="workflow">View body ↗</button>`;
  }
  if (node.type === 'output') {
    body += field('Output format', `<select data-field="format"><option value="value" ${node.config.format !== 'json' ? 'selected' : ''}>value / template</option><option value="json" ${node.config.format === 'json' ? 'selected' : ''}>JSON template</option></select>`);
    body += field('Value', textarea('value', node.config.value, 7, '{{input}}'), node.config.format === 'json' ? 'JSON placeholders are inserted as real JSON values. Example: {"item": {{item}}}' : 'An exact {{path}} returns the raw value; mixed text interpolates it.');
  }
  if (node.type === 'input') body += stack.length === 1
    ? '<p class="hint">This is where your workflow starts. Its data comes from the Workflow input panel on the left.</p><button type="button" class="soft wide" id="editRunInputBtn">Edit workflow input →</button>'
    : '<p class="hint">This nested flow receives its input and variables from the caller. The Workflow input panel edits the root run data.</p>';
  if (['csv','groupby','foreach','map','filter','subflow'].includes(node.type)) body += `<div id="nodeReferenceHelp" class="reference-help">${referenceHelp(node)}</div>`;
  body += node.type !== 'input' || currentWorkflow().nodes.filter(n => n.type === 'input').length > 1 ? '<button type="button" class="danger wide" id="deleteNode">Delete node</button>' : '';
  box.innerHTML = `<div class="inspector-head"><div><b>${esc(ICONS[node.type])} ${esc(node.label)}</b><small>${esc(TYPES.find(t => t[0] === node.type)?.[1] || node.type)}</small></div><button type="button" class="icon-btn close-inspector" aria-label="Close inspector">×</button></div><div id="nodeRunDetails" hidden></div><details class="node-settings" open><summary>Settings</summary><div>${body}</div></details>`;
  box.dataset.nodeKey = key;
  box.querySelectorAll('.node-settings, .wf-disclosure').forEach(d => { const title = d.querySelector('summary').textContent; if (disclosureStates.has(title)) d.open = disclosureStates.get(title); });
  wireInspector(node);
  if (node.type === 'csv') refreshCSVPreview(node);
  on($('.close-inspector'), 'click', closeInspector);
  traceUI?.refreshInspector();
}

function closeInspector() { selectedNodeId = selectedEdgeId = null; previewSelection = null; renderInspector(); }
function editRecord(record) {
  const found = locateStep(workflow, { workflowPath: record.path, nodeId: record.node.id });
  if (!found) return;
  stack = found.frames; previewSelection = null; selectedNodeId = found.node.id; selectedEdgeId = null;
  renderGraph(true);
}
function editBody(record) { editRecord(record); openNested(currentNode()); }
function toggleBody(record) { expansion.set(record.key, !record.expanded); renderGraph(true); }

function wireInspector(node) {
  on($('#editRunInputBtn'), 'click', () => {
    $('#runInput').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#runInput').focus({ preventScroll: true });
  });
  if (isReadOnly()) {
    $('#inspector').querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = !el.closest('#nodeRunDetails') && !el.classList.contains('open-nested') && !el.classList.contains('close-inspector'); });
    $('#inspector').querySelectorAll('.open-nested').forEach(b => on(b, 'click', () => openNested(node)));
    return;
  }
  on($('#loadCSVBtn'), 'click', () => $('#csvFile').click());
  on($('#csvFile'), 'change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const path = currentPath();
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a CSV file up to 10 MiB.');
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('This file is not UTF-8 text. Save it as UTF-8 CSV and load it again.'); }
      if (locateStep(workflow, { workflowPath: path, nodeId: node.id })?.node !== node) return;
      Object.assign(node.config, { content, filename: file.name });
      markDirty(); renderGraph();
    } catch (error) {
      if (currentNode() === node && $('#csvPreview')) $('#csvPreview').innerHTML = `<p class="csv-error" role="status">${esc(error.message)}</p>`;
    } finally { e.target.value = ''; }
  });
  $('#inspector').querySelectorAll('[data-field]').forEach(el => on(el, eventFor(el), () => {
    const key = el.dataset.field;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (key === 'label') node.label = value; else node.config[key] = value;
    if (key === 'decisionType' && value === 'choice' && (!node.config.options || node.config.options.length < 2)) {
      node.config.options = [
        { key: 'option_a', label: 'Option A', description: 'First option.' },
        { key: 'option_b', label: 'Option B', description: 'Second option.' },
      ];
    }
    syncNodeCell(node);
    markDirty(el);
    if (['resultAs', 'collectAs'].includes(key)) refreshReferenceHelp(node);
    if (node.type === 'csv' && ['content', 'delimiter'].includes(key)) refreshCSVPreview(node);
    if (key === 'decisionType' || key === 'format' || key === 'outputFormat' || (key === 'mode' && ['map', 'filter', 'csv'].includes(node.type))) renderGraph();
  }));
  $('#inspector').querySelectorAll('[data-option]').forEach(el => on(el, eventFor(el), () => {
    const row = el.closest('[data-index]');
    const i = Number(row?.dataset.index);
    if (!Number.isInteger(i) || !node.config.options?.[i]) return;
    node.config.options[i][el.dataset.option] = el.value;
    syncNodeCell(node);
    markDirty(el);
  }));
  $('#inspector').querySelectorAll('[data-case]').forEach(el => on(el, eventFor(el), () => {
    const i = Number(el.closest('[data-index]')?.dataset.index);
    if (!Number.isInteger(i) || !node.config.cases?.[i]) return;
    node.config.cases[i][el.dataset.case] = el.value;
    syncNodeCell(node); markDirty(el);
  }));
  on($('#addSwitchCase'), 'click', () => {
    node.config.cases = Array.isArray(node.config.cases) ? node.config.cases : [];
    const keys = new Set(node.config.cases.map(c => String(c.key ?? '').trim()));
    let number = 1; while (keys.has(`case_${number}`)) number++;
    node.config.cases.push({ key: `case_${number}`, format: 'text', value: '' });
    syncNodeCell(node); markDirty(); renderGraph();
  });
  $('#inspector').querySelectorAll('[data-remove-case]').forEach(b => on(b, 'click', () => {
    node.config.cases.splice(Number(b.dataset.removeCase), 1);
    syncNodeCell(node); markDirty(); renderGraph();
  }));
  $('#inspector').querySelectorAll('[data-cond]').forEach(el => on(el, eventFor(el), () => {
    const i = Number(el.closest('[data-index]')?.dataset.index);
    if (!Number.isInteger(i) || !node.config.conditions?.[i]) return;
    node.config.conditions[i][el.dataset.cond] = el.value;
    if (el.dataset.cond === 'op') el.closest('[data-index]').querySelector('[data-cond="right"]').disabled = ['exists','not_exists','empty','not_empty'].includes(el.value);
    syncNodeCell(node);
    markDirty(el);
  }));
  $('#inspector').querySelectorAll('[data-assign]').forEach(el => on(el, eventFor(el), () => {
    const i = Number(el.closest('[data-index]')?.dataset.index);
    if (!Number.isInteger(i) || !node.config.assignments?.[i]) return;
    node.config.assignments[i][el.dataset.assign] = el.value;
    syncNodeCell(node);
    markDirty(el);
  }));
  on($('#addOption'), 'click', () => {
    node.config.options ||= [];
    const n = node.config.options.length + 1;
    node.config.options.push({ key: `option_${n}`, label: `Option ${n}`, description: `The ${n}th option.` });
    syncNodeCell(node); markDirty(); renderGraph();
  });
  $('#inspector').querySelectorAll('[data-remove-option]').forEach(b => on(b, 'click', () => {
    node.config.options ||= [];
    node.config.options.splice(Number(b.dataset.removeOption), 1);
    syncNodeCell(node); markDirty(); renderGraph();
  }));
  on($('#addCondition'), 'click', () => {
    node.config.conditions ||= [];
    node.config.conditions.push({ left: '', op: 'eq', right: '' });
    syncNodeCell(node); markDirty(); renderInspector();
  });
  $('#inspector').querySelectorAll('[data-remove-cond]').forEach(b => on(b, 'click', () => {
    node.config.conditions ||= [];
    node.config.conditions.splice(Number(b.dataset.removeCond), 1);
    syncNodeCell(node); markDirty(); renderInspector();
  }));
  on($('#addAssignment'), 'click', () => {
    node.config.assignments ||= [];
    node.config.assignments.push({ path: '', value: '' });
    syncNodeCell(node); markDirty(); renderInspector();
  });
  $('#inspector').querySelectorAll('[data-remove-assign]').forEach(b => on(b, 'click', () => {
    node.config.assignments ||= [];
    node.config.assignments.splice(Number(b.dataset.removeAssign), 1);
    syncNodeCell(node); markDirty(); renderInspector();
  }));
  on($('#deleteNode'), 'click', () => removeNode(node.id));
  on($('#updateLinkedBtn'), 'click', () => {
    const entry = libraryUI.find(node.config.libraryRef.id);
    if (!entry) throw new Error('This library item is unavailable.');
    Object.assign(node.config, libraryUI.pin(entry));
    syncNodeCell(node); markDirty(); renderGraph();
  });
  on($('#editLinkedBtn'), 'click', () => {
    const entry = libraryUI.find(node.config.libraryRef.id);
    if (entry) loadLibraryDraft(entry, clone(entry.versions.at(-1)));
  });
  $('#inspector').querySelectorAll('.open-nested').forEach(b => on(b, 'click', () => openNested(node)));
}

function openNested(node) {
  if (!node) return;
  if (!node.config.workflow) { node.config.workflow = makeNode(node.type).config.workflow || childWorkflow('Nested workflow'); markDirty(); }
  stack.push({ workflow: node.config.workflow, label: node.label, owner: node.id, linked: !!node.config.libraryRef }); previewSelection = null; selectedNodeId = selectedEdgeId = null; renderGraph(true);
}

function loadLibraryDraft(entry, version) {
  workflow = clone(version.workflow);
  workflow.librarySource = { id: entry.id, version: version.number, kind: entry.kind };
  runInput = clone(version.input ?? {});
  stack = [{ workflow, label: workflow.name }];
  selectedNodeId = selectedEdgeId = null;
  $('#workflowName').value = workflow.name;
  $('#runInput').value = typeof runInput === 'string' ? runInput : pretty(runInput);
  markDirty(); renderGraph(true);
}

function insertLibrarySubflow(entry, pinned) {
  if (isReadOnly()) throw new Error('Return to an editable canvas to insert a subflow.');
  const rect = $('#workflowCanvas').getBoundingClientRect();
  const pos = graph.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const node = makeNode('subflow', Math.round(pos.x), Math.round(pos.y));
  node.label = pinned.libraryRef.name;
  Object.assign(node.config, pinned, { input: '{{input}}', resultAs: `result_${node.id.slice(8).replace(/-/g, '_')}` });
  currentWorkflow().nodes.push(node);
  selectedNodeId = node.id; selectedEdgeId = null;
  previewSelection = null; markDirty(); renderGraph(true);
}
function renderBreadcrumbs() {
  $('#breadcrumbs').innerHTML = stack.map((s, i) => `<button type="button" data-crumb="${i}" ${i === stack.length - 1 ? 'aria-current="page"' : ''}>${esc(i === 0 ? workflow.name || 'Workflow' : s.label)}</button>${i < stack.length - 1 ? '<span>›</span>' : ''}`).join('');
  $('#breadcrumbs').querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => { const i = Number(b.dataset.crumb); stack = stack.slice(0, i + 1); selectedNodeId = selectedEdgeId = null; renderGraph(true); }));
}

function renderPalette() {
  const palette = $('#palette');
  const groups = [['Data', ['input','csv','output','csv-output']], ['Logic', ['decision','condition','switch','set']], ['Lists', ['foreach','map','filter','groupby']], ['Reuse', ['subflow']]];
  palette.innerHTML = groups.map(([label, types]) => `<div class="palette-group-title">${label}</div>${types.map(type => {
    const [, name, desc] = TYPES.find(t => t[0] === type);
    return `<button type="button" class="palette-node" draggable="true" data-node-type="${type}" aria-label="Add ${esc(name)} node" title="${esc(desc)}"><span class="palette-icon" style="--node-color:${COLORS[type]}">${esc(ICONS[type])}</span><span><b>${name}</b></span></button>`;
  }).join('')}`).join('');
  palette.querySelectorAll('[data-node-type]').forEach(btn => {
    on(btn, 'click', e => { e.preventDefault(); addNode(btn.dataset.nodeType); });
    on(btn, 'dragstart', e => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/x-workflow-node', btn.dataset.nodeType);
      e.dataTransfer.setData('text/plain', btn.dataset.nodeType);
    });
  });
  const canvas = $('#workflowCanvas');
  const hasWorkflowDrag = e => Array.from(e.dataTransfer?.types || []).includes('text/x-workflow-node');
  on(canvas, 'dragover', e => {
    if (!hasWorkflowDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  on(canvas, 'drop', e => {
    const type = e.dataTransfer?.getData('text/x-workflow-node') || '';
    if (!type) return;
    e.preventDefault();
    addNode(type, e.clientX, e.clientY);
  });
}

function parseInput() {
  const raw = $('#runInput').value.trim();
  if (!raw) return '';
  try { return JSON.parse(raw); } catch { return raw; }
}
function updateInputPanel() {
  const raw = $('#runInput').value;
  if (raw === lastInputText) return;
  lastInputText = raw;
  const text = raw.trim();
  let value;
  let json = false;
  try { if (text) { value = JSON.parse(text); json = true; } } catch {}
  const unfinished = !json && /^[\[{]/.test(text);
  $('#inputType').textContent = !text ? 'Empty' : json ? 'JSON' : 'Text';
  $('#inputSummary').textContent = !text ? 'Ready for your data' : json
    ? Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}`
      : value !== null && typeof value === 'object' ? `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
      : value === null ? 'null' : typeof value
    : `${raw.length.toLocaleString()} character${raw.length === 1 ? '' : 's'}`;
  $('#formatInputBtn').disabled = !json;
  $('#inputHelp').innerHTML = unfinished
    ? 'JSON is incomplete or invalid. This will be sent as plain text.'
    : 'Use <code>{{input}}</code> in your nodes.';
}
function openInputEditor() {
  const dialog = $('#inputDialog');
  if (dialog.open) return;
  dialog.showModal();
  $('#expandedInputSlot').append(document.querySelector('.run-input-wrap'));
  $('#runInput').focus();
}
function formatRunInput() {
  const input = $('#runInput');
  try {
    input.value = pretty(JSON.parse(input.value));
    runInput = parseInput(); markDirty();
  } catch { updateInputPanel(); }
}
function pretty(value) { return JSON.stringify(value, null, 2); }
async function runWorkflow() {
  if (running) return; running = true; $('#runBtn').disabled = true; $('#runBtn').textContent = 'Running…';
  runInput = parseInput(); persist();
  const snapshot = { workflow: clone(workflow), input: clone(runInput), model: $('#model').value, lang: $('#lang').value.trim() };
  const trace = [];
  traceUI.start(snapshot);
  try {
    const result = await executeWorkflow(snapshot.workflow, snapshot.input, { model: snapshot.model, lang: snapshot.lang, trace, onTrace: traceUI.update });
    traceUI.finish(result);
  } catch (error) { traceUI.finish({ trace: error.trace || trace, traceOmitted: error.traceOmitted, error }); }
  finally { running = false; $('#runBtn').disabled = false; $('#runBtn').textContent = 'Run'; }
}
function jumpToStep(step) {
  const found = locateStep(workflow, step);
  if (!found) return false;
  traceUI?.reveal(step);
  const visible = canvasRecords.nodes.find(r => JSON.stringify(r.path) === JSON.stringify(step.workflowPath) && r.node.id === step.nodeId);
  if (visible) {
    previewSelection = visible.preview ? visible : null; selectedNodeId = visible.preview ? null : visible.node.id; selectedEdgeId = null;
    renderInspector(); traceUI?.highlight(); return true;
  }
  stack = found.frames; previewSelection = null; selectedNodeId = found.node.id; selectedEdgeId = null;
  renderGraph(true);
  $('.workflow-inspector').scrollTop = 0;
  return true;
}

function loadExample(name) {
  const example = EXAMPLES[name]?.(); if (!example) return;
  workflow = clone(example.workflow); runInput = clone(example.input); stack = [{ workflow, label: workflow.name }]; selectedNodeId = selectedEdgeId = null;
  $('#runInput').value = pretty(runInput); $('#workflowName').value = workflow.name; markDirty(); renderGraph(true);
}
function resetWorkflow() {
  workflow = emptyWorkflow(); workflow.name = 'Untitled workflow'; const input = makeNode('input', 80, 140); const out = makeNode('output', 420, 140); workflow.nodes = [input, out]; workflow.edges = [{ id: uid('edge'), from: input.id, fromPort: 'next', to: out.id }];
  runInput = {}; stack = [{ workflow, label: workflow.name }]; $('#runInput').value = '{}'; $('#workflowName').value = workflow.name; markDirty(); renderGraph(true);
}
function exportWorkflow() {
  const blob = new Blob([JSON.stringify({ workflow, input: parseInput() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(workflow.name || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Firefox can cancel a download when its blob URL is revoked in the same task.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function importWorkflow(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showUiError(reader.error || new Error('Could not read workflow file.'));
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.workflow?.nodes || !Array.isArray(data.workflow.nodes) || !Array.isArray(data.workflow.edges)) throw new Error('Missing or invalid workflow graph.');
      workflow = data.workflow;
      runInput = data.input ?? {};
      stack = [{ workflow, label: workflow.name || 'Workflow' }];
      selectedNodeId = selectedEdgeId = null;
      $('#runInput').value = typeof runInput === 'string' ? runInput : pretty(runInput);
      $('#workflowName').value = workflow.name || 'Workflow';
      markDirty();
      renderGraph(true);
    } catch (e) {
      showUiError(e);
    }
  };
  reader.readAsText(file);
}

function init() {
  restore();
  libraryUI = createLibraryUI({
    getWorkflow: currentWorkflow,
    getInput: parseInput,
    onInsert: insertLibrarySubflow,
    onLoad: loadLibraryDraft,
    onPublish: entry => {
      if (isReadOnly()) return;
      const current = currentWorkflow();
      const latest = entry.versions.at(-1);
      current.name = latest.name;
      current.librarySource = { id: entry.id, version: latest.number, kind: entry.kind };
      if (current === workflow) $('#workflowName').value = current.name;
      renderBreadcrumbs();
      markDirty();
    },
    onChange: renderInspector,
  });
  initGraph(); renderPalette();
  traceUI = createTraceUI({ nodeColors: COLORS, onJump: jumpToStep, onExpand: toggleBody, onEdit: editBody, getGraph: () => graph, getRecords: () => canvasRecords, getContext: contextRecords, getSelected: selectedRecord });
  $('#workflowName').value = workflow.name || 'Workflow'; $('#runInput').value = restoredInputText ?? (typeof runInput === 'string' ? runInput : pretty(runInput));
  history = new EditorHistory(editorSnapshot());
  on($('#workflowName'), 'input', e => { workflow.name = e.target.value; stack[0].label = workflow.name; renderBreadcrumbs(); markDirty(e.target); });
  on($('#runInput'), 'input', e => { runInput = parseInput(); markDirty(e.target); });
  on($('#expandInputBtn'), 'click', openInputEditor);
  on($('#closeInputBtn'), 'click', () => $('#inputDialog').close());
  on($('#inputDialog'), 'close', () => {
    document.querySelector('.workflow-sidebar').prepend(document.querySelector('.run-input-wrap'));
    $('#expandInputBtn').focus({ preventScroll: true });
  });
  on($('#formatInputBtn'), 'click', formatRunInput);
  on($('#undoBtn'), 'click', () => restoreEdit(history.undo()));
  on($('#redoBtn'), 'click', () => restoreEdit(history.redo()));
  on($('#duplicateBtn'), 'click', duplicateNode);
  on($('#libraryBtn'), 'click', () => libraryUI.open());
  document.addEventListener('focusout', () => history.endGroup());
  document.addEventListener('pointerdown', () => history.endGroup());
  on($('#runBtn'), 'click', runWorkflow);
  on($('#fitBtn'), 'click', () => { if (graph.getNodes().length) graph.zoomToFit({ padding: 48, maxScale: 1 }); });
  on($('#resetBtn'), 'click', () => { if (confirm('Start a new workflow?')) resetWorkflow(); });
  on($('#exportBtn'), 'click', exportWorkflow);
  on($('#importBtn'), 'click', () => $('#importFile')?.click());
  on($('#importFile'), 'change', e => { const file = e.target.files?.[0]; if (file) importWorkflow(file); e.target.value = ''; });
  on($('#exampleSelect'), 'change', e => {
    const name = e.target.value;
    if (name && confirm('Replace the current workflow with this example?')) loadExample(name);
    e.target.value = '';
  });
  graph.on('node:dblclick', ({ node }) => { const record = canvasRecords.nodes.find(r => r.cellId === node.id); if (record && hasBody(record.node)) toggleBody(record); });
  document.addEventListener('keydown', e => {
    if ($('#libraryDialog').open || $('#inputDialog').open || $('#diagnosticDialog').open) return;
    const editingText = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    const modifier = e.ctrlKey || e.metaKey;
    if (modifier && e.key === 'Enter') { e.preventDefault(); runWorkflow(); }
    if (editingText) return;
    if (modifier && e.key.toLowerCase() === 'z') {
      e.preventDefault(); restoreEdit(e.shiftKey ? history.redo() : history.undo());
    } else if (modifier && e.key.toLowerCase() === 'y') {
      e.preventDefault(); restoreEdit(history.redo());
    } else if (modifier && e.key.toLowerCase() === 'd') {
      e.preventDefault(); duplicateNode();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (selectedNodeId) removeNode(selectedNodeId);
      else if (selectedEdgeId) removeEdge(selectedEdgeId);
    }
  });
  renderGraph(true); renderBreadcrumbs();
}

init();
