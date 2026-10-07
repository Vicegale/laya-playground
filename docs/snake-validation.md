# Historical Snake v4 controller regression results — 2026-10-06

**Superseded:** the user requested all four actions and direct model choice. The playable-move filter measured below has been removed. See [current direct-choice results](snake-model-choice-validation.md).

Real local Laya 0.3.28 English responses on RTX 5080 CUDA, using `tools/evaluate_snake.mjs`. These are controller regression tests; the new controller includes an immediate playable-move filter, so results do not imply the raw model always selects safe actions. Full results and failing fixed-position descriptions are in [snake-validation.json](data/snake-validation.json).

| Check | Previous policy | Fixed controller |
| --- | --- | --- |
| 39 fixed positions: playable choices | 32/39 | 39/39 |
| 39 fixed positions: food progress when available, otherwise playable detour | 20/39 | 37/39 |
| 39 fixed positions: rejected reversals | 3 | 0 |
| Three matched 60-second seeds: food collected | 38 | 97 |
| Same runs: crashes | 55 | 2 |
| Same runs: rejected reversal answers | 116 | 0 |

The matched seeds were 7, 20261006 and 31. Fixed tests include the reported heading-right/food-left/body-left situation, rotated food positions, walls ahead and a body corner requiring a detour. The two remaining fixed-position failures are directional preference errors, not illegal actions. The two matched-run crashes were enclosed positions with no playable exit; no pathfinder is added to prevent future traps.

Five held-out seeds (101, 202, 303, 404, 505), each for 60 simulation seconds, collected 142 food with five crashes. Each crash was an unavoidable enclosure at that moment. All runs had zero rejected reversals and zero stale replies. Best life scores ranged from 18 to 29.

At 0.2× speed, a separate 60-simulation-second run (seed 909) collected 34 food with one trapped-position crash and no rejected/stale answers. At 2× with an extra 175 ms response delay, seed 808 ran for 12 simulation seconds, collected five food and had zero crashes, rejected choices or stale answers. Model movement waits rather than applying one answer to multiple cells.

Native browser QA at 2× with an injected 175 ms fetch delay observed 25 model-controlled moves: every move had a fresh same-position answer, with no unanswered moves and no crash. Raw probabilities and exclusions were visible. Human WASD play was independently verified to move and hit a wall normally, with zero model calls.

Mechanics tests include no-reversal option schemas, tail vacating, highest model probability among playable exits, stale-response handling, no-exit trapping and delayed-answer waiting. The current static recording is generated from actual responses and checked with `tools/verify_replay.mjs` alongside the three original games.

Reproduce:

```bash
node tools/check_snake.mjs
node tools/evaluate_snake.mjs --baseline --out /tmp/snake-before.json
node tools/evaluate_snake.mjs --out /tmp/snake-after.json
node tools/evaluate_snake.mjs --seeds 101,202,303,404,505
node tools/evaluate_snake.mjs --seeds 909 --speed 0.2
node tools/evaluate_snake.mjs --seeds 808 --speed 2 --seconds 12 --latency-ms 175
node tools/verify_replay.mjs
```

A slower inference queue can reduce the number of moves completed within a fixed simulation interval, so these local seeded counts are not a general accuracy or throughput benchmark. Longer play can still produce self-enclosure.
