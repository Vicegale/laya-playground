import { previewValue, valueType } from './workflow-diagnostics.js';
import { parseCSV, stringifyCSV, csvFilename, sortCSVRows } from './workflow-csv.js';

const MAX_STEPS = 500;
const MAX_TRACE_STEPS = 1000;
const now = () => globalThis.performance?.now() ?? Date.now();

export class WorkflowExecutionError extends Error {
  constructor(cause, step, env) {
    super(cause?.message || String(cause));
    this.name = 'WorkflowExecutionError';
    this.step = step;
    this.trace = env.trace;
    this.traceOmitted = env.stats.omitted;
    this.files = env.files;
  }
}

function notifyTrace(env) {
  try { env.onTrace?.({ trace: env.trace, traceOmitted: env.stats.omitted, files: env.files }); }
  catch (error) { console.warn('Could not update trace display', error); }
}

function resolveValue(template, scope, step, field) {
  if (typeof template === 'string') {
    for (const match of template.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
      const path = match[1].trim();
      const value = getPath(scope, path);
      step.references.push({ field, path, missing: value === undefined, type: valueType(value), value: previewValue(value) });
    }
  }
  return renderTemplate(template, scope);
}

function testConditions(conditions, mode, scope, step) {
  const values = conditions.map((c, i) => {
    const left = getPath(scope, c.left);
    step.references.push({ field: `Condition ${i + 1} left`, path: c.left, missing: left === undefined, type: valueType(left), value: previewValue(left) });
    const right = resolveValue(c.right ?? '', scope, step, `Condition ${i + 1} right`);
    const passed = evalCondition(c, scope);
    (step.tests ||= []).push({ left: c.left, leftValue: previewValue(left), op: c.op, right: previewValue(typeof right === 'string' ? primitive(right) : right), passed });
    return passed;
  });
  return mode === 'any' ? values.some(Boolean) : values.every(Boolean);
}

// Counts use complete runtime values, never the bounded diagnostic previews.
function recordListCount(step, side, value) {
  if (Array.isArray(value)) (step.listCounts ||= {})[side] = value.length;
}

