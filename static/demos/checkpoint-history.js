// Bounded, detached snapshots: instant advance and later edits cannot change old inspections.
export const HISTORY_LIMIT = 5;

export class InspectionHistory {
  constructor() { this.reset(); }

  reset() { this.results = { approve: [], deny: [], review: [] }; }

  record(inspection) {
    const bucket = this.results[inspection.outcome.decision];
    if (!bucket) throw new Error('Unknown inspection decision.');
    const snapshot = structuredClone(inspection);
    bucket.unshift(snapshot);
    bucket.length = Math.min(bucket.length, HISTORY_LIMIT);
    return snapshot;
  }
}
