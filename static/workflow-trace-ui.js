import { previewValue, valueType, listCountSummary } from './workflow-diagnostics.js';
import { TraceSelection, hasBody, isCollection, stepOutput } from './workflow-canvas-model.js';

const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const display = v => typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '[undefined]';
const compact = v => { const s = JSON.stringify(v) ?? '[undefined]'; return s.length > 180 ? `${s.slice(0, 177)}…` : s; };
const colors = { running: '#e9c46a', success: '#80ed99', warning: '#e9c46a', error: '#f39b9b' };
const states = { running: 'Running', success: 'Complete', warning: 'Warning', error: 'Failed' };

export function createTraceUI({ nodeColors, onJump, onExpand, onEdit, getGraph, getRecords, getContext, getSelected }) {
  const $ = s => document.querySelector(s);
  const dialog = $('#diagnosticDialog');
  const layer = $('#canvasAnnotations');
  const selection = new TraceSelection();
  let run = null, pendingFrame = null, inspectedSequence = null, inspectedNode = null, activeTab = 'result', modalSignature = null;
  let surfaces = new Map();

  const fileFor = step => step && step.status !== 'error' ? run?.files?.find(f => f.sequence === step.sequence) : null;
  const fileButton = step => fileFor(step) ? `<button type="button" class="csv-download" data-download-sequence="${step.sequence}">Download CSV ↓</button>` : '';
  function downloadFile(sequence) {
    const file = run?.files?.find(f => f.sequence === Number(sequence)); if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = file.filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function handleDownload(e) { const button = e.target.closest('[data-download-sequence]'); if (button) downloadFile(button.dataset.downloadSequence); }

  const jsonSection = (title, value, open = false) => `<details ${open ? 'open' : ''}><summary>${esc(title)}</summary><pre>${esc(display(value))}</pre></details>`;
  const countMarkup = step => listCountSummary(step) ? `<p class="list-counts" aria-label="List item counts">${esc(listCountSummary(step))}</p>` : '';
  const groupMarkup = step => {
    const grouping = step?.grouping; if (!grouping) return '';
    const keyed = grouping.outputFormat === 'keyed';
    return `<div class="group-result"><h4>Groups</h4>${grouping.groups.length ? `<table><thead><tr><th>Group</th>${keyed ? '' : '<th>Type</th>'}<th>Items</th></tr></thead><tbody>${grouping.groups.map(g => `<tr><td>${esc(g.key === '' ? '(empty string)' : String(g.key))}</td>${keyed ? '' : `<td>${esc(g.keyType)}</td>`}<td>${g.count}</td></tr>`).join('')}</tbody></table>` : '<p>No groups.</p>'}${grouping.groupsOmitted ? `<p>Showing ${grouping.groups.length} of ${grouping.groupCount} groups. All groups remain available.</p>` : ''}</div>`;
  };
  const groupSummary = step => step?.grouping?.groupCount ? step.grouping.groups.slice(0, 3).map(g => `${String(g.key === '' ? '(empty)' : g.key).slice(0, 24)}: ${g.count}`).join(' · ') + (step.grouping.groupCount > 3 ? ` · +${step.grouping.groupCount - 3} groups` : '') : '';
  const outputCard = (step, heading = 'Output') => {
    const output = stepOutput(step);
    const raw = output.available ? `<pre>${esc(typeof output.value === 'string' ? JSON.stringify(output.value) : display(output.value))}</pre>` : `<p class="muted">${step?.status === 'running' ? 'Waiting for output…' : step?.status === 'error' ? 'Stopped before producing output.' : 'No output for this item yet.'}</p>`;
    return `<section class="diagnostic-value"><div class="diagnostic-value-head"><h3>${esc(heading)}</h3>${output.available ? `<span>${esc(valueType(output.value))}</span>` : ''}</div>${countMarkup(step)}${groupMarkup(step)}${step?.file ? `<div class="csv-file-result"><p>${esc(step.file.filename)} · ${step.file.rowCount} ${step.file.rowCount === 1 ? 'row' : 'rows'} · ${step.file.columnCount} ${step.file.columnCount === 1 ? 'column' : 'columns'}</p>${fileButton(step)}</div>` : ''}${output.available && (step.grouping || step.file) ? `<details class="output-json"><summary>JSON preview</summary>${raw}</details>` : raw}</section>`;
  };
  const itemLabel = option => {
    const v = option.item;
    const text = typeof v === 'object' && v !== null ? v.name ?? v.text ?? v.label ?? v.key ?? compact(v) : display(v);
    return `Item ${option.index + 1} · ${String(text).slice(0, 48)}`;
  };
  function pickerMarkup(record) {
    if (!run || !isCollection(record.node)) return '';
    const picker = selection.picker(record.path, record.node.id);
    return `<label class="node-item-picker"><span>Item</span><select data-item-key="${esc(record.key)}" aria-label="Item visualized in ${esc(record.node.label)}" ${picker.options.length ? '' : 'disabled'}><option value="latest" ${picker.following ? 'selected' : ''}>${picker.options.length ? `Latest · item ${picker.options.at(-1).index + 1}` : 'No items yet'}</option>${picker.options.map(o => `<option value="${o.index}" ${!picker.following && picker.selected === o.index ? 'selected' : ''}>${esc(itemLabel(o))}</option>`).join('')}</select></label>`;
  }
  function probabilities(step) {
    const values = Object.entries(step.answer?.probabilities || {}).filter(([, v]) => typeof v === 'number');
    if (typeof step.answer?.noul === 'number') values.push(['true', step.answer.noul], ['false', 1 - step.answer.noul]);
    return values.length ? `<div class="diagnostic-probabilities">${values.sort((a,b) => b[1] - a[1]).map(([key, value]) => `<span>${esc(key)} <b>${(value * 100).toFixed(1)}%</b></span>`).join('')}</div>` : '';
  }

  function modalContent(step) {
    const references = step.references.length ? `<div class="diagnostic-table-wrap"><table><thead><tr><th>Field</th><th>Reference</th><th>Type</th><th>Value</th></tr></thead><tbody>${step.references.map(r => `<tr class="${r.missing ? 'missing-reference' : ''}"><td>${esc(r.field)}</td><td><code>${esc(r.path)}</code></td><td>${r.missing ? 'MISSING' : esc(r.type)}</td><td><pre>${esc(display(r.value))}</pre></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">This step has no template references.</p>';
    const state = step.stateTemplate !== undefined ? `<section class="diagnostic-value"><div class="diagnostic-value-head"><h3>Resolved State</h3><span>${esc(step.stateType)}</span></div><p class="diagnostic-template"><code>${esc(step.stateTemplate)}</code></p><pre>${esc(display(step.state))}</pre><p class="diagnostic-request-status">${step.requestSent ? 'Sent to Laya' : 'Stopped before inference'}</p></section>` : '';
    return `<div class="diagnostic-status ${esc(step.status)}"><b>${esc(states[step.status])}</b><span>Step ${step.sequence} · ${step.durationMs === undefined ? 'in progress' : `${step.durationMs} ms`}</span></div>
      ${step.error ? `<div class="diagnostic-error">${esc(step.error)}</div>` : ''}
      ${step.warnings.length ? `<div class="diagnostic-warning">${step.warnings.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
      <div class="diagnostic-tabs" role="tablist" aria-label="Step details">${[['result','Result'],['inputs','Inputs'],['debug','Diagnostics']].map(([id,label]) => `<button type="button" role="tab" id="tab-${id}" data-diagnostic-tab="${id}" aria-controls="panel-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}">${label}</button>`).join('')}</div>
      <div id="panel-result" role="tabpanel" aria-labelledby="tab-result" ${activeTab !== 'result' ? 'hidden' : ''}>
        ${outputCard(step)}
        ${step.port ? `<p class="diagnostic-route">${['next','done'].includes(step.port) ? 'Next' : 'Selected branch'} <b>${['next','done'].includes(step.port) ? esc(step.nextNode?.label || 'End of flow') : esc(step.port)}</b>${!['next','done'].includes(step.port) && step.nextNode ? ` → ${esc(step.nextNode.label)}` : ''}</p>` : ''}
        ${step.sort ? `<p class="diagnostic-route">Sorted by <b>${esc(step.sort.column)}</b> · ${esc(step.sort.direction === 'desc' ? 'descending' : 'ascending')}</p>` : ''}
        ${probabilities(step)}
        ${step.tests ? jsonSection(step.type === 'switch' ? 'Cases checked' : 'Rules checked', step.tests) : ''}
        ${step.assignments ? jsonSection('Values written', step.assignments) : ''}
        ${step.after ? jsonSection('Variables after this step', step.after) : ''}
      </div>
      <div id="panel-inputs" role="tabpanel" aria-labelledby="tab-inputs" ${activeTab !== 'inputs' ? 'hidden' : ''}>
        ${state}${step.groupingFailure ? jsonSection(`Item ${step.groupingFailure.index + 1} with invalid group key`, step.groupingFailure, true) : ''}${step.input !== undefined ? jsonSection('Input received', step.input, true) : ''}
        ${step.collection !== undefined ? jsonSection('Items received', step.collection, true) : ''}
        ${jsonSection('Input, variables and loop item', step.scope)}
      </div>
      <div id="panel-debug" role="tabpanel" aria-labelledby="tab-debug" ${activeTab !== 'debug' ? 'hidden' : ''}>
        <h3 class="diagnostic-section-title">Resolved references</h3>${references}
        ${step.request ? jsonSection('Model request', step.request) : ''}
        ${step.response ? jsonSection(`Model response${step.httpStatus ? ` · HTTP ${step.httpStatus}` : ''}`, step.response) : ''}
        ${jsonSection('Node settings at run time', step.config)}
      </div>`;
  }
  function refreshModal() {
    let step = run?.trace.find(t => t.sequence === inspectedSequence);
    if (inspectedNode) step = selection.step(inspectedNode.path, inspectedNode.node.id);
    if (!step) {
      modalSignature = null;
      inspectedSequence = null;
      $('#diagnosticTitle').textContent = inspectedNode?.node.label || 'Node details';
      $('#diagnosticLocation').textContent = 'Not reached for the selected item';
      $('#diagnosticNotice').textContent = '';
      $('#jumpDiagnosticBtn').disabled = true;
      $('#diagnosticDetail').innerHTML = '<p class="muted">This node has no retained step for the selected item.</p>';
      $('#diagnosticStepPicker').hidden = true;
      return;
    }
    inspectedSequence = step.sequence;
    const signature = JSON.stringify([step, run.edited, activeTab, selection.steps(step.workflowPath, step.nodeId).map(t => t.sequence)]);
    if (signature === modalSignature) return;
    modalSignature = signature;
    const focusedTab = dialog.querySelector('[role="tab"]:focus')?.id;
    $('#diagnosticTitle').textContent = step.label;
    $('#diagnosticLocation').textContent = step.location;
    $('#diagnosticNotice').textContent = run.edited ? 'Edited since this run. Values below come from the run snapshot.' : '';
    $('#jumpDiagnosticBtn').disabled = false;
    const choices = selection.steps(step.workflowPath, step.nodeId);
    const picker = $('#diagnosticStepPicker');
    picker.hidden = choices.length < 2;
    picker.innerHTML = choices.map(t => `<option value="${t.sequence}" ${t.sequence === step.sequence ? 'selected' : ''}>Step ${t.sequence} · ${t.type === 'map-value' || t.type === 'filter-test' ? 'item result' : t.detail || states[t.status]}</option>`).join('');
    const detail = $('#diagnosticDetail');
    const oldDetails = Number(detail.dataset.sequence) === step.sequence ? new Map([...detail.querySelectorAll('details')].map(d => [d.querySelector('summary').textContent, d.open])) : new Map();
    $('#diagnosticDetail').innerHTML = modalContent(step);
    detail.dataset.sequence = step.sequence;
    detail.querySelectorAll('details').forEach(d => { const title = d.querySelector('summary').textContent; if (oldDetails.has(title)) d.open = oldDetails.get(title); });
    if (focusedTab) $(`#${focusedTab}`)?.focus();
  }
  function inspect(sequence) {
    const step = run?.trace.find(t => t.sequence === sequence); if (!step) return;
    inspectedSequence = sequence; inspectedNode = null; activeTab = step.status === 'error' ? (step.references.some(r => r.missing) ? 'debug' : 'inputs') : 'result';
    refreshModal();
    if (!dialog.open) dialog.showModal();
  }
  function inspectNode(record) {
    const step = selection.step(record.path, record.node.id);
    if (!step) return;
    inspectedSequence = step.sequence; inspectedNode = record; activeTab = step.status === 'error' ? (step.references.some(r => r.missing) ? 'debug' : 'inputs') : 'result';
    refreshModal();
    if (!dialog.open) dialog.showModal();
  }
  function transformLayer() {
    const matrix = getGraph()?.matrix();
    if (matrix) layer.style.transform = `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
  }
  function buildSurfaces() {
    surfaces = new Map(); layer.replaceChildren();
    for (const record of getRecords().nodes) {
      const element = document.createElement('div');
      element.className = 'node-surface'; element.dataset.viewKey = record.key;
      element.style.cssText = `left:${record.x + 10}px;top:${record.y + 54}px;width:${record.width - 20}px;`;
      element.innerHTML = `<div class="node-surface-tools"></div><button type="button" class="node-runtime" data-inspect-node="${esc(record.key)}"></button>`;
      layer.append(element); surfaces.set(record.key, element);
    }
    transformLayer();
  }
  function highlight() {
    const graph = getGraph(); if (!graph) return;
    const records = getRecords();
    for (const record of records.edges) {
      const taken = run && run.trace.some(t => t.edgeId === record.edge.id && JSON.stringify(t.workflowPath) === JSON.stringify(record.path) && selection.matches(t));
      graph.getCellById(record.cellId)?.attr('line/stroke', taken ? '#80ed99' : '#596273');
    }
    for (const record of records.nodes) {
      const step = selection.step(record.path, record.node.id);
      graph.getCellById(record.cellId)?.attr({ body: { stroke: step ? colors[step.status] : nodeColors[record.node.type] || '#657086', strokeWidth: step ? 2.5 : 1.5 } });
      const surface = surfaces.get(record.key); if (!surface) continue;
      const tools = surface.querySelector('.node-surface-tools');
      const toolsHTML = `${hasBody(record.node) ? `<button type="button" data-expand-node="${esc(record.key)}" aria-expanded="${record.expanded}">${record.expanded ? '− Hide body' : '+ Show body'}</button><button type="button" data-edit-body="${esc(record.key)}">Edit body ↗</button>` : ''}${pickerMarkup(record)}${fileButton(step)}`;
      // Keep a focused native item picker mounted during live updates.
      const pickerFocused = tools.contains(document.activeElement) && document.activeElement?.matches('[data-item-key]');
      if (!pickerFocused && tools.innerHTML !== toolsHTML) tools.innerHTML = toolsHTML;
      const output = stepOutput(step);
      const inline = selection.itemStep(record.path, record.node.id);
      const button = surface.querySelector('.node-runtime');
      button.disabled = !step;
      button.className = `node-runtime ${step?.status || 'idle'}`;
      button.setAttribute('aria-label', `Inspect ${record.node.label || record.node.type} output`);
      const status = step ? `${states[step.status]}${step.durationMs !== undefined ? ` · ${step.durationMs} ms` : ''}${step.port ? ` · ${step.port}` : ''}` : run ? 'Not reached for this item' : 'Run to preview output';
      const text = step?.error || (output.available ? compact(output.value) : step?.status === 'running' ? 'Waiting for output…' : run ? 'No retained output' : '');
      const html = `<span class="node-runtime-status">${esc(status)}</span>${listCountSummary(step) ? `<span class="node-runtime-counts" aria-label="List item counts">${esc(listCountSummary(step))}</span>` : ''}${groupSummary(step) ? `<span class="node-runtime-group-summary">${esc(groupSummary(step))}</span>` : ''}<span class="node-runtime-output">${esc(text)}</span>${inline && inline !== step ? `<span class="node-runtime-item">Item result: ${esc(compact(inline.output))}</span>` : ''}`;
      if (button.innerHTML !== html) button.innerHTML = html;
      button.title = step?.location || record.node.label;
    }
  }
  function refreshInspector() {
    const slot = $('#nodeRunDetails'); const record = getSelected();
    if (!slot || !record) return;
    slot.hidden = !run;
    if (!run) return;
    const step = selection.step(record.path, record.node.id);
    const inline = selection.itemStep(record.path, record.node.id);
    const html = `<div class="node-detail-run-head"><h3>Run output</h3>${step ? `<button type="button" data-inspect-sequence="${step.sequence}">Details ↗</button>` : ''}</div>${pickerMarkup(record)}${run?.edited ? '<p class="run-edited-note">From the run snapshot · edited since run</p>' : ''}${step ? `<p class="node-detail-status ${step.status}">${esc(states[step.status])}${step.iterations.length ? ` · ${step.iterations.map(i => `item ${i.index + 1}`).join(' / ')}` : ''}</p>${step.error ? `<p class="diagnostic-error">${esc(step.error)}</p>` : ''}` : ''}${outputCard(step)}${inline && inline !== step ? outputCard(inline, 'Selected item result') : ''}`;
    const pickerFocused = slot.contains(document.activeElement) && document.activeElement?.matches('[data-item-key]');
    if (!pickerFocused && slot.innerHTML !== html) {
      const sameRecord = slot.dataset.record === record.key;
      const openStates = sameRecord ? new Map([...slot.querySelectorAll('details')].map(d => [d.querySelector('summary').textContent, d.open])) : new Map();
      slot.innerHTML = html; slot.dataset.record = record.key;
      slot.querySelectorAll('details').forEach(d => { const title = d.querySelector('summary').textContent; if (openStates.has(title)) d.open = openStates.get(title); });
    }
  }
  function render() {
    selection.update(run?.trace || []);
    if (run) {
      $('#exportDiagnosticsBtn').hidden = $('#runOutputBtn').hidden = false;
      const count = run.trace.length + run.traceOmitted;
      $('#runSummary').textContent = `${run.status === 'running' ? 'Running' : run.error ? `Failed at ${run.error.step?.label || 'workflow'}` : run.status === 'warning' ? 'Finished with warnings' : 'Completed'} · ${count} steps${run.edited ? ' · edited since run' : ''}${run.traceOmitted ? ` · ${run.traceOmitted} earlier steps omitted` : ''}`;
      $('#inspectFailureBtn').hidden = !run.error?.step;
      $('#exportDiagnosticsBtn').disabled = run.status === 'running';
      $('#runOutputBtn').disabled = !run.trace.some(t => ['output', 'csv-output'].includes(t.type) && !t.workflowPath.length);
    }
    const context = $('#viewItemPickers');
    const contextHTML = (getContext() || []).filter(r => isCollection(r.node)).map(r => `<div><b>${esc(r.node.label)}</b>${pickerMarkup(r)}</div>`).join('');
    context.hidden = !run || !contextHTML;
    if (!context.contains(document.activeElement) && context.innerHTML !== contextHTML) context.innerHTML = contextHTML;
    highlight(); refreshInspector();
    if (dialog.open) refreshModal();
  }
  function schedule() {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => { pendingFrame = null; render(); });
  }
  function findRecord(key) { return getRecords().nodes.find(r => r.key === key) || getContext().find(r => r.key === key) || (getSelected()?.key === key ? getSelected() : null); }
  layer.addEventListener('pointerdown', e => e.stopPropagation());
  layer.addEventListener('wheel', e => e.stopPropagation());
  layer.addEventListener('click', e => {
    handleDownload(e);
    const inspectButton = e.target.closest('[data-inspect-node]');
    const expand = e.target.closest('[data-expand-node]');
    const edit = e.target.closest('[data-edit-body]');
    if (inspectButton) inspectNode(findRecord(inspectButton.dataset.inspectNode));
    if (expand) onExpand(findRecord(expand.dataset.expandNode));
    if (edit) onEdit(findRecord(edit.dataset.editBody));
  });
  function changeItem(e) {
    const picker = e.target.closest('[data-item-key]'); if (!picker) return;
    const record = findRecord(picker.dataset.itemKey); if (!record) return;
    selection.choose(record.path, record.node.id, picker.value); render();
  }
  layer.addEventListener('change', changeItem);
  $('#viewItemPickers').addEventListener('change', changeItem);
  $('#inspector').addEventListener('change', changeItem);
  layer.addEventListener('focusout', schedule);
  $('#viewItemPickers').addEventListener('focusout', schedule);
  $('#inspector').addEventListener('focusout', schedule);
  $('#inspector').addEventListener('click', e => { const b = e.target.closest('[data-inspect-sequence]'); if (b) inspect(Number(b.dataset.inspectSequence)); });
  $('#inspector').addEventListener('click', handleDownload);
  $('#diagnosticDetail').addEventListener('click', handleDownload);
  $('#inspectFailureBtn').addEventListener('click', () => { if (run?.error?.step) { selection.reveal(run.error.step); render(); inspect(run.error.step.sequence); } });
  $('#runOutputBtn').addEventListener('click', () => { const step = run?.trace.filter(t => ['output', 'csv-output'].includes(t.type) && !t.workflowPath.length).at(-1); if (step) inspect(step.sequence); });
  $('#closeDiagnosticBtn').addEventListener('click', () => dialog.close());
  $('#jumpDiagnosticBtn').addEventListener('click', () => {
    const step = run?.trace.find(t => t.sequence === inspectedSequence); if (!step) return;
    selection.reveal(step);
    if (onJump(step)) { dialog.close(); render(); }
    else $('#diagnosticNotice').textContent = 'This node was removed. Its run snapshot remains available.';
  });
  $('#diagnosticStepPicker').addEventListener('change', e => { inspectedNode = null; inspectedSequence = Number(e.target.value); refreshModal(); });
  function setTab(tab) {
    activeTab = tab;
    $('#diagnosticDetail').querySelectorAll('[data-diagnostic-tab]').forEach(b => { const selected = b.dataset.diagnosticTab === tab; b.setAttribute('aria-selected', selected); b.tabIndex = selected ? 0 : -1; });
    $('#diagnosticDetail').querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== `panel-${tab}`; });
  }
  $('#diagnosticDetail').addEventListener('click', e => { const tab = e.target.closest('[data-diagnostic-tab]'); if (tab) setTab(tab.dataset.diagnosticTab); });
  $('#diagnosticDetail').addEventListener('keydown', e => {
    if (!e.target.matches('[data-diagnostic-tab]') || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); const tabs = ['result','inputs','debug']; setTab(tabs[(tabs.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]); $(`#tab-${activeTab}`).focus();
  });
  $('#exportDiagnosticsBtn').addEventListener('click', () => {
    if (!run) return;
    const packet = { version: 1, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status, editedSinceRun: run.edited, previewsAreBounded: true, workflow: run.workflow, input: previewValue(run.input), model: run.model, lang: run.lang, trace: run.trace, earlierStepsOmitted: run.traceOmitted, output: run.output, error: run.error ? { message: run.error.message, failedStep: run.error.step?.sequence } : null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'workflow-diagnostics.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  return {
    start(snapshot) {
      selection.reset();
      if (dialog.open) dialog.close();
      run = { ...snapshot, startedAt: new Date().toISOString(), status: 'running', trace: [], traceOmitted: 0, edited: false, files: [] };
      inspectedSequence = inspectedNode = modalSignature = null; render();
    },
    update({ trace, traceOmitted, files = [] }) { if (run) { run.trace = trace; run.traceOmitted = traceOmitted; run.files = files; schedule(); } },
    finish({ trace, traceOmitted = 0, output, error, files = error?.files || [] }) {
      if (!run) return;
      Object.assign(run, { trace, traceOmitted, files, output: previewValue(output), error, status: error ? 'failed' : trace.some(t => t.status === 'warning') ? 'warning' : 'completed', finishedAt: new Date().toISOString() });
      if (pendingFrame !== null) { cancelAnimationFrame(pendingFrame); pendingFrame = null; }
      if (error?.step) selection.reveal(error.step);
      render(); if (dialog.open) refreshModal();
    },
    markEdited() { if (run) { run.edited = true; schedule(); } },
    canvasChanged() { buildSurfaces(); render(); },
    transformLayer, refreshInspector, highlight, inspectNode,
    moveSurface(node) { const record = getRecords().nodes.find(r => r.cellId === node.id); const surface = record && surfaces.get(record.key); if (surface) { const p = node.position(); surface.style.left = `${p.x + 10}px`; surface.style.top = `${p.y + 54}px`; } },
    reveal(step) { selection.reveal(step); },
  };
}
