import { clone, executeWorkflow } from './workflow-runtime.js';

const { Graph } = window.X6 || {};
if (!Graph) throw new Error('AntV X6 failed to load.');

const $ = sel => document.querySelector(sel);
const eventFor = el => el?.tagName === 'SELECT' ? 'change' : 'input';
function showUiError(error) {
  console.error(error);
  const trace = $('#trace');
  if (trace) trace.innerHTML = `<div class="trace-error"><b>UI error</b><pre>${esc(error?.message || error)}</pre></div>`;
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
  input: '#8ecae6', decision: '#e9c46a', condition: '#b8c0ff', set: '#90be6d', foreach: '#f4a261', subflow: '#c77dff', output: '#80ed99',
};
const ICONS = { input: 'IN', decision: '◆', condition: '◇', set: '=', foreach: '↻', subflow: '◫', output: 'OUT' };
const TYPES = [
  ['input', 'Input', 'Entry point and runtime input'],
  ['decision', 'Decision', 'Ask Laya one typed question'],
  ['condition', 'Condition', 'Traditional deterministic branch'],
  ['set', 'Set', 'Write values into workflow state'],
  ['foreach', 'For Each', 'Run a nested workflow for every item'],
  ['subflow', 'Subflow', 'Run a nested workflow once'],
  ['output', 'Output', 'Return a workflow value'],
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
  if (type === 'set') node.config = { assignments: [{ path: 'value', value: '{{input.value}}' }] };
  if (type === 'foreach') node.config = { source: '{{input.items}}', itemVar: 'item', indexVar: 'index', collectAs: 'results', workflow: childWorkflow('Loop body') };
  if (type === 'subflow') node.config = { resultAs: 'subflowResult', workflow: childWorkflow('Subflow') };
  if (type === 'output') node.config = { format: 'value', value: '{{input}}' };
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

const EXAMPLES = { list: listClassifierExample, branch: branchExample };
let workflow = clone(listClassifierExample().workflow);
let runInput = clone(listClassifierExample().input);
let stack = [{ workflow, label: workflow.name }];
let selectedNodeId = null;
let selectedEdgeId = null;
let graph;
let renderingGraph = false;
let dirty = false;
let running = false;

function currentWorkflow() { return stack.at(-1).workflow; }
function currentNode() { return currentWorkflow().nodes.find(n => n.id === selectedNodeId) || null; }
function markDirty() { dirty = true; persist(); const el = $('#saveState'); if (el) el.textContent = 'saved locally'; }
function persist() {
  try { localStorage.setItem('laya-workflow-v1', JSON.stringify({ workflow, runInput })); } catch {}
}
function restore() {
  try {
    const raw = localStorage.getItem('laya-workflow-v1'); if (!raw) return false;
    const saved = JSON.parse(raw); if (!saved?.workflow?.nodes) return false;
    workflow = saved.workflow; runInput = saved.runInput ?? {}; stack = [{ workflow, label: workflow.name || 'Workflow' }]; return true;
  } catch { return false; }
}

function portsFor(node) {
  const input = node.type === 'input' ? [] : [{ id: 'in', group: 'in' }];
  let outs = [];
  if (node.type === 'input' || node.type === 'set') outs = ['next'];
  if (node.type === 'decision') outs = node.config.decisionType === 'noul' ? ['true', 'false'] : (node.config.options || []).map(o => o.key).filter(Boolean);
  if (node.type === 'condition') outs = ['true', 'false'];
  if (node.type === 'foreach' || node.type === 'subflow') outs = ['done'];
  return [...input, ...outs.map(id => ({ id: `out:${id}`, group: 'out' }))];
}
function nodeMeta(node) {
  if (node.type === 'decision') return node.config.decisionType === 'noul' ? 'yes / no' : `${node.config.options?.length || 0} options`;
  if (node.type === 'condition') return `${node.config.conditions?.length || 0} condition(s)`;
  if (node.type === 'foreach') return `for each ${node.config.itemVar || 'item'}`;
  if (node.type === 'subflow') return 'nested workflow';
  if (node.type === 'set') return `${node.config.assignments?.length || 0} assignment(s)`;
  if (node.type === 'output') return 'terminal';
  return 'workflow input';
}

Graph.registerNode('wf-node', {
  inherit: 'rect', width: 196, height: 74,
  markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'icon' }, { tagName: 'text', selector: 'title' }, { tagName: 'text', selector: 'meta' }],
  attrs: {
    body: { rx: 10, ry: 10, strokeWidth: 1.5, fill: '#101217', stroke: '#343a46' },
    icon: { x: 15, y: 25, fontSize: 12, fontWeight: 700, fill: '#e9edf5' },
    title: { x: 42, y: 25, fontSize: 13, fontWeight: 700, fill: '#f4f6fa', textAnchor: 'start' },
    meta: { x: 15, y: 51, fontSize: 11, fill: '#8f98a8', textAnchor: 'start' },
  },
  ports: { groups: {
    in: { position: 'left', attrs: { circle: { r: 5, magnet: true, stroke: '#727b8b', strokeWidth: 1.5, fill: '#0c0e12' } } },
    out: { position: 'right', attrs: { circle: { r: 5, magnet: true, stroke: '#d7dde8', strokeWidth: 1.5, fill: '#0c0e12' } } },
  } },
}, true);