function emptyState(value) {
  return value == null || (typeof value === 'string' && !value.trim())
    || (Array.isArray(value) && !value.length)
    || (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && !Object.keys(value).length);
}

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function getPath(scope, path) {
  if (path == null || path === '') return undefined;
  if (typeof path !== 'string') return path;
  const clean = path.trim().replace(/^\$\.?/, '');
  if (!clean) return scope;
  const parts = [];
  let offset = 0;
  while (offset < clean.length) {
    if (clean[offset] === '.') { offset++; continue; }
    if (clean[offset] === '[') {
      const match = clean.slice(offset).match(/^\[(?:(\d+)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\]/);
      if (!match) return undefined;
      try { parts.push(match[1] ?? (match[2] !== undefined ? JSON.parse(`"${match[2]}"`) : match[3].replace(/\\(['\\])/g, '$1'))); }
      catch { return undefined; }
      offset += match[0].length;
    } else {
      const match = clean.slice(offset).match(/^[^.[\]]+/); if (!match) return undefined;
      parts.push(match[0]); offset += match[0].length;
    }
  }
  let cur = scope;
  for (const part of parts) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(Object(cur), part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function primitive(text) {
  const s = String(text ?? '').trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (s !== '' && Number.isFinite(Number(s))) return Number(s);
  try { return JSON.parse(s); } catch { return text; }
}

export function scopeFor(ctx) {
  return {
    input: ctx.input,
    vars: ctx.vars,
    decisions: ctx.decisions,
    ...ctx.vars,
    ...ctx.locals,
  };
}

export function renderTemplate(template, scope) {
  if (template == null) return '';
  if (typeof template !== 'string') return template;
  const exact = template.match(/^\s*{{\s*([^{}]+?)\s*}}\s*$/);
  if (exact) return getPath(scope, exact[1]);
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_, path) => {
    const value = getPath(scope, path);
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export function renderJsonTemplate(template, scope) {
  if (template == null || template === '') return null;
  if (typeof template !== 'string') return clone(template);
  const exact = template.match(/^\s*{{\s*([^{}]+?)\s*}}\s*$/);
  if (exact) return clone(getPath(scope, exact[1]));
  const rendered = template.replace(/{{\s*([^{}]+?)\s*}}/g, (_, path) => JSON.stringify(getPath(scope, path)));
  return JSON.parse(rendered);
}

export function setVar(ctx, path, value) {
  let clean = String(path || '').trim();
  if (!clean) throw new Error('Set node needs a variable path.');
  if (clean.startsWith('vars.')) clean = clean.slice(5);
  const parts = clean.split('.').filter(Boolean);
  if (!parts.length) throw new Error('Set node needs a variable path.');
  let cur = ctx.vars;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    // Copy only the written path. Per-item scopes can share large read-only CSV
    // lists without copying the entire dataset for every row.
    const previous = Object.prototype.hasOwnProperty.call(cur, key) ? cur[key] : null;
    Object.defineProperty(cur, key, { value: previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {}, enumerable: true, writable: true, configurable: true });
    cur = cur[key];
  }
  Object.defineProperty(cur, parts.at(-1), { value, enumerable: true, writable: true, configurable: true });
}

function comparable(value) {
  if (typeof value === 'string') return value.toLowerCase();
  return value;
}

export function evalCondition(condition, scope) {
  const left = getPath(scope, condition.left);
  const op = condition.op || 'eq';
  const rightRendered = renderTemplate(condition.right ?? '', scope);
  const right = typeof rightRendered === 'string' ? primitive(rightRendered) : rightRendered;
  switch (op) {
    case 'eq': return left === right || comparable(left) === comparable(right);
    case 'neq': return !(left === right || comparable(left) === comparable(right));
    case 'gt': return Number(left) > Number(right);
    case 'gte': return Number(left) >= Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'lte': return Number(left) <= Number(right);
    case 'contains': return Array.isArray(left) ? left.some(v => v === right) : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase());
    case 'not_contains': return !(Array.isArray(left) ? left.some(v => v === right) : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase()));
    case 'exists': return left !== undefined && left !== null;
    case 'not_exists': return left === undefined || left === null;
    case 'empty': return left == null || left === '' || (Array.isArray(left) && left.length === 0) || (typeof left === 'object' && !Array.isArray(left) && Object.keys(left).length === 0);
    case 'not_empty': return !(left == null || left === '' || (Array.isArray(left) && left.length === 0) || (typeof left === 'object' && !Array.isArray(left) && Object.keys(left).length === 0));
    case 'starts_with': return String(left ?? '').toLowerCase().startsWith(String(right ?? '').toLowerCase());
    case 'ends_with': return String(left ?? '').toLowerCase().endsWith(String(right ?? '').toLowerCase());
    default: throw new Error(`Unknown condition operator: ${op}`);
  }
}

function edgeFor(workflow, nodeId, port, exactOnly = false) {
  const exact = workflow.edges.find(e => e.from === nodeId && e.fromPort === port);
  if (exact || exactOnly) return exact || null;
  return workflow.edges.find(e => e.from === nodeId && (!e.fromPort || e.fromPort === 'next')) || null;
}

function startNode(workflow) {
  return workflow.nodes.find(n => n.type === 'input') || workflow.nodes.find(n => !workflow.edges.some(e => e.to === n.id));
}

function decisionQuestion(node, resolve) {
  const cfg = node.config || {};
  const key = (cfg.key || node.id).replace(/[^a-zA-Z0-9_]/g, '_');
  if (cfg.decisionType === 'noul') {
    const criteria = {};
    if (cfg.trueCriterion?.trim()) criteria.true = resolve(cfg.trueCriterion, 'True criterion');
    if (cfg.falseCriterion?.trim()) criteria.false = resolve(cfg.falseCriterion, 'False criterion');
    return {
      key,
      question: {
        type: 'noul',
        instructions: resolve(cfg.question || 'Is this true?', 'Question'),
        ...(Object.keys(criteria).length ? { criteria } : {}),
      },
    };
  }
  const criteria = {};
  for (const option of cfg.options || []) {
    const optionKey = String(option.key || '').trim();
    if (!optionKey) continue;
    criteria[optionKey] = resolve(option.description || option.label || optionKey, `Option ${optionKey}`);
  }
  if (Object.keys(criteria).length < 2) throw new Error(`Decision “${node.label || node.id}” needs at least two options.`);
  return {
    key,
    question: {
      type: 'choice',
      instructions: resolve(cfg.question || 'Which option best fits?', 'Question'),
      criteria,
    },
  };
}

function answerConfidence(answer, selected) {
  if (typeof answer?.confidence === 'number') return answer.confidence;
  if (answer?.probabilities && selected in answer.probabilities) return answer.probabilities[selected];
  if (typeof answer?.noul === 'number') return Math.max(answer.noul, 1 - answer.noul);
  return null;
}

async function runNode(node, workflow, ctx, env, depth, step) {
  const scope = scopeFor(ctx);
  const cfg = node.config || {};
  const resolve = (template, field) => resolveValue(template, scope, step, field);

  if (node.type === 'input') {
    recordListCount(step, 'input', ctx.input);
    recordListCount(step, 'output', ctx.input);
    Object.assign(step, { detail: 'input', input: previewValue(ctx.input), output: previewValue(ctx.input) });
    return { port: 'next' };
  }

  if (node.type === 'csv') {
    if (!cfg.resultAs?.trim()) throw new Error('Choose a variable under Store rows as.');
    const text = cfg.mode === 'template' ? resolve(cfg.source ?? '{{input}}', 'CSV text') : cfg.content ?? '';
    const parsed = parseCSV(text, { delimiter: cfg.delimiter ?? 'auto' });
    step.listCounts = { input: parsed.rows.length, output: parsed.rows.length };
    const metadata = { columns: parsed.columns, columnCount: parsed.columns.length, delimiter: parsed.delimiter, filename: String(cfg.filename || 'input.csv'), rowCount: parsed.rows.length };
    setVar(ctx, cfg.resultAs, parsed.rows);
    setVar(ctx, `${cfg.resultAs.trim()}Csv`, metadata);
    Object.assign(step, { detail: `${parsed.rows.length} row(s) · ${parsed.columns.length} columns`, csv: previewValue(metadata), output: previewValue(parsed.rows) });
    return { port: 'next' };
  }

  if (node.type === 'csv-output') {
    const sourceRows = resolve(cfg.source ?? '{{rows}}', 'CSV rows');
    recordListCount(step, 'input', sourceRows);
    const rows = sortCSVRows(sourceRows, { sortBy: cfg.sortBy?.trim() || '', sortDirection: cfg.sortDirection ?? 'asc' });
    const hasColumns = typeof cfg.columns === 'string' ? !!cfg.columns.trim() : cfg.columns != null;
    let columns = hasColumns ? resolve(cfg.columns, 'CSV column order') : [];
    if (columns === undefined) throw new Error('CSV column order is missing. Check the CSV metadata reference, or leave it blank to infer columns.');
    if (typeof columns === 'string') {
      try { columns = JSON.parse(columns); }
      catch { throw new Error('CSV column order must reference an array or contain a JSON array of column names.'); }
    }
    const file = stringifyCSV(rows, { columns, delimiter: cfg.delimiter ?? ',', bom: cfg.bom !== false });
    const filename = csvFilename(resolve(cfg.filename || 'tagged.csv', 'CSV filename'));
    const metadata = { filename, rowCount: file.rowCount, columnCount: file.columns.length, columns: file.columns, delimiter: cfg.delimiter ?? ',', bytes: new TextEncoder().encode(file.content).length };
    if (cfg.sortBy?.trim()) step.sort = { column: cfg.sortBy.trim(), direction: cfg.sortDirection ?? 'asc' };
    env.files.push({ ...metadata, sequence: step.sequence, nodeId: node.id, workflowPath: [...env.workflowPath], content: file.content, mimeType: 'text/csv;charset=utf-8' });
    recordListCount(step, 'output', rows);
    Object.assign(step, { detail: `${file.rowCount} row(s) · ${filename}`, file: previewValue(metadata), output: previewValue(rows) });
    return { terminal: true, output: rows };
  }

  if (node.type === 'decision') {
    const template = cfg.state || '{{input}}';
    const state = resolve(template, 'State');
    recordListCount(step, 'input', state);
    Object.assign(step, { stateTemplate: template, state: previewValue(state), stateType: valueType(state), requestSent: false });
    const { key, question } = decisionQuestion(node, resolve);
    const request = {
      state,
      questions: { [key]: question },
      ...(env.model ? { model: env.model } : {}),
      ...(env.lang ? { lang: env.lang } : {}),
    };
    step.question = previewValue(question);
    step.request = previewValue(request);
    const missing = step.references.filter(r => r.field === 'State' && r.missing);
    if (emptyState(state)) {
      const reason = missing.length
        ? `State reference ${missing.map(r => `“${r.path}”`).join(', ')} is missing. Check the input fields or this node's State template.`
        : `State resolves to an empty ${valueType(state)}. Provide data in Workflow input or change this node's State template.`;
      throw new Error(reason);
    }
    if (missing.length) step.warnings.push('Some State references are missing; they were interpolated as empty text.');
    step.requestSent = true;
    step.detail = 'Waiting for Laya';
    notifyTrace(env);
    let result;
    try { result = await env.predict(request); }
    catch (error) {
      if (error.response) step.response = previewValue(error.response);
      if (error.httpStatus) step.httpStatus = error.httpStatus;
      throw error;
    }
    step.response = previewValue(result);
    if (result?.error) throw new Error(result.error);
    const answer = result?.answers?.[key];
    if (!answer) throw new Error(`Laya returned no answer for “${key}”.`);
    let selected;
    if ((cfg.decisionType || 'choice') === 'noul') {
      const pTrue = Number(answer.noul ?? answer.probabilities?.true ?? 0);
      selected = pTrue >= Number(cfg.threshold ?? 0.5) ? 'true' : 'false';
    } else {
      selected = answer.choice;
    }
    if (!selected) throw new Error(`Decision “${node.label || node.id}” returned no choice.`);
    const stored = { ...clone(answer), choice: selected, confidence: answerConfidence(answer, selected) };
    ctx.decisions[key] = stored;
    if (cfg.resultAs) setVar(ctx, cfg.resultAs, selected);
    Object.assign(step, { detail: selected, answer: previewValue(stored), output: previewValue(stored) });
    return { port: selected };
  }

  if (node.type === 'switch') {
    const value = cfg.value === null ? null : resolve(cfg.value === undefined ? '{{input.value}}' : cfg.value, 'Switch value');
    Object.assign(step, { input: previewValue(value), inputType: valueType(value), tests: [] });
    const scalar = v => v === null || ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v));
    if (value === undefined) throw new Error('Switch value is missing. Check the value reference or workflow input.');
    if (!scalar(value)) throw new Error(`Switch expects a string, number, boolean or null, got ${valueType(value)}. Select a field from the object or list.`);
    const cases = cfg.cases ?? [];
    if (!Array.isArray(cases)) throw new Error('Switch cases must be a list.');
    const keys = new Set();
    for (const c of cases) {
      const key = typeof c?.key === 'string' ? c.key.trim() : '';
      if (!key || key === 'default' || keys.has(key)) throw new Error('Switch case ports must have unique, nonempty names; “default” is reserved.');
      keys.add(key);
      if (c.format != null && !['text', 'json'].includes(c.format)) throw new Error(`Switch case “${key}” has an unknown value format.`);
    }
    let selected = 'default';
    for (const c of cases) {
      const key = c.key.trim();
      const template = c.value === undefined ? '' : c.value;
      const rendered = template === null ? null : resolve(template, `Case ${key}`);
      let expected = rendered;
      if (c.format === 'json') {
        try {
          if (typeof template === 'string' && !template.trim()) throw new Error('Empty JSON');
          expected = renderJsonTemplate(template, scope);
        }
        catch { throw new Error(`Switch case “${key}” contains invalid JSON. Use JSON strings, numbers, booleans or null.`); }
      }
      if (!scalar(expected)) throw new Error(`Switch case “${key}” must resolve to a string, number, boolean or null, got ${valueType(expected)}.`);
      const passed = value === expected;
      step.tests.push({ case: key, expected: previewValue(expected), expectedType: valueType(expected), passed });
      if (passed) { selected = key; break; }
    }
    Object.assign(step, { detail: selected, output: { value: previewValue(value), case: selected, matched: selected !== 'default' } });
    return { port: selected };
  }

  if (node.type === 'condition') {
    const tests = cfg.conditions?.length ? cfg.conditions : [{ left: '', op: 'exists', right: '' }];
    const passed = testConditions(tests, cfg.mode || 'all', scope, step);
    step.detail = passed ? 'true' : 'false';
    step.output = passed;
    return { port: passed ? 'true' : 'false' };
  }

  // Inline collection operations execute as traceable per-item steps. Their ID
  // points back to the owning Map/Filter so canvas navigation remains useful.
  if (node.type === 'map-value') {
    recordListCount(step, 'input', ctx.locals.item);
    const template = cfg.value ?? '{{item}}';
    const rendered = resolve(template, 'Mapped value');
    const value = cfg.format === 'json' ? renderJsonTemplate(template, scope) : clone(rendered);
    if (value === undefined) throw new Error('Map value resolved to undefined. Check the missing references or return an explicit null.');
    recordListCount(step, 'output', value);
    Object.assign(step, { detail: 'mapped', output: previewValue(value) });
    return { terminal: true, output: value };
  }

  if (node.type === 'filter-test') {
    const keep = testConditions(cfg.conditions || [], cfg.match || 'all', scope, step);
    Object.assign(step, { detail: keep ? 'kept' : 'removed', output: keep, kept: keep });
    return { terminal: true, output: keep };
  }

  if (node.type === 'map' || node.type === 'filter') {
    const source = resolve(cfg.source ?? '{{input.items}}', 'Collection');
    step.collection = previewValue(source);
    if (!Array.isArray(source)) throw new Error(`${node.type === 'map' ? 'Map' : 'Filter'} expected an array, got ${valueType(source)}.`);
    step.listCounts = { input: source.length, output: 0, processed: 0 };
    notifyTrace(env);
    if (!cfg.resultAs?.trim()) throw new Error('Choose a variable under Store list as.');
    const nested = cfg.mode === 'workflow';
    if (nested && !cfg.workflow?.nodes?.length) throw new Error('The per-item workflow is empty.');
    const results = [];
    step.itemCount = source.length;
    step.detail = `${source.length} item(s)`;
    for (let i = 0; i < source.length; i++) {
      const item = clone(source[i]);
      const childCtx = { input: item, vars: { ...ctx.vars }, decisions: { ...ctx.decisions }, locals: { ...ctx.locals, parentInput: ctx.input, item, index: i } };
      const childEnv = {
        ...env,
        workflowPath: nested ? [...env.workflowPath, node.id] : [...env.workflowPath],
        pathLabels: [...env.pathLabels, `${node.label || node.type} (item ${i + 1})`],
        iterations: [...env.iterations, { nodeId: node.id, label: node.label || node.type, workflowPath: [...env.workflowPath], index: i, item: previewValue(item) }],
        outputContract: node.type === 'filter' ? 'boolean' : cfg.keepOriginal ? 'row' : 'value',
      };
      const body = nested ? cfg.workflow : { nodes: [{ ...node, label: node.type === 'map' ? 'Mapped value' : 'Keep item?', type: node.type === 'map' ? 'map-value' : 'filter-test' }], edges: [] };
      const result = await executeWorkflow(body, childCtx, childEnv, depth + 1);
      if (node.type === 'map') {
        if (cfg.keepOriginal) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || !result.output || typeof result.output !== 'object' || Array.isArray(result.output)) throw new Error(`Map item ${i + 1}: Keep original fields requires both the item and mapped output to be objects.`);
          results.push({ ...item, ...clone(result.output) });
        } else results.push(clone(result.output));
      }
      else if (result.output === true) results.push(clone(source[i]));
      Object.assign(step.listCounts, { output: results.length, processed: i + 1 });
      notifyTrace(env);
    }
    setVar(ctx, cfg.resultAs, results);
    Object.assign(step, { detail: node.type === 'map' ? `${results.length} item(s) mapped` : `${results.length} of ${source.length} kept`, output: previewValue(results), keptCount: node.type === 'filter' ? results.length : undefined });
    return { port: 'done' };
  }

  if (node.type === 'groupby') {
    const source = resolve(cfg.source ?? '{{input.items}}', 'Collection');
    step.collection = previewValue(source);
    if (!Array.isArray(source)) throw new Error(`Group By expected an array, got ${valueType(source)}.`);
    step.listCounts = { input: source.length, output: 0, processed: 0, inputUnit: 'items', outputUnit: 'groups' };
    if (!cfg.resultAs?.trim()) throw new Error('Choose a variable under Store groups as.');
    const outputFormat = cfg.outputFormat ?? 'list';
    if (!['keyed', 'list'].includes(outputFormat)) throw new Error('Group By output format must be keyed or list.');
    const keyTemplate = cfg.key === undefined ? '{{item.category}}' : cfg.key;
    const groups = new Map();
    const propertyKeys = new Map();
    try {
      for (let i = 0; i < source.length; i++) {
        const item = source[i];
        const itemScope = { ...scope, input: item, parentInput: ctx.input, item, index: i };
        const keyStep = { references: [] };
        const key = keyTemplate === null ? null : resolveValue(keyTemplate, itemScope, keyStep, `Group key (item ${i + 1})`);
        if (i === 0) step.references.push(...keyStep.references);
        const missing = keyStep.references.some(r => r.missing) || key === undefined;
        const scalar = key === null || ['string', 'boolean'].includes(typeof key) || (typeof key === 'number' && Number.isFinite(key));
        if (missing || !scalar) {
          if (i !== 0) step.references.push(...keyStep.references);
          step.groupingFailure = { index: i, item: previewValue(item), key: previewValue(key) };
          throw new Error(`Group By item ${i + 1}: ${missing ? 'group key is missing. Check the key reference or provide a value for every item.' : `group key must be a string, number, boolean or null, got ${valueType(key)}.`}`);
        }
        if (outputFormat === 'keyed') {
          const property = String(key);
          if (propertyKeys.has(property) && propertyKeys.get(property) !== key) {
            step.groupingFailure = { index: i, item: previewValue(item), key: previewValue(key) };
            throw new Error(`Group By item ${i + 1}: different typed keys both become property “${property}”. Use Group list output to keep their types distinct.`);
          }
          propertyKeys.set(property, key);
        }
        if (!groups.has(key)) groups.set(key, { key, items: [], count: 0 });
        const group = groups.get(key);
        group.items.push(clone(item)); group.count++;
        Object.assign(step.listCounts, { output: groups.size, processed: i + 1 });
      }
      const entries = [...groups.values()];
      const result = outputFormat === 'keyed'
        ? Object.fromEntries(entries.map(g => [String(g.key), g.items]))
        : entries;
      setVar(ctx, cfg.resultAs, result);
      Object.assign(step, { detail: `${source.length} items in ${groups.size} groups`, output: previewValue(result) });
    } finally {
      // Group counts stay accurate even if large item previews are shortened.
      step.grouping = { outputFormat, groupCount: groups.size, itemCount: step.listCounts.processed,
        groups: previewValue([...groups.values()].slice(0, 12).map(g => ({ key: g.key, keyType: valueType(g.key), count: g.count }))),
        groupsOmitted: Math.max(0, groups.size - 12) };
    }
    return { port: 'done' };
  }

  if (node.type === 'set') {
    for (const assignment of cfg.assignments || []) {
      if (!assignment.path?.trim()) continue;
      const rendered = resolveValue(assignment.value ?? '', scopeFor(ctx), step, `Assignment ${assignment.path}`);
      const value = typeof rendered === 'string' ? primitive(rendered) : clone(rendered);
      setVar(ctx, assignment.path, value);
      (step.assignments ||= []).push({ path: assignment.path, value: previewValue(value) });
    }
    step.detail = `${(cfg.assignments || []).length} assignment(s)`;
    step.output = previewValue(Object.fromEntries((step.assignments || []).map(a => [a.path, a.value])));
    return { port: 'next' };
  }

  if (node.type === 'foreach') {
    const source = resolve(cfg.source || '{{input}}', 'Collection');
    step.collection = previewValue(source);
    if (!Array.isArray(source)) throw new Error(`For Each “${node.label || node.id}” expected an array, got ${source === null ? 'null' : typeof source}.`);
    step.listCounts = { input: source.length, output: 0, processed: 0 };
    notifyTrace(env);
    const child = cfg.workflow;
    if (!child?.nodes?.length) throw new Error(`For Each “${node.label || node.id}” has no loop body.`);
    const results = [];
    step.detail = `${source.length} item(s)`;
    step.itemCount = source.length;
    for (let i = 0; i < source.length; i++) {
      const childCtx = {
        input: ctx.input,
        vars: { ...ctx.vars },
        decisions: {},
        locals: { ...ctx.locals, [cfg.itemVar || 'item']: source[i], [cfg.indexVar || 'index']: i },
      };
      const childEnv = { ...env, outputContract: undefined, workflowPath: [...env.workflowPath, node.id], pathLabels: [...env.pathLabels, `${node.label || node.type} (item ${i + 1})`], iterations: [...env.iterations, { nodeId: node.id, label: node.label || node.type, workflowPath: [...env.workflowPath], index: i, item: previewValue(source[i]) }] };
      const childResult = await executeWorkflow(child, childCtx, childEnv, depth + 1);
      results.push(childResult.output);
      Object.assign(step.listCounts, { output: results.length, processed: i + 1 });
      notifyTrace(env);
    }
    if (cfg.collectAs?.trim()) setVar(ctx, cfg.collectAs, results);
    Object.assign(step, { detail: `${results.length} result(s)`, results: previewValue(results), output: previewValue(results) });
    return { port: 'done' };
  }

  if (node.type === 'subflow') {
    const child = cfg.workflow;
    if (!child?.nodes?.length) throw new Error(`Subflow “${node.label || node.id}” is empty.`);
    const childInput = cfg.input === undefined ? ctx.input : resolve(cfg.input, 'Subflow input');
    recordListCount(step, 'input', childInput);
    step.input = previewValue(childInput);
    const childCtx = { input: clone(childInput), vars: { ...ctx.vars }, decisions: {}, locals: { ...ctx.locals } };
    const childEnv = { ...env, outputContract: undefined, workflowPath: [...env.workflowPath, node.id], pathLabels: [...env.pathLabels, node.label || node.type] };
    const childResult = await executeWorkflow(child, childCtx, childEnv, depth + 1);
    recordListCount(step, 'output', childResult.output);
    if (cfg.resultAs?.trim()) setVar(ctx, cfg.resultAs, childResult.output);
    Object.assign(step, { detail: 'completed', output: previewValue(childResult.output) });
    return { port: 'done' };
  }

  if (node.type === 'output') {
    const outputScope = scopeFor(ctx);
    const template = cfg.value || (cfg.format === 'json' ? 'null' : '{{input}}');
    resolve(template, 'Output');
    const value = cfg.format === 'json'
      ? renderJsonTemplate(cfg.value || 'null', outputScope)
      : renderTemplate(cfg.value || '{{input}}', outputScope);
    recordListCount(step, 'input', value);
    recordListCount(step, 'output', value);
    Object.assign(step, { detail: 'output', output: previewValue(value) });
    if (value === undefined) step.warnings.push('Output resolved to undefined. Check its variable references.');
    return { terminal: true, output: value };
  }

  throw new Error(`Unknown node type: ${node.type}`);
}

export async function executeWorkflow(workflow, contextOrInput, options = {}, depth = 0) {
  if (!workflow?.nodes?.length) throw new Error('Workflow is empty.');
  const ctx = contextOrInput && Object.prototype.hasOwnProperty.call(contextOrInput, 'input') && Object.prototype.hasOwnProperty.call(contextOrInput, 'vars')
    ? contextOrInput
    : { input: clone(contextOrInput), vars: {}, decisions: {}, locals: {} };
  ctx.vars ||= {};
  ctx.decisions ||= {};
  ctx.locals ||= {};
  const env = options.trace
    ? options
    : { ...options, trace: [], predict: options.predict || defaultPredict };
  env.predict ||= defaultPredict;
  env.stats ||= { seen: env.trace.length, omitted: 0 };
  env.workflowPath ||= [];
  env.pathLabels ||= [workflow.name || 'Workflow'];
  env.iterations ||= [];
  env.files ||= [];

  let node = startNode(workflow);
  if (!node) throw new Error('Workflow has no starting node.');
  let steps = 0;
  while (node) {
    const step = {
      sequence: ++env.stats.seen, nodeId: node.id, label: node.label || node.type, type: node.type, depth,
      workflowPath: [...env.workflowPath], location: [...env.pathLabels, node.label || node.type].join(' → '), iterations: [...env.iterations],
      status: 'running', references: [], warnings: [], config: previewValue(node.config || {}),
      scope: { input: previewValue(ctx.input), variables: previewValue(ctx.vars), locals: previewValue(ctx.locals), decisions: previewValue(ctx.decisions) },
      startedAt: new Date().toISOString(),
    };
    env.trace.push(step);
    if (env.trace.length > MAX_TRACE_STEPS) { env.trace.shift(); env.stats.omitted++; }
    notifyTrace(env);
    const started = now();
    try {
      if (++steps > MAX_STEPS) throw new Error(`Workflow exceeded ${MAX_STEPS} steps. Check for a cycle.`);
      const result = await runNode(node, workflow, ctx, env, depth, step);
      step.port = result.port;
      step.after = { variables: previewValue(ctx.vars), decisions: previewValue(ctx.decisions) };
      step.status = step.warnings.length ? 'warning' : 'success';
      if (result.terminal) {
        if (env.outputContract === 'boolean' && typeof result.output !== 'boolean') throw new Error(`Filter body must return true or false, got ${valueType(result.output)}. Use JSON format for a literal boolean.`);
        if (env.outputContract === 'value' && result.output === undefined) throw new Error('Map body must return a value. Check the Output references or return an explicit null.');
        if (env.outputContract === 'row' && (!ctx.locals.item || typeof ctx.locals.item !== 'object' || Array.isArray(ctx.locals.item) || !result.output || typeof result.output !== 'object' || Array.isArray(result.output))) throw new Error('Keep original fields requires both the item and mapped output to be objects. Return an object of new column values.');
        return { output: result.output, context: ctx, trace: env.trace, traceOmitted: env.stats.omitted, files: env.files };
      }
      const edge = edgeFor(workflow, node.id, result.port, node.type === 'switch');
      if (!edge) {
        if (env.outputContract) throw new Error(`The per-item workflow stopped at unconnected output “${result.port}”. Connect this branch to an Output node.`);
        step.status = 'warning';
        step.warnings.push(`No connection from output “${result.port}”. The run stopped here without an Output node.`);
        return { output: undefined, context: ctx, trace: env.trace, traceOmitted: env.stats.omitted, files: env.files };
      }
      step.edgeId = edge.id;
      const next = workflow.nodes.find(n => n.id === edge.to);
      if (!next) throw new Error(`Connection points to missing node “${edge.to}”.`);
      step.nextNode = { id: next.id, label: next.label || next.type };
      node = next;
    } catch (cause) {
      step.status = 'error';
      step.error = cause.message || String(cause);
      step.detail = 'Failed';
      throw cause instanceof WorkflowExecutionError ? cause : new WorkflowExecutionError(cause, step, env);
    } finally {
      step.durationMs = Math.round((now() - started) * 100) / 100;
      notifyTrace(env);
    }
  }
  return { output: undefined, context: ctx, trace: env.trace, traceOmitted: env.stats.omitted, files: env.files };
}

export async function defaultPredict(payload) {
  const response = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Prediction failed (${response.status}).`);
    error.response = data;
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}
