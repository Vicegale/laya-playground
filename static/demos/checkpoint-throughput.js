// Completed Laya traveler inspections per active monotonic wall-clock minute.
// Includes deliberate pacing and in-flight work; excludes stopped/offscreen idle time.
export class InspectionThroughput {
  constructor(now = () => performance.now()) { this.now = now; this.reset(); }

  reset() {
    this.elapsedMs = 0; this.startedAt = null;
    this.counts = { total: 0, correct: 0, incorrect: 0, review: 0, practice: 0 };
    this.sources = new Set();
  }

  setRunning(running) {
    const now = this.now();
    if (running && this.startedAt === null) this.startedAt = now;
    else if (!running && this.startedAt !== null) {
      this.elapsedMs += Math.max(0, now - this.startedAt); this.startedAt = null;
    }
  }

  record(kind, source) {
    const category = { correct: 'correct', citation: 'incorrect', review: 'review', practice: 'practice' }[kind];
    if (!category || !['live', 'recorded'].includes(source)) throw new Error('Unknown inspection outcome or source.');
    this.counts.total++; this.counts[category]++; this.sources.add(source);
  }

  snapshot() {
    const elapsedMs = this.elapsedMs + (this.startedAt === null ? 0 : Math.max(0, this.now() - this.startedAt));
    return { elapsedMs, running: this.startedAt !== null, counts: { ...this.counts }, sources: [...this.sources],
      perMinute: Object.fromEntries(Object.entries(this.counts).map(([key, count]) => [key, elapsedMs > 0 ? count * 60000 / elapsedMs : 0])) };
  }
}
