const MAX_STEPS = 500;

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function getPath(scope, path) {
  if (path == null || path === '') return undefined;
  if (typeof path !== 'string') return path;
  const clean = path.trim().replace(/^\$\.?/, '');
  if (!clean) return scope;
  const parts = clean
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
    .split('.')
    .filter(Boolean);
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
  let cur = ctx.vars;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[parts.at(-1)] = value;
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

function edgeFor(workflow, nodeId, port) {
  const exact = workflow.edges.find(e => e.from === nodeId && e.fromPort === port);
  if (exact) return exact;
  return workflow.edges.find(e => e.from === nodeId && (!e.fromPort || e.fromPort === 'next')) || null;
}

function startNode(workflow) {
  return workflow.nodes.find(n => n.type === 'input') || workflow.nodes.find(n => !workflow.edges.some(e => e.to === n.id));
}

function decisionQuestion(node, scope) {
  const cfg = node.config || {};
  const key = (cfg.key || node.id).replace(/[^a-zA-Z0-9_]/g, '_');
  if (cfg.decisionType === 'noul') {
    const criteria = {};
    if (cfg.trueCriterion?.trim()) criteria.true = renderTemplate(cfg.trueCriterion, scope);
    if (cfg.falseCriterion?.trim()) criteria.false = renderTemplate(cfg.falseCriterion, scope);
    return {
      key,
      question: {
        type: 'noul',
        instructions: renderTemplate(cfg.question || 'Is this true?', scope),
        ...(Object.keys(criteria).length ? { criteria } : {}),
      },
    };
  }
  const criteria = {};
  for (const option of cfg.options || []) {
    const optionKey = String(option.key || '').trim();
    if (!optionKey) continue;
    criteria[optionKey] = renderTemplate(option.description || option.label || optionKey, scope);
  }
  if (Object.keys(criteria).length < 2) throw new Error(`Decision “${node.label || node.id}” needs at least two options.`);
  return {
    key,
    question: {
      type: 'choice',
      instructions: renderTemplate(cfg.question || 'Which option best fits?', scope),
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

async function runNode(node, workflow, ctx, env, depth) {
  const scope = scopeFor(ctx);
  const cfg = node.config || {};
  const traceBase = { nodeId: node.id, label: node.label || node.type, type: node.type, depth };

  if (node.type === 'input') {
    env.trace.push({ ...traceBase, detail: 'input' });
    return { port: 'next' };
  }

  if (node.type === 'decision') {
    const state = renderTemplate(cfg.state || '{{input}}', scope);
    const { key, question } = decisionQuestion(node, scope);
    const request = {
      state,
      questions: { [key]: question },
      ...(env.model ? { model: env.model } : {}),
      ...(env.lang ? { lang: env.lang } : {}),
    };
    const result = await env.predict(request);
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
    env.trace.push({ ...traceBase, detail: selected, state, question, answer: stored, request });
    return { port: selected };
  }

  if (node.type === 'condition') {
    const tests = cfg.conditions?.length ? cfg.conditions : [{ left: '', op: 'exists', right: '' }];
    const values = tests.map(c => evalCondition(c, scope));
    const passed = (cfg.mode || 'all') === 'any' ? values.some(Boolean) : values.every(Boolean);
    env.trace.push({ ...traceBase, detail: passed ? 'true' : 'false', tests: values });
    return { port: passed ? 'true' : 'false' };
  }

  if (node.type === 'set') {
    for (const assignment of cfg.assignments || []) {
      if (!assignment.path?.trim()) continue;
      const rendered = renderTemplate(assignment.value ?? '', scope);
      setVar(ctx, assignment.path, typeof rendered === 'string' ? primitive(rendered) : clone(rendered));
    }
    env.trace.push({ ...traceBase, detail: `${(cfg.assignments || []).length} assignment(s)` });
    return { port: 'next' };
  }

  if (node.type === 'foreach') {
    const source = renderTemplate(cfg.source || '{{input}}', scope);
    if (!Array.isArray(source)) throw new Error(`For Each “${node.label || node.id}” expected an array, got ${source === null ? 'null' : typeof source}.`);
    const child = cfg.workflow;
    if (!child?.nodes?.length) throw new Error(`For Each “${node.label || node.id}” has no loop body.`);
    const results = [];
    env.trace.push({ ...traceBase, detail: `${source.length} item(s)`, phase: 'start' });
    for (let i = 0; i < source.length; i++) {
      const childCtx = {
        input: ctx.input,
        vars: clone(ctx.vars),
        decisions: {},
        locals: { ...ctx.locals, [cfg.itemVar || 'item']: source[i], [cfg.indexVar || 'index']: i },
      };
      const childResult = await executeWorkflow(child, childCtx, env, depth + 1);
      results.push(childResult.output);
    }
    if (cfg.collectAs?.trim()) setVar(ctx, cfg.collectAs, results);
    env.trace.push({ ...traceBase, detail: `${results.length} result(s)`, phase: 'end', results: clone(results) });
    return { port: 'done' };
  }

  if (node.type === 'subflow') {
    const child = cfg.workflow;
    if (!child?.nodes?.length) throw new Error(`Subflow “${node.label || node.id}” is empty.`);
    const childCtx = { input: ctx.input, vars: clone(ctx.vars), decisions: {}, locals: { ...ctx.locals } };
    const childResult = await executeWorkflow(child, childCtx, env, depth + 1);
    if (cfg.resultAs?.trim()) setVar(ctx, cfg.resultAs, childResult.output);
    env.trace.push({ ...traceBase, detail: 'completed', output: clone(childResult.output) });
    return { port: 'done' };
  }

  if (node.type === 'output') {
    const outputScope = scopeFor(ctx);
    const value = cfg.format === 'json'
      ? renderJsonTemplate(cfg.value || 'null', outputScope)
      : renderTemplate(cfg.value || '{{input}}', outputScope);
    env.trace.push({ ...traceBase, detail: 'output', output: clone(value) });
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

  let node = startNode(workflow);
  if (!node) throw new Error('Workflow has no starting node.');
  let steps = 0;
  while (node) {
    if (++steps > MAX_STEPS) throw new Error(`Workflow exceeded ${MAX_STEPS} steps. Check for a cycle.`);
    const result = await runNode(node, workflow, ctx, env, depth);
    if (result.terminal) return { output: result.output, context: ctx, trace: env.trace };
    const edge = edgeFor(workflow, node.id, result.port);
    if (!edge) return { output: undefined, context: ctx, trace: env.trace };
    node = workflow.nodes.find(n => n.id === edge.to);
    if (!node) throw new Error(`Edge from ${edge.from} points to missing node ${edge.to}.`);
  }
  return { output: undefined, context: ctx, trace: env.trace };
}

export async function defaultPredict(payload) {
  const response = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Prediction failed (${response.status}).`);
  return data;
}
