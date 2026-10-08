import { clone } from './workflow-runtime.js';
import { WorkflowLibrary, pinVersion, LIBRARY_KEY } from './workflow-library.js';

const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

export function createLibraryUI({ getWorkflow, getInput, onInsert, onLoad, onPublish, onChange }) {
  const library = new WorkflowLibrary(localStorage);
  const dialog = document.querySelector('#libraryDialog');
  const list = dialog.querySelector('#libraryList');
  const form = dialog.querySelector('#librarySaveForm');
  const feedback = dialog.querySelector('#libraryFeedback');
  const field = name => form.elements.namedItem(name);
  const report = (message, error = false) => {
    feedback.textContent = message;
    feedback.classList.toggle('library-error', error);
  };
  const attempt = action => { try { action(); } catch (e) { report(e.message, true); } };

  function renderList() {
    const entries = library.read().entries;
    list.innerHTML = entries.length ? entries.map(entry => {
      const latest = entry.versions.at(-1);
      return `<article class="library-card" data-entry="${esc(entry.id)}">
        <div class="library-card-head"><b>${esc(latest.name)}</b><small>${entry.kind === 'subflow' ? 'Linked subflow' : 'Template'}</small></div>
        ${latest.description ? `<p>${esc(latest.description)}</p>` : ''}
        <div class="library-card-actions">
          <select aria-label="Version of ${esc(latest.name)}" data-version>${[...entry.versions].reverse().map(v => `<option value="${v.number}">v${v.number} · ${esc(v.name)}</option>`).join('')}</select>
          ${entry.kind === 'subflow' ? '<button type="button" data-action="insert">Insert linked</button>' : '<button type="button" data-action="load">Use template</button>'}
          <button type="button" data-action="edit">Edit draft</button>
        </div>
      </article>`;
    }).join('') : '<div class="library-empty"><b>No saved flows yet</b><p>Save this canvas as a linked subflow or a template with its sample input.</p></div>';
  }

  function prepareForm() {
    const wf = getWorkflow();
    const source = wf.librarySource;
    const entry = source && library.find(source.id);
    const v = entry?.versions.find(v => v.number === source.version);
    field('name').value = wf.name || 'Untitled flow';
    field('kind').value = entry?.kind || 'subflow';
    field('description').value = v?.description || '';
    dialog.querySelector('#publishLibraryBtn').disabled = !entry;
    dialog.querySelector('#publishLibraryBtn').hidden = !entry;
    form.querySelector('details').open = !!v?.description;
    dialog.querySelector('#libraryDraftStatus').textContent = entry
      ? `Draft of ${v?.name || wf.name} v${source.version}. Existing links keep their version.`
      : 'Templates include the workflow input.';
  }

  function open() {
    report('');
    if (!dialog.open) dialog.showModal();
    attempt(() => { renderList(); prepareForm(); });
  }
  dialog.querySelector('#closeLibraryBtn').addEventListener('click', () => dialog.close());
  dialog.querySelector('#saveLibraryBtn').addEventListener('click', () => attempt(() => {
    const entry = library.publish({ id: `library-${crypto.randomUUID()}`, kind: field('kind').value, name: field('name').value, description: field('description').value, workflow: getWorkflow(), input: getInput() });
    onPublish(entry);
    renderList(); prepareForm(); report(`Saved ${entry.versions.at(-1).name} v1.`);
    onChange();
  }));
  dialog.querySelector('#publishLibraryBtn').addEventListener('click', () => attempt(() => {
    const source = getWorkflow().librarySource;
    if (!source) throw new Error('Open a library item as a draft first.');
    const entry = library.publish({ id: source.id, baseVersion: source.version, kind: field('kind').value, name: field('name').value, description: field('description').value, workflow: getWorkflow(), input: getInput() });
    onPublish(entry);
    renderList(); prepareForm(); report(`Published v${entry.versions.at(-1).number}. Update linked nodes explicitly when ready.`);
    onChange();
  }));
  form.addEventListener('submit', e => e.preventDefault());
  list.addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    attempt(() => {
      const card = button.closest('[data-entry]');
      const entry = library.find(card.dataset.entry);
      if (!entry) throw new Error('This library item is unavailable.');
      const number = Number(card.querySelector('[data-version]').value);
      const version = entry.versions.find(v => v.number === number);
      if (!version) throw new Error('This version is unavailable.');
      if (button.dataset.action === 'insert') onInsert(entry, pinVersion(entry, number));
      else onLoad(entry, clone(version));
      dialog.close();
    });
  });
  window.addEventListener('storage', e => {
    if (e.key !== LIBRARY_KEY) return;
    if (dialog.open) attempt(renderList);
    onChange();
  });
  return { open, find: id => { try { return library.find(id); } catch { return null; } }, pin: pinVersion };
}
