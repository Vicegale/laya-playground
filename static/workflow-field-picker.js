const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const sample = value => { const s = JSON.stringify(value) ?? '[undefined]'; return s.length > 100 ? s.slice(0, 97) + '…' : s; };

export function createFieldPicker({ catalog }) {
  const dialog = document.querySelector('#fieldPickerDialog');
  const list = dialog.querySelector('#fieldPickerList');
  const search = dialog.querySelector('#fieldPickerSearch');
  let target = null, fields = [], bare = false, start = 0, end = 0;
  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = fields.filter(f => `${f.path} ${f.type}`.toLowerCase().includes(query));
    list.innerHTML = matches.length ? matches.map(f => `<button type="button" class="field-choice" data-reference="${esc(f.path)}"><span class="field-choice-head"><code>${esc(f.path)}</code><span>${esc(f.type)}</span></span><span class="field-choice-sample">${f.hasSample ? esc(sample(f.sample)) : f.observed ? 'Sample unavailable' : 'Not run yet'}<small>${esc(f.origin)}${f.observed && f.item ? ` · item ${f.item}` : ''}${f.edited ? ' · edited since run' : ''}${f.conditional ? ' · conditional' : ''}</small></span></button>`).join('') : '<p class="muted">No matching fields. You can still enter a reference directly.</p>';
  }
  function open(el, node, perItem) {
    target = el; bare = el.matches('[data-cond="left"]');
    start = el.selectionStart ?? 0; end = el.selectionEnd ?? el.value.length;
    const exact = el.value.match(/^\s*{{[^{}]+}}\s*$/);
    if (exact || bare) { start = 0; end = el.value.length; }
    fields = catalog(node, perItem); search.value = ''; render();
    dialog.querySelector('#fieldPickerContext').textContent = perItem ? 'Current item and earlier steps in this scope' : 'Input and earlier steps in this scope';
    dialog.showModal(); search.focus();
  }
  dialog.querySelector('#closeFieldPickerBtn').addEventListener('click', () => dialog.close());
  search.addEventListener('input', render);
  list.addEventListener('click', e => {
    const choice = e.target.closest('[data-reference]'); if (!choice || !target?.isConnected) return;
    const ref = bare ? choice.dataset.reference : `{{${choice.dataset.reference}}}`;
    target.setRangeText(ref, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.close();
  });
  dialog.addEventListener('close', () => { if (target?.isConnected) target.focus({ preventScroll: true }); });
  return {
    attach(node) {
      const inspector = document.querySelector('#inspector');
      const fields = inspector.querySelectorAll('[data-mapping="value"], [data-cond], [data-assign="value"], textarea[data-option="description"], [data-field="question"], [data-field="trueCriterion"], [data-field="falseCriterion"], [data-case="value"], [data-field="state"], [data-field="source"], [data-field="input"], [data-field="value"], [data-field="columns"], [data-field="filename"], textarea[data-field="key"]');
      fields.forEach(el => {
        if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
        const wrap = document.createElement('div'); wrap.className = 'wf-reference-control';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'reference-pick'; button.textContent = '{}'; button.setAttribute('aria-label', 'Choose a field'); button.title = 'Choose an available field';
        button.disabled = el.disabled;
        el.before(wrap); wrap.append(el, button);
        const item = ['map','filter','groupby'].includes(node.type) && ((node.type === 'map' && node.config.mode !== 'workflow' && (el.dataset.mapping || el.dataset.field === 'value')) || (node.type === 'filter' && el.dataset.cond) || (node.type === 'groupby' && el.dataset.field === 'key'));
        button.addEventListener('click', e => { e.preventDefault(); open(el, node, !!item); });
      });
    },
  };
}