function graphNode(node) {
  return {
    id: node.id, shape: 'wf-node', x: node.position?.x ?? 100, y: node.position?.y ?? 100,
    ports: portsFor(node), data: { modelId: node.id },
    attrs: {
      body: { stroke: COLORS[node.type] || '#657086' },
      icon: { text: ICONS[node.type] || '?' }, title: { text: node.label || node.type }, meta: { text: nodeMeta(node) },
    },
  };
}
function graphEdge(edge) {
  return {
    id: edge.id, source: { cell: edge.from, port: `out:${edge.fromPort || 'next'}` }, target: { cell: edge.to, port: 'in' },
    router: { name: 'manhattan', args: { padding: 16 } }, connector: { name: 'rounded', args: { radius: 8 } },
    attrs: { line: { stroke: '#596273', strokeWidth: 1.5, targetMarker: { name: 'classic', size: 7 } } },
    labels: edge.fromPort && !['next', 'done'].includes(edge.fromPort) ? [{ attrs: { label: { text: edge.fromPort, fill: '#9aa3b2', fontSize: 10 }, body: { fill: '#0d0f13', stroke: '#343a46', rx: 5, ry: 5 } } }] : [],
  };
}

function renderGraph(fit = false) {
  const wf = currentWorkflow();
  renderingGraph = true;
  graph.clearCells();
  graph.addNodes(wf.nodes.map(graphNode));
  for (const edge of wf.edges) {
    if (wf.nodes.some(n => n.id === edge.from) && wf.nodes.some(n => n.id === edge.to)) {
      try { graph.addEdge(graphEdge(edge)); } catch (e) { console.warn('Skipping invalid edge', edge, e); }
    }
  }
  renderingGraph = false;
  if (fit && wf.nodes.length) graph.zoomToFit({ padding: 48, maxScale: 1 });
  renderBreadcrumbs(); renderInspector();
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
    if (edge.from === node.id && !desiredIds.has(`out:${edge.fromPort}`)) removeEdge(edge.id, false);
  }
}

