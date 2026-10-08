export const bestKey = probabilities => Object.entries(probabilities || {}).reduce(
  (best, entry) => !best || entry[1] > best[1] ? entry : best,
  null,
)?.[0] || null;

export function rotatedChoiceQuestions(prefix, instructions, criteria) {
  const n = Object.keys(criteria).length;
  return Object.fromEntries(Array.from({ length: n }, (_, r) => [
    `${prefix}${r}`,
    {
      type: 'choice',
      instructions,
      criteria,
      option_order: Array.from({ length: n }, (_, i) => (i + r) % n),
    },
  ]));
}

export function averageRotatedChoice(answers, prefix, keys) {
  const probabilities = Object.fromEntries(keys.map(key => [key, 0]));
  let count = 0;
  for (let i = 0; i < keys.length; i++) {
    const current = answers?.[`${prefix}${i}`]?.probabilities;
    if (!current) continue;
    count++;
    for (const key of keys) probabilities[key] += current[key] ?? 0;
  }
  if (count) for (const key of keys) probabilities[key] /= count;
  return { probabilities, choice: count ? bestKey(probabilities) : null, count };
}


export function candidateChoiceQuestions(candidates, prefix, instructions, criteria) {
  return Object.fromEntries(candidates.map(candidate => [
    `${prefix}_${candidate.id}`,
    {
      type: 'choice',
      instructions: typeof instructions === 'function' ? instructions(candidate) : instructions,
      criteria: typeof criteria === 'function' ? criteria(candidate) : criteria,
    },
  ]));
}

export function candidateChoiceScores(answers, candidates, prefix, keys) {
  return candidates.map(candidate => {
    const probabilities = answers?.[`${prefix}_${candidate.id}`]?.probabilities || {};
    return {
      ...candidate,
      probabilities,
      ...Object.fromEntries(keys.map(key => [key, probabilities[key] ?? 0])),
    };
  });
}

export function candidateJudgmentQuestions(candidates, prefix = 'candidate', noun = 'choice') {
  const questions = {};
  for (const candidate of candidates) {
    const label = candidate.label || candidate.id;
    Object.assign(questions, rotatedChoiceQuestions(
      `${prefix}_${candidate.id}_`,
      `Is ${label} a good ${noun} now?`,
      {
        good: `${label} is a good ${noun} now`,
        bad: `${label} is a bad ${noun} now`,
      },
    ));
  }
  return questions;
}

export function candidateGoodScores(answers, candidates, prefix = 'candidate') {
  return candidates.map(candidate => {
    const result = averageRotatedChoice(answers, `${prefix}_${candidate.id}_`, ['good', 'bad']);
    return {
      ...candidate,
      probabilities: result.probabilities,
      good: result.probabilities.good ?? 0,
      bad: result.probabilities.bad ?? 0,
      count: result.count,
    };
  });
}

export function bestCandidate(answers, candidates, prefix = 'candidate') {
  return candidateGoodScores(answers, candidates, prefix).reduce(
    (best, current) => !best || current.good > best.good ? current : best,
    null,
  );
}

export function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function installGameSection({ id, navLabel, titleHtml, lead, sees, controls }) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const checkpoint = document.getElementById('checkpoint');
  if (!checkpoint) return;

  const section = document.createElement('section');
  section.className = 'block';
  section.id = id;
  section.innerHTML = `
    <div class="head">
      <h2>${titleHtml}</h2>
      <div class="aside"><p class="lead">${lead}</p></div>
    </div>
    <div class="live game-mount" data-demo="${id}"></div>
    <div class="qa">
      <div><h3>What does Laya see?</h3><p>${sees}</p></div>
      <div><h3>What does the player control?</h3><p>${controls}</p></div>
    </div>`;
  checkpoint.before(section);

  const nav = document.querySelector('nav.index');
  const checkpointLink = nav?.querySelector('a[href="./#checkpoint"]');
  if (checkpointLink && !nav.querySelector(`a[href="./#${id}"]`)) {
    const link = document.createElement('a');
    link.href = `./#${id}`;
    link.textContent = navLabel;
    checkpointLink.before(link);
  }
}
