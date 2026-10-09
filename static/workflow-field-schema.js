import { getPath } from './workflow-runtime.js';
import { parseCSV } from './workflow-csv.js';
import { edgesFor } from './workflow-execution-graph.js';

const unknown = () => ({ type: 'unknown', props: new Map(), origin: 'Configured' });
const object = (props = []) => ({ type: 'object', props: new Map(props), origin: 'Configured' });
const array = item => ({ type: 'array', props: new Map(), item, origin: 'Configured' });
const scalar = type => ({ type, props: new Map(), origin: 'Configured' });
const pathPart = key => /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
const reference = value => typeof value === 'string' ? value.match(/^\s*{{\s*([^{}]+?)\s*}}\s*$/)?.[1] : null;
const cloneScope = scope => ({ ...scope, vars: new Map(scope.vars), decisions: new Map(scope.decisions), locals: new Map(scope.locals) });

function merge(shapes, simultaneous = false) {
  const present = shapes.filter(Boolean);
  if (!present.length) return unknown();
  const first = present[0];
  const type = present.every(s => s.type === first.type) ? first.type : 'unknown';
  const result = { type, props: new Map(), origin: first.origin, conditional: shapes.some(s => s?.conditional || (!simultaneous && !s)) };
  if (present.every(s => s.hasValue && JSON.stringify(s.value) === JSON.stringify(first.value))) Object.assign(result, { hasValue: true, value: first.value });
  for (const key of new Set(present.flatMap(s => [...s.props.keys()]))) result.props.set(key, merge(shapes.map(s => s?.props.get(key)), simultaneous));
  if (type === 'array') result.item = merge(present.map(s => s.item), simultaneous);
  return result;
}

export function shapeFromValue(value, origin = 'Input sample', depth = 0) {
  if (depth > 5 || value === undefined) return unknown();
  const captured = origin === 'Last run';
  if (captured && typeof value === 'string' && (/^\[(undefined|deeper values omitted|preview limit reached|circular reference)\]$/.test(value) || /… \[\d+ characters omitted\]$/.test(value))) return { ...unknown(), origin: 'Last run · sample truncated' };
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const shape = { type, props: new Map(), hasValue: true, value, origin };
  if (type === 'object') for (const key of Object.keys(value).filter(k => !captured || k !== '[preview]').slice(0, 100)) shape.props.set(key, shapeFromValue(value[key], origin, depth + 1));
  if (type === 'array') {
    // Union sample row shapes; optional columns are labelled conditional.
    const omitted = captured && typeof value.at(-1) === 'string' ? value.at(-1).match(/^\[(\d+) more items omitted\]$/) : null;
    const samples = value.slice(0, omitted ? -1 : 12).slice(0, 12).map(v => shapeFromValue(v, origin, depth + 1));
    shape.item = value.length ? merge(samples) : unknown();
    // Offered indices are concrete [0] references: samples must be from row 1.
    const firstValues = (union, first) => {
      if (first?.hasValue) Object.assign(union, { hasValue: true, value: first.value });
      else { delete union.hasValue; delete union.value; }
      for (const [key, child] of union.props) firstValues(child, first?.props.get(key));
      if (union.item) firstValues(union.item, first?.item);
    };
    if (samples.length) firstValues(shape.item, samples[0]);
    shape.props.set('length', shapeFromValue(omitted ? value.length - 1 + Number(omitted[1]) : value.length, origin, depth + 1));
  }
  return shape;
}

