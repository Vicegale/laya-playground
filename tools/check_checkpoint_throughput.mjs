import assert from 'node:assert/strict';
import { InspectionThroughput } from '../static/demos/checkpoint-throughput.js';

let clock = 1000;
const meter = new InspectionThroughput(() => clock);
assert.equal(meter.snapshot().perMinute.total, 0);
meter.setRunning(true);
clock += 1000; meter.setRunning(true); // repeated status updates must not restart the clock
meter.record('correct', 'live');
clock += 1000; meter.record('citation', 'live');
clock += 1000; meter.record('review', 'live');
clock += 1000; meter.record('practice', 'live');
assert.deepEqual(meter.snapshot().counts, { total: 4, correct: 1, incorrect: 1, review: 1, practice: 1 });
assert.equal(meter.snapshot().perMinute.total, 60);
assert.equal(meter.snapshot().perMinute.correct, 15);
assert.equal(meter.snapshot().perMinute.incorrect, 15);

// Stopping, hidden-tab/offscreen pauses and finishing freeze both elapsed time and rates.
meter.setRunning(false);
const frozen = meter.snapshot();
clock += 60000; meter.setRunning(false);
assert.deepEqual(meter.snapshot(), frozen);
// Resuming uses the accumulated real active time, rather than including the idle minute.
meter.setRunning(true);
clock += 1000; meter.record('correct', 'recorded');
assert.equal(meter.snapshot().elapsedMs, 5000);
assert.equal(meter.snapshot().perMinute.total, 60);
assert.equal(meter.snapshot().perMinute.correct, 24);
assert.deepEqual(meter.snapshot().sources, ['live', 'recorded']);
clock += 5000; // intentional reading delay is part of active throughput
assert.equal(meter.snapshot().perMinute.total, 30);

const detached = meter.snapshot(); detached.counts.total = 999;
assert.equal(meter.snapshot().counts.total, 5);
assert.throws(() => meter.record('unknown', 'live'));
assert.throws(() => meter.record('correct', 'human'));
meter.reset();
assert.equal(meter.snapshot().elapsedMs, 0);
assert.equal(meter.snapshot().perMinute.total, 0);
assert.equal(meter.snapshot().running, false);
assert.deepEqual(meter.snapshot().sources, []);
console.log('Throughput wall time, pauses, resume, grading categories, sources and reset verified.');
