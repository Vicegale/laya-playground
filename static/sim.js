// Timing shared by the browser stage and the headless recorder (tools/record_run.mjs), so a
// recorded run replays step for step.

export const STEP = 1 / 120;       // fixed simulation timestep, seconds
export const MAX_RATE = 40;        // decisions per second, upper bound
export const MIN_GAP = Math.ceil(1 / MAX_RATE / STEP);  // steps between two observations

/** Save every question's probabilities; single-question runs retain the original array format. */
export function probabilitiesForRecording(obs, answers) {
  const rows = Object.fromEntries(Object.entries(obs.questions).map(([id, q]) => {
    const keys = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria);
    return [id, keys.map(key => +answers[id].probabilities[key].toFixed(3))];
  }));
  return Object.keys(rows).length === 1 ? Object.values(rows)[0] : rows;
}

/** Rebuild all answers from an original probability list or a multi-question mapping. */
export function answersFrom(obs, probs) {
  return Object.fromEntries(Object.entries(obs.questions).map(([id, q]) => {
    const keys = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria);
    const row = Array.isArray(probs) ? probs : probs[id];
    const probabilities = Object.fromEntries(keys.map((key, index) => [key, row[index]]));
    return [id, { type: q.type, probabilities, choice: keys[row.indexOf(Math.max(...row))] }];
  }));
}