function scopeShape(scope) {
  const roots = new Map([['input', scope.input], ['vars', object(scope.vars)], ['decisions', object(scope.decisions)], ...scope.vars, ...scope.locals]);
  return object(roots);
}
function lookup(scope, path) {
  // Use the runtime path parser, including quoted CSV header names.
  const marker = Symbol('shape');
  const wrap = shape => {
    const value = Object.fromEntries([...shape.props].map(([key, child]) => [key, wrap(child)]));
    if (shape.type === 'array' && shape.item) Object.defineProperty(value, '0', { value: wrap(shape.item), enumerable: true });
    Object.defineProperty(value, marker, { value: shape });
    return value;
  };
  const root = scopeShape(scope);
  const result = getPath(wrap(root), path);
  return result?.[marker] || unknown();
}
function templateShape(value, scope, json = false) {
  const ref = reference(value);
  if (ref) return lookup(scope, ref);
  if (typeof value !== 'string') return shapeFromValue(value, 'Configured literal');
  if (!json) return value.includes('{{') ? scalar('string') : shapeFromValue(value, 'Configured literal');
  let prefix = '__wf_ref_'; while (value.includes(prefix)) prefix += '_';
  const refs = new Map();
  try {
    const text = value.replace(/{{\s*([^{}]+?)\s*}}/g, (_, path) => { const key = `${prefix}${refs.size}`; refs.set(key, lookup(scope, path)); return JSON.stringify(key); });
    const visit = v => {
      if (typeof v === 'string' && refs.has(v)) return refs.get(v);
      if (Array.isArray(v)) return array(merge(v.map(visit)));
      if (v && typeof v === 'object') return object(Object.entries(v).map(([key, val]) => [key, visit(val)]));
      return shapeFromValue(v, 'Configured literal');
    };
    return visit(JSON.parse(text));
  } catch { return unknown(); }
}
function columnShape(columns, scope) {
  return object((Array.isArray(columns) ? columns : []).filter(c => c?.name?.trim()).map(c => {
    const source = templateShape(c.value === undefined ? '' : c.value, scope);
    const type = ['trim','lower','upper'].includes(c.transform) ? 'string' : ['number','round'].includes(c.transform) ? 'number' : c.transform === 'boolean' ? 'boolean' : source.type;
    return [c.name.trim(), { ...scalar(type), conditional: source.conditional }];
  }));
}
function setVariable(scope, path, shape) {
  const parts = String(path || '').trim().replace(/^vars\./, '').split('.').filter(Boolean);
  if (!parts.length) return;
  function put(previous, i) { const result = { ...(previous || object()), props: new Map(previous?.props) }; result.props.set(parts[i], i === parts.length - 1 ? shape : put(result.props.get(parts[i]), i + 1)); return result; }
  if (parts.length === 1) scope.vars.set(parts[0], shape);
  else scope.vars.set(parts[0], put(scope.vars.get(parts[0]), 1));
}
function joinScopes(scopes) {
  const first = scopes[0]; if (!first) return null;
  const result = cloneScope(first);
  const signatures = scopes.map(s => JSON.stringify([...(s.guards || [])].sort()));
  const simultaneous = signatures.every(s => s === signatures[0]);
  result.guards = new Set(scopes.flatMap(s => [...(s.guards || [])]));
  for (const kind of ['vars','decisions','locals']) {
    result[kind] = new Map();
    for (const key of new Set(scopes.flatMap(s => [...s[kind].keys()]))) result[kind].set(key, merge(scopes.map(s => s[kind].get(key)), simultaneous));
  }
  result.input = merge(scopes.map(s => s.input));
  return result;
}

function childScope(owner, incoming) {
  const cfg = owner.config || {}, child = cloneScope(incoming);
  if (owner.type === 'subflow') { child.input = cfg.input === undefined ? incoming.input : templateShape(cfg.input, incoming); child.decisions = new Map(); }
  else if (owner.type === 'foreach') {
    child.decisions = new Map();
    child.locals.set(cfg.itemVar || 'item', templateShape(cfg.source || '{{input}}', incoming).item || unknown());
    child.locals.set(cfg.indexVar || 'index', scalar('number'));
  } else {
    child.input = templateShape(cfg.source || '{{input.items}}', incoming).item || unknown();
    child.locals.set('parentInput', incoming.input); child.locals.set('item', child.input); child.locals.set('index', scalar('number'));
  }
  return child;
}

