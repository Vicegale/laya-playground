import { clone } from './workflow-runtime.js';

export const LIBRARY_KEY = 'laya-workflow-library-v1';
const kinds = new Set(['subflow', 'template']);

export function validateLibrary(value) {
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error('Invalid workflow library.');
  const ids = new Set();
  for (const entry of value.entries) {
    if (!entry.id || ids.has(entry.id) || !kinds.has(entry.kind) || !entry.versions?.length) throw new Error('Invalid library entry.');
    ids.add(entry.id);
    entry.versions.forEach((v, i) => {
      if (v.number !== i + 1 || !v.name?.trim() || !Array.isArray(v.workflow?.nodes) || !Array.isArray(v.workflow?.edges)) throw new Error('Invalid published version.');
    });
  }
  return value;
}

export function publishVersion(library, { id, kind, name, description = '', workflow, input, baseVersion }) {
  validateLibrary(library);
  if (!kinds.has(kind)) throw new Error('Choose subflow or template.');
  if (!name?.trim()) throw new Error('Give this flow a name.');
  if (!workflow?.nodes?.length || !Array.isArray(workflow.edges)) throw new Error('Cannot save an empty or invalid flow.');
  const next = clone(library);
  let entry = next.entries.find(e => e.id === id);
  if (entry) {
    if (entry.kind !== kind) throw new Error('Published flows cannot change kind. Save a new item instead.');
    if (baseVersion !== entry.versions.at(-1).number) throw new Error('A newer version was published. Open the latest version as a draft before publishing again.');
  } else {
    if (baseVersion !== undefined) throw new Error('This library item is unavailable. Save a new item instead.');
    entry = { id, kind, versions: [] };
    next.entries.push(entry);
  }
  const body = clone(workflow);
  delete body.librarySource;
  body.name = name.trim();
  entry.versions.push({ number: entry.versions.length + 1, name: name.trim(), description: description.trim(), createdAt: new Date().toISOString(), workflow: body, input: clone(input) });
  return next;
}

export function pinVersion(entry, number = entry.versions.at(-1).number) {
  if (entry.kind !== 'subflow') throw new Error('Only subflows can be inserted as linked nodes.');
  const version = entry.versions.find(v => v.number === number);
  if (!version) throw new Error('Published version is unavailable.');
  return { workflow: clone(version.workflow), libraryRef: { id: entry.id, version: number, name: version.name } };
}

export class WorkflowLibrary {
  constructor(storage) { this.storage = storage; }
  read() {
    const raw = this.storage.getItem(LIBRARY_KEY);
    return raw ? validateLibrary(JSON.parse(raw)) : { version: 1, entries: [] };
  }
  find(id) { return this.read().entries.find(e => e.id === id) || null; }
  publish(draft) {
    // Read again so a stale browser tab cannot overwrite another tab's publish.
    const next = publishVersion(this.read(), draft);
    this.storage.setItem(LIBRARY_KEY, JSON.stringify(next));
    return clone(next.entries.find(e => e.id === draft.id));
  }
}
