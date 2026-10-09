// Nodes run once per workflow invocation. Conditional ports select paths;
// multiple connections on a selected port activate all their targets.
export function edgesFor(workflow, nodeId, port, exactOnly = false) {
  const outgoing = (workflow.edges || []).filter(e => e.from === nodeId);
  const exact = outgoing.filter(e => e.fromPort === port);
  return exact.length || exactOnly ? exact : outgoing.filter(e => !e.fromPort || e.fromPort === 'next');
}

export function executionGraph(workflow, start) {
  const nodes = new Map(workflow.nodes.map(n => [n.id, n]));
  const outgoing = new Map(workflow.nodes.map(n => [n.id, ['output', 'csv-output'].includes(n.type) ? [] : workflow.edges.filter(e => e.from === n.id)]));
  const reachable = new Set();
  const pending = [start.id];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id) || !nodes.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id)) pending.push(edge.to);
  }
  const parents = new Map([...reachable].map(id => [id, new Set()]));
  for (const id of reachable) for (const edge of outgoing.get(id)) if (reachable.has(edge.to)) parents.get(edge.to).add(id);
  const remaining = new Map([...parents].map(([id, incoming]) => [id, incoming.size]));
  const ready = [...remaining].filter(([, count]) => !count).map(([id]) => id);
  const sorted = [];
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]; sorted.push(id);
    for (const target of new Set(outgoing.get(id).map(e => e.to))) if (remaining.has(target)) {
      remaining.set(target, remaining.get(target) - 1);
      if (!remaining.get(target)) ready.push(target);
    }
  }
  let cycle = [...reachable].find(id => remaining.get(id) > 0);
  if (cycle) {
    // A blocked downstream node is not necessarily part of the cycle. Follow
    // blocked parents until we revisit an actual cycle member.
    const seen = new Set();
    while (!seen.has(cycle)) {
      seen.add(cycle);
      cycle = [...parents.get(cycle)].find(id => remaining.get(id) > 0);
    }
  }
  return { nodes, outgoing, parents, order: sorted, cycle };
}

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const prefix = (a, b) => a.length <= b.length && a.every((key, i) => key === b[i]);
const own = (object, key) => object != null && Object.hasOwn(object, key);
const define = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

export function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!plain(a) || !plain(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && sameValue(a[k], b[k]));
}

function changes(before, after, path, patches) {
  if (Object.is(before, after)) return;
  if (plain(after) && (before === undefined || plain(before)) && Object.keys(after).length) {
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
      if (!own(after, key)) patches.push({ path: [...path, key], deleted: true });
      else changes(own(before, key) ? before[key] : undefined, after[key], [...path, key], patches);
    }
  } else if (!sameValue(before, after)) patches.push({ path, value: after });
}

export function forkContext(ctx) {
  // Runtime writes already copy their nested path. Large read-only row lists
  // need not be cloned for every node or sibling branch.
  return { ...ctx, vars: { ...ctx.vars }, decisions: { ...ctx.decisions }, locals: { ...ctx.locals } };
}

export function advanceState(incoming, ctx, node, sequence) {
  const patches = [];
  changes(incoming.context.vars, ctx.vars, ['vars'], patches);
  changes(incoming.context.decisions, ctx.decisions, ['decisions'], patches);
  const events = [...incoming.events];
  for (const patch of patches) {
    // A later assignment replaces prior writes to that path or its children.
    for (let i = events.length - 1; i >= 0; i--) if (prefix(patch.path, events[i].path)) events.splice(i, 1);
    events.push({ ...patch, nodeId: node.id, label: node.label || node.id, sequence, ancestors: incoming.ancestors });
  }
  return { context: ctx, events, ancestors: new Set([...incoming.ancestors, node.id]) };
}

function apply(ctx, event) {
  let object = ctx;
  for (const key of event.path.slice(0, -1)) {
    const previous = own(object, key) ? object[key] : undefined;
    const next = plain(previous) ? { ...previous } : {};
    define(object, key, next); object = next;
  }
  const key = event.path.at(-1);
  if (event.deleted) delete object[key]; else define(object, key, event.value);
}

export function mergeStates(states, initial) {
  if (states.length === 1) return states[0];
  const ancestors = new Set(states.flatMap(state => [...state.ancestors]));
  const unique = new Map();
  for (const state of states) for (const event of state.events) unique.set(JSON.stringify([event.nodeId, event.path]), event);
  const events = [...unique.values()].filter(event => ![...unique.values()].some(other => other !== event && other.ancestors.has(event.nodeId) && prefix(other.path, event.path)));
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if ((!prefix(a.path, b.path) && !prefix(b.path, a.path)) || a.nodeId === b.nodeId || a.ancestors.has(b.nodeId) || b.ancestors.has(a.nodeId)) continue;
    if (a.path.length === b.path.length && a.deleted === b.deleted && sameValue(a.value, b.value)) continue;
    const path = (a.path.length < b.path.length ? a.path : b.path).map(key => /^[A-Za-z_$][\w$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`).join('.');
    const error = new Error(`Branches “${a.label}” and “${b.label}” write conflicting values to ${path}. Use separate result names or connect these steps in sequence.`);
    error.mergeConflict = { path, nodes: [a.nodeId, b.nodeId], labels: [a.label, b.label] };
    throw error;
  }
  const context = forkContext(initial.context);
  for (const event of events.sort((a, b) => a.sequence - b.sequence)) apply(context, event);
  return { context, events, ancestors };
}