function initGraph() {
  graph = new Graph({
    container: $('#workflowCanvas'), grid: { visible: true, size: 16, type: 'mesh', args: { color: '#20242c', thickness: 1 } },
    background: { color: '#0a0c10' }, panning: { enabled: true },
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.35, maxScale: 2 },
    connecting: {
      snap: { radius: 20 }, allowBlank: false, allowLoop: false, allowNode: false,
      validateConnection({ sourcePort, targetPort }) { return !!sourcePort?.startsWith('out:') && targetPort === 'in'; },
      createEdge() { return graph.createEdge(graphEdge({ id: uid('edge'), from: '', fromPort: 'next', to: '' })); },
    },
    highlighting: { magnetAvailable: { name: 'stroke', args: { padding: 4, attrs: { stroke: '#e9c46a' } } } },
  });
  graph.on('node:click', ({ node }) => { selectedNodeId = node.id; selectedEdgeId = null; renderInspector(); });
  graph.on('edge:click', ({ edge }) => { selectedEdgeId = edge.id; selectedNodeId = null; renderInspector(); });
  graph.on('blank:click', () => { selectedNodeId = selectedEdgeId = null; renderInspector(); });
  graph.on('node:moved', ({ node }) => {
    const model = currentWorkflow().nodes.find(n => n.id === node.id); if (!model) return;
    const p = node.position(); model.position = { x: Math.round(p.x), y: Math.round(p.y) }; markDirty();
  });
  graph.on('edge:connected', ({ edge }) => {
    const src = edge.getSource(); const tgt = edge.getTarget();
    if (!src?.cell || !tgt?.cell || !src.port?.startsWith('out:')) { edge.remove(); return; }
    const id = edge.id || uid('edge');
    if (currentWorkflow().edges.some(e => e.id === id)) return;
    currentWorkflow().edges.push({ id, from: src.cell, fromPort: src.port.slice(4), to: tgt.cell });
    edge.setLabels(!['next', 'done'].includes(src.port.slice(4)) ? [src.port.slice(4)] : []);
    markDirty();
  });
  graph.on('edge:removed', ({ edge, options }) => {
    if (renderingGraph || options?.ui === false) return;
    const i = currentWorkflow().edges.findIndex(e => e.id === edge.id);
    if (i >= 0) { currentWorkflow().edges.splice(i, 1); markDirty(); }
  });
}

function addNode(type, x, y) {
  const rect = $('#workflowCanvas').getBoundingClientRect();
  let pos = { x: rect.width / 2 - 98, y: rect.height / 2 - 37 };
  try { pos = graph.clientToLocal(x ?? rect.left + rect.width / 2, y ?? rect.top + rect.height / 2); } catch {}
  const node = makeNode(type, Math.round(pos.x), Math.round(pos.y));
  currentWorkflow().nodes.push(node); graph.addNode(graphNode(node)); selectedNodeId = node.id; selectedEdgeId = null; markDirty(); renderInspector();
}

function removeEdge(id, refreshInspector = true) {
  const wf = currentWorkflow();
  const i = wf.edges.findIndex(e => e.id === id);
  if (i >= 0) wf.edges.splice(i, 1);
  graph.getCellById(id)?.remove({ ui: false });
  if (selectedEdgeId === id) selectedEdgeId = null;
  markDirty();
  if (refreshInspector) renderInspector();
}

function removeNode(id) {
  const wf = currentWorkflow(); wf.nodes = wf.nodes.filter(n => n.id !== id); wf.edges = wf.edges.filter(e => e.from !== id && e.to !== id);
  graph.getCellById(id)?.remove({ ui: false }); selectedNodeId = null; markDirty(); renderInspector();
}

function field(label, html, help = '') { return `<label class="wf-field"><span>${label}</span>${html}${help ? `<small>${help}</small>` : ''}</label>`; }
function textInput(name, value, placeholder = '') { return `<input data-field="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}">`; }
function textarea(name, value, rows = 4, placeholder = '') { return `<textarea data-field="${name}" rows="${rows}" spellcheck="false" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`; }

