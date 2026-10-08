// Store detached editor snapshots; adjacent changes in one field form one edit.
export class EditorHistory {
  constructor(initial, limit = 80) {
    this.limit = limit;
    this.entries = [JSON.stringify(initial)];
    this.index = 0;
    this.group = null;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  endGroup() { this.group = null; }

  commit(state, group = null) {
    const snapshot = JSON.stringify(state);
    if (snapshot === this.entries[this.index]) return;
    const coalesce = group !== null && group === this.group && !this.canRedo && this.index > 0;
    this.entries.length = this.index + 1;
    if (coalesce) this.entries[this.index] = snapshot;
    else {
      this.entries.push(snapshot);
      this.index++;
      if (this.entries.length > this.limit + 1) {
        this.entries.shift();
        this.index--;
      }
    }
    this.group = group;
  }

  undo() {
    this.endGroup();
    return this.canUndo ? JSON.parse(this.entries[--this.index]) : null;
  }

  redo() {
    this.endGroup();
    return this.canRedo ? JSON.parse(this.entries[++this.index]) : null;
  }
}
