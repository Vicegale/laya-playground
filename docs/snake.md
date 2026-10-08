# Snake

Open `/#snake` for live model play, faithful recorded replay or human arrow/WASD/touch controls. The board is 20×12 with solid walls. The snake starts four cells long, grows with food and moves from five up to ten cells per simulation second. Reversal into the neck is forbidden. A tail cell is playable when it vacates on that move. Collisions end a life; reset retains best score and crash count. Filling the board completes it without a crash.

## Model input and decisions

`static/demos/snake.js` keeps the stock English checkpoint and sends current local facts, without a recommended move. The food relation is in `state`; each of the four options carries its own neighboring-cell condition. For the previously failing food-behind position:

```json
{
  "state": "The food is to the left of the head.",
  "questions": {
    "direction": {
      "type": "choice",
      "instructions": "Which open direction is toward food?",
      "criteria": {
        "up": "open passage above the head",
        "right": "open passage to the right of the head",
        "down": "open passage below the head",
        "left": "obstacle, reverse into the neck"
      }
    }
  }
}
```

Descriptions update from actual adjacent-cell occupancy and the normal reversal rule: **open passage**, **obstacle, wall**, **obstacle, snake body** or **obstacle, reverse into the neck**. A vacating tail is an open passage. This translation supplies local observations; it computes no food-distance score, candidate route outcome, preferred winner or path. All four action keys remain present and receive model probabilities, including blocked and backward directions. No checkpoint is trained or substituted.

`act()` applies `answers.direction.choice` directly. It does not rank probabilities, remove blocked options or select a second-best direction. The feed shows **OPTIONS SENT**, **RAW MODEL PROBABILITIES** for all four options and **QUEUED** with the exact returned choice. Normal game mechanics reject a reversal and label it **REJECTED**; the snake continues its current heading without an alternative being selected. Wall/body choices cause real collisions.

Grounding the options substantially improved measured stock-model play compared with v5's separate occupancy paragraph and repeated no-reversal instruction. It does not guarantee rule following or future escape from a growing body. See [grounded-option validation](snake-grounded-options-validation.md) and [prompting research](snake-prompt-research.md). The previous v4 playable-move filter is removed at the user's request; its results are historical.

## Timing and controls

Each model-controlled move requires one fresh answer for that exact head position. `setModelDriven(true)` makes live play, recording and replay wait at the movement deadline if inference has not finished. Waiting time cannot accumulate into multiple catch-up moves using one answer. Responses after a reset or position change are still discarded. `needsDecision()` suppresses repeats until the head moves.

**Simulation speed** ranges from 0.1×–2× (default 1×). It scales simulation time and persists across life/pilot changes. Slowing the game gives inference more time; speeding it up cannot force movement using an old answer. The feed counts simulation seconds. Live requests are capped at 40/s, but Snake normally makes just one request per move. Only the visible arcade game runs; drawing is capped at 60 fps.

Choose **You play** for arrows, WASD or on-screen arrows. Human movement does not wait for model calls. Space restarts after a crash. Pause/resume applies to either pilot.

## Recording and tests

Recordings retain actual model probabilities, latency, seed and exact observation/application steps. Current Snake uses `snake-state-v6-grounded-options`; older recordings are incompatible and rejected. Single-question recording arrays and multi-question maps remain supported by shared `static/sim.js` for other games and old formats.

```bash
ONLY=snake SECONDS=60 MACHINE="your hardware" node tools/record_run.mjs
node tools/check_snake.mjs
node tools/verify_replay.mjs
node tools/evaluate_snake.mjs --out /tmp/snake-current.json
node tools/evaluate_snake.mjs --previous --out /tmp/snake-before.json
node tools/evaluate_snake.mjs --seeds 101,202,303,404,505
node tools/evaluate_snake.mjs --seeds 808 --speed 2 --seconds 12 --latency-ms 175
```

`check_snake.mjs` covers movement, growth, collision rules, reversal schema, tail legality, stale reads, four-option schemas, direct choices without a fallback and slow-inference waiting. `evaluate_snake.mjs` uses actual `/api/predict` responses on 39 fixed positions and seeded games, preserves v5 wording with identical physics behind `--previous` (and the older v3 policy behind `--baseline`), and reports food, crashes, rejected/stale replies and filtering. It can add response delay to exercise slow inference. These are local regression runs, not a general accuracy benchmark.

See [the prompting research](snake-prompt-research.md) and [the measured regression results](snake-grounded-options-validation.md).