const OPS = [
  ['eq', 'equals'], ['neq', 'does not equal'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['contains', 'contains'], ['not_contains', 'does not contain'],
  ['exists', 'exists'], ['not_exists', 'does not exist'], ['empty', 'is empty'], ['not_empty', 'is not empty'], ['starts_with', 'starts with'], ['ends_with', 'ends with'],
];
function conditionRows(node) {
  return (node.config.conditions || []).map((c, i) => `<div class="wf-repeater condition-row" data-index="${i}">
    <input data-cond="left" value="${esc(c.left)}" placeholder="input.status">
    <select data-cond="op">${OPS.map(([v,l]) => `<option value="${v}" ${c.op === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-cond="right" value="${esc(c.right ?? '')}" placeholder="value">
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

function renderInspector() {
  const box = $('#inspector');
  if (selectedEdgeId) {
    const edge = currentWorkflow().edges.find(e => e.id === selectedEdgeId);
    box.innerHTML = edge ? `<div class="inspector-head"><div><b>Connection</b><small>${esc(edge.fromPort || 'next')}</small></div></div><p class="muted">${esc(edge.from)} → ${esc(edge.to)}</p><button class="danger wide" id="deleteEdge">Delete connection</button>` : '<p class="muted">Select a node to edit it.</p>';
    on($('#deleteEdge'), 'click', () => removeEdge(selectedEdgeId)); return;
  }
  const node = currentNode();
  if (!node) { box.innerHTML = '<div class="inspector-empty"><b>Inspector</b><p>Select a node to edit its behavior. Double-click a For Each or Subflow node to open its nested canvas.</p></div>'; return; }
  let body = field('Label', textInput('label', node.label));
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
  if (node.type === 'condition') {
    body += field('Match', `<select data-field="mode"><option value="all" ${node.config.mode !== 'any' ? 'selected' : ''}>all conditions</option><option value="any" ${node.config.mode === 'any' ? 'selected' : ''}>any condition</option></select>`);
    body += `<div class="section-label">Conditions</div><div id="conditionList">${conditionRows(node)}</div><button type="button" class="soft wide" id="addCondition">+ Add condition</button>`;
  }
  if (node.type === 'set') {
    body += `<div class="section-label">Assignments</div><div id="assignmentList">${assignmentRows(node)}</div><button type="button" class="soft wide" id="addAssignment">+ Add assignment</button>`;
    body += `<p class="hint">Assignments write into workflow variables. Use <code>{{variable}}</code> in later nodes.</p>`;
  }
  if (node.type === 'foreach') {
    body += field('Collection', textarea('source', node.config.source, 2, '{{input.items}}'), 'Must resolve to an array.');
    body += field('Item variable', textInput('itemVar', node.config.itemVar || 'item'));
    body += field('Index variable', textInput('indexVar', node.config.indexVar || 'index'));
    body += field('Collect outputs as', textInput('collectAs', node.config.collectAs || 'results'));
    body += `<button type="button" class="soft wide open-nested" data-nested="workflow">Open loop body →</button>`;
  }
  if (node.type === 'subflow') {
    body += field('Store output as', textInput('resultAs', node.config.resultAs || 'subflowResult'));
    body += `<button type="button" class="soft wide open-nested" data-nested="workflow">Open subflow →</button>`;
  }
  if (node.type === 'output') {
    body += field('Output format', `<select data-field="format"><option value="value" ${node.config.format !== 'json' ? 'selected' : ''}>value / template</option><option value="json" ${node.config.format === 'json' ? 'selected' : ''}>JSON template</option></select>`);
    body += field('Value', textarea('value', node.config.value, 7, '{{input}}'), node.config.format === 'json' ? 'JSON placeholders are inserted as real JSON values. Example: {"item": {{item}}}' : 'An exact {{path}} returns the raw value; mixed text interpolates it.');
  }
  if (node.type === 'input') body += '<p class="hint">The Input node is the entry point. Runtime input is edited in the left panel.</p>';
  body += node.type !== 'input' || currentWorkflow().nodes.filter(n => n.type === 'input').length > 1 ? '<button type="button" class="danger wide" id="deleteNode">Delete node</button>' : '';
  box.innerHTML = `<div class="inspector-head"><div><b>${esc(ICONS[node.type])} ${esc(node.label)}</b><small>${esc(node.type)}</small></div></div>${body}`;
  wireInspector(node);
}

function wireInspector(node) {
  $('#inspector').querySelectorAll('[data-field]').forEach(el => on(el, eventFor(el), () => {
    const key = el.dataset.field;
    const value = el.type === 'number' ? Number(el.value) : el.value;
    if (key === 'label') node.label = value; else node.config[key] = value;
    if (key === 'decisionType' && value === 'choice' && (!node.config.options || node.config.options.length < 2)) {
      node.config.options = [
        { key: 'option_a', label: 'Option A', description: 'First option.' },
        { key: 'option_b', label: 'Option B', description: 'Second option.' },
      ];
    }
    syncNodeCell(node);
    markDirty();
    if (key === 'decisionType' || key === 'format') renderInspector();
  }));
  $('#inspector').querySelectorAll('[data-option]').forEach(el => on(el, eventFor(el), () => {
    const row = el.closest('[data-index]');
    const i = Number(row?.dataset.index);
    if (!Number.isInteger(i) || !node.config.options?.[i]) return;
    node.config.options[i][el.dataset.option] = el.value;
    syncNodeCell(node);
    markDirty();
  }));
  $('#inspector').querySelectorAll('[data-cond]').forEach(el => on(el, eventFor(el), () => {
    const i = Number(el.closest('[data-index]')?.dataset.index);
    if (!Number.isInteger(i) || !node.config.conditions?.[i]) return;
    node.config.conditions[i][el.dataset.cond] = el.value;
    syncNodeCell(node);
    markDirty();
  }));
  $('#inspector').querySelectorAll('[data-assign]').forEach(el => on(el, eventFor(el), () => {
    const i = Number(el.closest('[data-index]')?.dataset.index);
    if (!Number.isInteger(i) || !node.config.assignments?.[i]) return;
    node.config.assignments[i][el.dataset.assign] = el.value;
    syncNodeCell(node);
    markDirty();
  }));
  on($('#addOption'), 'click', () => {
    node.config.options ||= [];
    const n = node.config.options.length + 1;
    node.config.options.push({ key: `option_${n}`, label: `Option ${n}`, description: `The ${n}th option.` });
    syncNodeCell(node); markDirty(); renderInspector();
  });
  $('#inspector').querySelectorAll('[data-remove-option]').forEach(b => on(b, 'click', () => {
    node.config.options ||= [];
    node.config.options.splice(Number(b.dataset.removeOption), 1);
    syncNodeCell(node); markDirty(); renderInspector();
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
  $('#inspector').querySelectorAll('.open-nested').forEach(b => on(b, 'click', () => openNested(node)));
}

function openNested(node) {
  if (!node.config.workflow) node.config.workflow = childWorkflow(node.type === 'foreach' ? 'Loop body' : 'Subflow');
  stack.push({ workflow: node.config.workflow, label: node.label, owner: node.id }); selectedNodeId = selectedEdgeId = null; renderGraph(true);
}
function renderBreadcrumbs() {
  $('#breadcrumbs').innerHTML = stack.map((s, i) => `<button type="button" data-crumb="${i}" ${i === stack.length - 1 ? 'aria-current="page"' : ''}>${esc(i === 0 ? workflow.name || 'Workflow' : s.label)}</button>${i < stack.length - 1 ? '<span>›</span>' : ''}`).join('');
  $('#breadcrumbs').querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => { const i = Number(b.dataset.crumb); stack = stack.slice(0, i + 1); selectedNodeId = selectedEdgeId = null; renderGraph(true); }));
}

function renderPalette() {
  const palette = $('#palette');
  palette.innerHTML = TYPES.map(([type, name, desc]) => `<button type="button" class="palette-node" draggable="true" data-node-type="${type}"><span class="palette-icon" style="--node-color:${COLORS[type]}">${esc(ICONS[type])}</span><span><b>${name}</b><small>${desc}</small></span></button>`).join('');
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
function pretty(value) { return JSON.stringify(value, null, 2); }
function renderTrace(trace, output, error = null) {
  const el = $('#trace');
  if (error) { el.innerHTML = `<div class="trace-error"><b>Run failed</b><pre>${esc(error.message || error)}</pre></div>`; return; }
  const rows = trace.map((t, i) => {
    let extra = '';
    if (t.answer?.probabilities) extra = `<div class="trace-probs">${Object.entries(t.answer.probabilities).sort((a,b) => b[1]-a[1]).map(([k,v]) => `<span>${esc(k)} <b>${(v*100).toFixed(1)}%</b></span>`).join('')}</div>`;
    if (typeof t.answer?.noul === 'number') extra = `<div class="trace-probs"><span>true <b>${(t.answer.noul*100).toFixed(1)}%</b></span><span>false <b>${((1-t.answer.noul)*100).toFixed(1)}%</b></span></div>`;
    return `<div class="trace-row" style="--depth:${t.depth || 0}"><span class="trace-num">${i + 1}</span><span class="trace-kind">${esc(ICONS[t.type] || '·')}</span><div><b>${esc(t.label)}</b><small>${esc(t.detail ?? '')}</small>${extra}</div></div>`;
  }).join('');
  el.innerHTML = `${rows}<div class="trace-output"><span>OUTPUT</span><pre>${esc(typeof output === 'string' ? output : pretty(output))}</pre></div>`;
}

async function runWorkflow() {
  if (running) return; running = true; $('#runBtn').disabled = true; $('#runBtn').textContent = 'Running…';
  runInput = parseInput(); persist(); $('#trace').innerHTML = '<div class="trace-loading">Executing workflow…</div>';
  try {
    const result = await executeWorkflow(workflow, runInput, { model: $('#model').value, lang: $('#lang').value.trim() });
    renderTrace(result.trace, result.output);
    highlightTrace(result.trace);
  } catch (e) { renderTrace([], undefined, e); }
  finally { running = false; $('#runBtn').disabled = false; $('#runBtn').textContent = 'Run'; }
}
function highlightTrace(trace) {
  graph.getEdges().forEach(e => e.attr('line/stroke', '#596273'));
  graph.getNodes().forEach(n => n.attr('body/strokeWidth', 1.5));
  const ids = trace.filter(t => !t.depth).map(t => t.nodeId);
  ids.forEach(id => graph.getCellById(id)?.attr('body/strokeWidth', 3));
}

function loadExample(name) {
  const example = EXAMPLES[name]?.(); if (!example) return;
  workflow = clone(example.workflow); runInput = clone(example.input); stack = [{ workflow, label: workflow.name }]; selectedNodeId = selectedEdgeId = null;
  $('#runInput').value = pretty(runInput); $('#workflowName').value = workflow.name; markDirty(); renderGraph(true); $('#trace').innerHTML = '<p class="muted">Run the workflow to see each decision and branch here.</p>';
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
  initGraph(); renderPalette();
  $('#workflowName').value = workflow.name || 'Workflow'; $('#runInput').value = typeof runInput === 'string' ? runInput : pretty(runInput);
  on($('#workflowName'), 'input', e => { workflow.name = e.target.value; stack[0].label = workflow.name; renderBreadcrumbs(); markDirty(); });
  on($('#runInput'), 'input', () => { runInput = parseInput(); persist(); });
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
  graph.on('node:dblclick', ({ node }) => { const model = currentWorkflow().nodes.find(n => n.id === node.id); if (model && ['foreach','subflow'].includes(model.type)) openNested(model); });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runWorkflow(); } if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) { if (selectedNodeId) removeNode(selectedNodeId); else if (selectedEdgeId) removeEdge(selectedEdgeId); } });
  renderGraph(true); renderBreadcrumbs();
}

init();
