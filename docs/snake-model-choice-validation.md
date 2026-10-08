# Snake v5 direct model choice — historical, 2026-10-06

Superseded by [v6 grounded options](snake-grounded-options-validation.md). The failures below describe the previous prompt.

All four options (`up`, `right`, `down`, `left`) are offered in every request. The model receives heading, adjacent-cell contents, food position and the rule that it may continue or turn sideways but cannot reverse. The controller applies `answers.direction.choice` directly. It does not filter probabilities, select a replacement or hide wall/body mistakes.

Real Laya 0.3.28 English calls on RTX 5080 CUDA were tested with `tools/evaluate_snake.mjs`. [Full results](data/snake-model-choice-validation.json) include raw answers for failing positions, prompt-screening summaries and seeded runs. The historical v4 filter was removed at the user's request; [its results](snake-validation.md) do not describe current model performance.

| Check | Current direct choice |
| --- | --- |
| Fixed positions | 39 |
| Model reversal choices | 0 |
| Empty, non-reversing next cells | 34/39 |
| Toward food when available, otherwise a legal detour | 17/39 |
| Three selection seeds, 30 simulation seconds each | 2 food, 24 crashes, 0 rejected reversals |
| Three held-out seeds, 30 simulation seconds each | 1 food, 25 crashes, 0 rejected reversals |
| Held-out controller replacements / filters / stale replies | 0 / 0 / 0 |

Selection seeds were 7, 20261006 and 31; held-out seeds were 101, 202 and 303. These runs demonstrate reversal-rule compliance in this sample, **not good gameplay**. The model often continues straight or picks poor food directions. Walls and body collisions remain real mistakes. Prompting alone has not made direct Snake decisions reliable.

A longer repeated prohibition with conditional options also avoided reversal, but collected only one food with 33 crashes across three 30-second runs; that wording was discarded. The selected prompt states the movement rule once in positive terms. All four criteria remain fixed, including the forbidden backward direction.

The refreshed actual 60-simulation-second recording has 203 decisions, best score 1, 16 crashes and 11.2 ms median inference. Its replay matches exactly; all three original game replays also pass. No responses were replaced to improve the recording.

Native browser checks observed 18 applied choices with zero controller substitutions. Seven captured live API requests each contained all four criteria; the feed displayed all four raw probabilities and the exact applied choice. Temporary instrumentation was restored and the game was left paused.

Mechanics regressions verify four-option schemas for every heading, explicit reversal-rule state, authoritative returned choice even when probability ranking differs, no second-best rescue, ordinary reversal rejection, fatal wall/body choices, tail vacating, stale-answer handling, one fresh answer per model-controlled move and human controls.

Reproduce the v5 fixed positions and held-out games:

```bash
node tools/check_snake.mjs
node tools/evaluate_snake.mjs --previous --seeds 101,202,303 --seconds 30 --out /tmp/snake-v5.json
ONLY=snake SEED=20261006 SECONDS=60 MACHINE="your hardware" node tools/record_run.mjs
node tools/verify_replay.mjs
```