function analyzer(workflow, base, depth = 0) {
  const nodes = new Map((workflow.nodes || []).map(n => [n.id, n]));
  const start = (workflow.nodes || []).find(n => n.type === 'input') || (workflow.nodes || []).find(n => !(workflow.edges || []).some(e => e.to === n.id));
  const edges = (workflow.edges || []).filter(e => nodes.has(e.from) && nodes.has(e.to) && !['output','csv-output'].includes(nodes.get(e.from).type));
  const reachable = new Set();
  function walk(id) { if (reachable.has(id)) return; reachable.add(id); edges.filter(e => e.from === id).forEach(e => walk(e.to)); }
  if (start) walk(start.id);
  const memo = new Map();
  function before(id, visiting = new Set()) {
    if (id === start?.id) return base;
    if (!reachable.has(id) || visiting.has(id) || visiting.size > 100) return null;
    if (memo.has(id)) return memo.get(id);
    const next = new Set([...visiting, id]);
    const predecessors = [...new Set(edges.filter(e => e.to === id).map(e => e.from))];
    const scopes = predecessors.map(from => {
      const incoming = before(from, next); if (!incoming) return null;
      const node = nodes.get(from), scope = after(node, incoming), cfg = node.config || {};
      const ports = node.type === 'condition' ? ['true','false'] : node.type === 'decision' ? cfg.decisionType === 'noul' ? ['true','false'] : (cfg.options || []).map(o => o.key).filter(Boolean) : node.type === 'switch' ? [...(cfg.cases || []).map(c => c.key), 'default'] : [];
      if (ports.length) {
        const active = ports.filter(port => edgesFor(workflow, from, port, node.type === 'switch').some(e => e.to === id));
        if (active.length !== ports.length) scope.guards = new Set([...(scope.guards || []), JSON.stringify([from, active.sort()])]);
      }
      return scope;
    }).filter(Boolean);
    const scope = joinScopes(scopes); memo.set(id, scope); return scope;
  }
  function bodyResult(node, scope) {
    if (depth >= 8 || !node.config?.workflow?.nodes?.length) return unknown();
    return analyzer(node.config.workflow, childScope(node, scope), depth + 1).output();
  }
  function valueOutput(node, scope) {
    const cfg = node.config || {};
    const value = node.type === 'map' ? cfg.value ?? '{{item}}' : cfg.value || (cfg.format === 'json' ? 'null' : '{{input}}');
    if (node.type === 'csv-output') return templateShape(cfg.source ?? '{{rows}}', scope);
    return cfg.format === 'fields' ? columnShape(cfg.columns, scope) : templateShape(value, scope, cfg.format === 'json');
  }
  function after(node, incoming) {
    const scope = cloneScope(incoming), cfg = node.config || {};
    if (node.type === 'csv') {
      let rows = array(unknown()), metadata = object([['columns', array(scalar('string'))], ['rowCount', scalar('number')], ['columnCount', scalar('number')], ['filename', scalar('string')], ['delimiter', scalar('string')]]);
      try {
        const content = cfg.mode === 'template' ? templateShape(cfg.source, scope).value : cfg.content;
        if (typeof content === 'string' && content) {
          const parsed = parseCSV(content, { delimiter: cfg.delimiter ?? 'auto' });
          rows = array(object(parsed.columns.map(name => [name, scalar('string')])));
          Object.assign(rows, { hasValue: true, value: parsed.rows.slice(0, 5), origin: 'CSV preview · first 5 rows' });
          rows.props.set('length', shapeFromValue(parsed.rows.length, 'CSV preview'));
          if (parsed.rows.length) rows.item = shapeFromValue(parsed.rows[0], 'CSV preview · row 1');
          metadata = shapeFromValue({ columns: parsed.columns, rowCount: parsed.rows.length, columnCount: parsed.columns.length, filename: cfg.filename || 'input.csv', delimiter: parsed.delimiter }, 'CSV preview');
        }
      } catch { /* Malformed CSV stays unknown; execution owns validation. */ }
      if (cfg.resultAs?.trim()) { setVariable(scope, cfg.resultAs, rows); setVariable(scope, `${cfg.resultAs.trim()}Csv`, metadata); }
    }
    if (node.type === 'decision') {
      const key = (cfg.key || node.id).replace(/[^a-zA-Z0-9_]/g, '_');
      const shape = object([['choice', scalar('string')], ['confidence', scalar('number | null')]]);
      const options = cfg.decisionType === 'noul' ? ['true','false'] : (cfg.options || []).map(o => o.key?.trim()).filter(Boolean);
      shape.props.set('probabilities', object(options.map(k => [k, scalar('number')])));
      if (cfg.decisionType === 'noul') { shape.props.get('probabilities').conditional = true; const noul = scalar('number'); noul.conditional = true; shape.props.set('noul', noul); }
      scope.decisions.set(key, shape);
      setVariable(scope, cfg.resultAs, scalar('string'));
    }
    if (node.type === 'set') for (const a of cfg.assignments || []) {
      let shape = templateShape(a.value, scope);
      // Set coerces rendered strings to primitive/JSON values at runtime.
      if (shape.hasValue && typeof shape.value === 'string') {
        const text = shape.value.trim();
        if (text === 'undefined') shape = unknown();
        else if (text !== '' && Number.isFinite(Number(text))) shape = shapeFromValue(Number(text), shape.origin);
        else { try { shape = shapeFromValue(JSON.parse(text), shape.origin); } catch { /* Text stays text. */ } }
      }
      setVariable(scope, a.path, shape);
    }
    if (node.type === 'map' || node.type === 'filter') {
      const source = templateShape(cfg.source || '{{input.items}}', scope);
      let item = source.item || unknown();
      if (node.type === 'map') {
        item = cfg.mode === 'workflow' ? bodyResult(node, scope) : valueOutput(node, childScope(node, scope));
        if (cfg.keepOriginal && item.type === 'object' && source.item?.type === 'object') item = object([...source.item.props, ...item.props]);
      }
      setVariable(scope, cfg.resultAs, array(item));
    }
    if (node.type === 'foreach') setVariable(scope, cfg.collectAs, array(bodyResult(node, scope)));
    if (node.type === 'subflow') setVariable(scope, cfg.resultAs, bodyResult(node, scope));
    if (node.type === 'groupby') {
      const source = templateShape(cfg.source, scope);
      setVariable(scope, cfg.resultAs, cfg.outputFormat === 'keyed' ? object() : array(object([['key', unknown()], ['items', source], ['count', scalar('number')]])));
    }
    return scope;
  }
  return { before, output: () => {
    const terminals = (workflow.nodes || []).filter(n => ['output','csv-output'].includes(n.type) && reachable.has(n.id)).map(n => ({ node: n, scope: before(n.id) })).filter(t => t.scope);
    const shapes = terminals.map(t => valueOutput(t.node, t.scope));
    const simultaneous = terminals.length > 1 && terminals.every(t => JSON.stringify([...(t.scope.guards || [])].sort()) === JSON.stringify([...(terminals[0].scope.guards || [])].sort()));
    const exclusive = (a, b) => [...(a.guards || [])].some(guard => {
      const [source, ports] = JSON.parse(guard);
      return [...(b.guards || [])].some(other => {
        const [otherSource, otherPorts] = JSON.parse(other);
        return source === otherSource && !ports.some(port => otherPorts.includes(port));
      });
    });
    const alternatives = terminals.every((t, i) => terminals.slice(i + 1).every(other => exclusive(t.scope, other.scope)));
    // Mixed optional and simultaneous terminals can return a scalar or a list.
    // Leave that dynamic shape unknown until a run provides a real sample.
    return simultaneous ? array(merge(shapes)) : alternatives ? merge(shapes) : unknown();
  } };
}

