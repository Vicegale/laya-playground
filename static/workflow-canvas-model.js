// Display layout is separate from authored positions and workflow identity.
export const nodeKey = (path, id) => JSON.stringify([...path, id]);
export const hasBody = node => !!node.config?.workflow && (['foreach', 'subflow'].includes(node.type) || (['map', 'filter'].includes(node.type) && node.config.mode === 'workflow'));
export const isCollection = node => ['foreach', 'map', 'filter'].includes(node.type);

export function canvasLayout(workflow, basePath = [], expansion = new Map()) {
  let remaining = 240;
  function plan(wf, path, preview, depth) {
    const entries = [];
    for (const node of wf.nodes || []) {
      if (--remaining < 0) break;
      const key = nodeKey(path, node.id);
      const expanded = hasBody(node) && depth < 8 && (expansion.get(key) ?? !preview);
      const child = expanded ? plan(node.config.workflow, [...path, node.id], true, depth + 1) : null;
      const ports = node.type === 'switch' ? (Array.isArray(node.config?.cases) ? node.config.cases.length : 0) + 1 : node.type === 'decision' ? (node.config.options?.length || 2) : 2;
      entries.push({ key, cellId: preview ? `nested:${key}` : node.id, node, path, preview, expanded, child,
        width: child ? Math.max(288, child.width + 32) : 244,
        height: child ? 204 + child.height + 20 : Math.max(hasBody(node) ? 200 : isCollection(node) ? 188 : node.type === 'csv-output' ? 174 : node.type === 'groupby' ? 204 : 148, 30 + ports * 18) });
    }
    if (preview) {
      // Vertical layers make expanded bodies readable alongside their caller.
      const ranks = new Map(entries.map(e => [e.node.id, 0]));
      for (let pass = 0; pass < entries.length; pass++) {
        let changed = false;
        for (const edge of wf.edges || []) {
          if (!ranks.has(edge.from) || !ranks.has(edge.to) || edge.from === edge.to) continue;
          const rank = Math.min(entries.length - 1, ranks.get(edge.from) + 1);
          if (rank > ranks.get(edge.to)) { ranks.set(edge.to, rank); changed = true; }
        }
        if (!changed) break;
      }
      const layers = new Map();
      entries.forEach(e => { const rank = ranks.get(e.node.id); if (!layers.has(rank)) layers.set(rank, []); layers.get(rank).push(e); });
      let y = 0;
      for (const [, row] of [...layers].sort((a,b) => a[0] - b[0])) {
        let x = 0;
        for (const e of row) { e.x = x; e.y = y; x += e.width + 28; }
        y += Math.max(...row.map(e => e.height)) + 28;
      }
    } else {
      const placed = [];
      for (const e of [...entries].sort((a,b) => (a.node.position?.x || 0) - (b.node.position?.x || 0) || (a.node.position?.y || 0) - (b.node.position?.y || 0))) {
        e.x = e.node.position?.x ?? 80; e.y = e.node.position?.y ?? 120;
        for (const prev of placed) {
          if (e.y < prev.y + prev.height + 24 && e.y + e.height + 24 > prev.y && e.x < prev.x + prev.width + 36 && e.x + e.width > prev.x) e.x = prev.x + prev.width + 36;
        }
        placed.push(e);
      }
    }
    const minX = preview ? 0 : Math.min(0, ...entries.map(e => e.x));
    const minY = preview ? 0 : Math.min(0, ...entries.map(e => e.y));
    return { entries, wf, path, width: Math.max(0, ...entries.map(e => e.x + e.width)) - minX, height: Math.max(0, ...entries.map(e => e.y + e.height)) - minY };
  }
  const root = plan(workflow, basePath, false, 0);
  const nodes = [], edges = [];
  function flatten(group, dx = 0, dy = 0) {
    for (const e of group.entries) {
      const record = { ...e, x: e.x + dx, y: e.y + dy };
      delete record.child;
      nodes.push(record);
      if (e.child) flatten(e.child, record.x + 16, record.y + 204);
    }
    const ids = new Map(group.entries.map(e => [e.node.id, e.cellId]));
    for (const edge of group.wf.edges || []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      edges.push({ edge, path: group.path, cellId: group.path.length === basePath.length ? edge.id : `edge:${nodeKey(group.path, edge.id)}`, from: ids.get(edge.from), to: ids.get(edge.to), preview: group.path.length > basePath.length });
    }
  }
  flatten(root);
  return { nodes, edges, omitted: remaining < 0 };
}

const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const iterKey = (iteration, prefix) => `${nodeKey(iteration.workflowPath || [], iteration.nodeId)}@${JSON.stringify(prefix)}`;

export class TraceSelection {
  constructor() { this.trace = []; this.preferences = new Map(); this.latest = new Map(); this.byNode = new Map(); }
  reset() { this.update([]); this.preferences.clear(); }
  update(trace) {
    this.trace = trace; this.latest.clear(); this.byNode.clear();
    for (const step of trace) {
      const key = nodeKey(step.workflowPath, step.nodeId);
      if (!this.byNode.has(key)) this.byNode.set(key, []);
      this.byNode.get(key).push(step);
      (step.iterations || []).forEach((iteration, ordinal) => {
        const key = iterKey(iteration, step.iterations.slice(0, ordinal).map(i => i.index));
        this.latest.set(key, Math.max(this.latest.get(key) ?? -1, iteration.index));
      });
    }
  }
  selected(iteration, prefix) {
    const key = iterKey(iteration, prefix);
    if (this.preferences.has(key)) return this.preferences.get(key);
    return this.latest.get(key) ?? null;
  }
  matches(step) {
    return (step.iterations || []).every((iteration, i) => iteration.index === this.selected(iteration, step.iterations.slice(0, i).map(j => j.index)));
  }
  steps(path, id) { return (this.byNode.get(nodeKey(path, id)) || []).filter(s => this.matches(s)); }
  step(path, id) {
    const steps = this.steps(path, id);
    return steps.filter(s => !['map-value', 'filter-test'].includes(s.type)).at(-1) || steps.at(-1) || null;
  }
  itemStep(path, id) { return this.steps(path, id).filter(s => ['map-value', 'filter-test'].includes(s.type)).at(-1) || null; }
  picker(path, id) {
    const owner = { workflowPath: path, nodeId: id };
    const options = new Map();
    for (const step of this.trace) (step.iterations || []).forEach((iteration, i) => {
      if (iteration.nodeId !== id || !samePath(iteration.workflowPath || [], path)) return;
      if (!step.iterations.slice(0, i).every((ancestor, j) => ancestor.index === this.selected(ancestor, step.iterations.slice(0, j).map(k => k.index)))) return;
      const prefix = step.iterations.slice(0, i).map(k => k.index);
      options.set(iteration.index, { index: iteration.index, item: iteration.item, prefix });
    });
    const values = [...options.values()].sort((a,b) => a.index - b.index);
    const prefix = values.at(-1)?.prefix || [];
    const key = iterKey(owner, prefix);
    return { options: values, key, selected: this.selected(owner, prefix), following: !this.preferences.has(key) };
  }
  choose(path, id, value) {
    const picker = this.picker(path, id);
    if (value === 'latest') this.preferences.delete(picker.key);
    else this.preferences.set(picker.key, Number(value));
  }
  reveal(step) {
    (step.iterations || []).forEach((iteration, i) => this.preferences.set(iterKey(iteration, step.iterations.slice(0, i).map(j => j.index)), iteration.index));
  }
}

export function stepOutput(step) {
  if (!step || !Object.prototype.hasOwnProperty.call(step, 'output')) return { available: false };
  return { available: true, value: step.output };
}
