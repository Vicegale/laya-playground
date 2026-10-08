// Previews are detached and bounded so large loop inputs do not multiply in the trace.
export function previewValue(value) {
  let remaining = 200;
  let characters = 16000;
  const ancestors = new Set();
  function visit(v, depth) {
    if (--remaining < 0) return '[preview limit reached]';
    if (v === undefined) return '[undefined]';
    if (typeof v === 'string') {
      const length = Math.min(v.length, Math.max(0, characters), 8000);
      characters -= length;
      return length < v.length ? `${v.slice(0, length)}… [${v.length - length} characters omitted]` : v;
    }
    if (v === null || typeof v !== 'object') return v;
    if (depth >= 6) return '[deeper values omitted]';
    if (ancestors.has(v)) return '[circular reference]';
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      result = v.slice(0, 12).map(item => visit(item, depth + 1));
      if (v.length > 12) result.push(`[${v.length - 12} more items omitted]`);
    } else {
      const keys = Object.keys(v);
      result = Object.fromEntries(keys.slice(0, 30).map(key => [key, visit(v[key], depth + 1)]));
      if (keys.length > 30) result['[preview]'] = `${keys.length - 30} more fields omitted`;
    }
    ancestors.delete(v);
    return result;
  }
  return visit(value, 0);
}

export function valueType(value) {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

export function locateStep(workflow, step) {
  const frames = [{ workflow, label: workflow.name || 'Workflow' }];
  for (const id of step.workflowPath || []) {
    const owner = frames.at(-1).workflow.nodes.find(n => n.id === id);
    if (!owner?.config?.workflow) return null;
    frames.push({ workflow: owner.config.workflow, label: owner.label, owner: id, linked: !!owner.config.libraryRef });
  }
  const node = frames.at(-1).workflow.nodes.find(n => n.id === step.nodeId);
  return node ? { frames, node } : null;
}

// Incomplete collection counts describe work already produced, not a final list.
export function listCountSummary(step) {
  const counts = step?.listCounts;
  if (!counts) return '';
  const partial = counts.processed !== undefined && !['success', 'warning'].includes(step.status);
  const parts = [];
  const unit = (name, count) => name ? `${count === 1 ? name.replace(/s$/, '') : name} ` : '';
  if (counts.input !== undefined) parts.push(`${counts.input} ${unit(counts.inputUnit, counts.input)}in`);
  if (counts.output !== undefined) parts.push(`${counts.output} ${unit(counts.outputUnit, counts.output)}${partial ? 'produced' : 'out'}`);
  return parts.join(' → ') + (partial ? ` · ${counts.processed}/${counts.input} processed` : '');
}