export function configuredScope(workflow, path, nodeId, input, perItem = false) {
  let scope = { input: shapeFromValue(input), vars: new Map(), decisions: new Map(), locals: new Map() }, wf = workflow;
  for (const ownerId of path) {
    const owner = wf.nodes?.find(n => n.id === ownerId); if (!owner?.config?.workflow) return null;
    const incoming = analyzer(wf, scope).before(ownerId); if (!incoming) return null;
    scope = childScope(owner, incoming); wf = owner.config.workflow;
  }
  scope = analyzer(wf, scope).before(nodeId); if (!scope) return null;
  if (perItem) { const node = wf.nodes.find(n => n.id === nodeId); scope = childScope(node, scope); }
  return scope;
}

export function fieldCatalog({ workflow, path = [], nodeId, input, perItem = false, observed }) {
  const scope = configuredScope(workflow, path, nodeId, input, perItem);
  if (!scope) return [];
  const root = scopeShape(scope), fields = new Map();
  function visit(shape, path, inheritedConditional = false, depth = 0) {
    if (depth > 5 || fields.size >= 300) return;
    if (path) fields.set(path, { path, type: shape.type, origin: shape.origin, conditional: inheritedConditional || !!shape.conditional, hasSample: !!shape.hasValue, sample: shape.value });
    const entries = [...shape.props];
    if (!path) {
      const rank = key => key === 'parentInput' ? 6 : scope.locals.has(key) ? (key === 'index' ? 1 : 0) : key === 'decisions' ? 2 : key === 'input' ? 3 : key === 'vars' ? 8 : 4;
      entries.sort(([a], [b]) => rank(a) - rank(b));
    }
    for (const [key, child] of entries) visit(child, path ? path + pathPart(key) : key, inheritedConditional || !!shape.conditional, depth + 1);
    // Index 0 is a concrete reference; don't invent wildcard expressions.
    if (shape.type === 'array' && shape.item) visit(shape.item, `${path}[0]`, inheritedConditional, depth + 1);
  }
  visit(root, '');
  if (observed?.scope) {
    const s = observed.scope;
    const actual = { input: s.input, vars: s.variables || {}, decisions: s.decisions || {}, ...s.variables, ...s.locals };
    const captured = new Map();
    const previous = new Map(fields);
    fields.clear(); visit(shapeFromValue(actual, 'Last run'), '');
    for (const [path, field] of fields) captured.set(path, field);
    fields.clear();
    for (const [path, field] of previous) fields.set(path, !observed.edited && !captured.has(path) ? { ...field, hasSample: false, sample: undefined, observed: true, origin: 'Last run · field not captured', item: observed.item } : field);
    for (const [path, field] of captured) {
      if (observed.edited) {
        // Dynamic descendants are useful, but removed roots belong to an old graph.
        const prefix = path.match(/^(vars|decisions)\.[^.[\]]+|^[^.[\]]+/)?.[0];
        if (!previous.has(prefix) && !['vars', 'decisions'].includes(path)) continue;
      }
      fields.set(path, { ...fields.get(path), ...field, conditional: fields.get(path)?.conditional || field.conditional, observed: true, edited: !!observed.edited, item: observed.item });
    }
  }
  return [...fields.values()].filter(f => !['vars','decisions'].includes(f.path) && !(f.path.startsWith('vars.') && fields.has(f.path.slice(5))));
}
