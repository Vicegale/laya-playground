# Snake v6 grounded options — 2026-10-07

The stock Laya 0.3.28 English checkpoint chooses directly from all four actions. Every option remains in every request, including walls, body and the backward turn. The controller applies `answers.direction.choice`; no collision mask, option omission, probability reranking or second-best replacement is used. Neighbor descriptions are local cell/rule observations, without candidate route outcomes or a preferred winner.

The food relation is in state. Direction descriptions bind each neighbor to “open passage” or “obstacle, wall / snake body / reverse into the neck”. The question is **Which open direction is toward food?** See [the exact input and mechanics](snake.md) and [research](snake-prompt-research.md).

Real `/api/predict` calls ran on RTX 5080 CUDA. [Full results](data/snake-grounded-options-validation.json) retain the previous prompt's failing fixed-position answers and all seeded summaries. v5 is reproduced with `--previous` using identical game physics, fresh-answer waiting, four choices, checkpoint and direct controller. Only the input wording/layout changes.

| Check | Previous v5 | Current v6 |
| --- | --- | --- |
| Safe next cell, 39 fixed positions | 34/39 | 39/39 |
| Toward food if possible, otherwise legal detour | 17/39 | 39/39 |
| Reversal choices in fixed positions | 0 | 0 |
| Matched three seeds, 60 simulation seconds each: food | 3 | 94 |
| Matched runs: crashes | 49 | 4 |
| Matched runs: rejected reversal choices | 0 | 1 |
| Five held-out seeds, 60 simulation seconds each | — | 147 food, 5 crashes, 0 rejected reversals |
| 2× speed, extra 175 ms delay, 12 simulation seconds | — | 5 food, 0 crashes, 0 stale replies |

Matched seeds: 7, 20261006, 31. Held-out seeds: 101, 202, 303, 404, 505. Delay seed: 808. All current runs had zero controller filters, substituted choices and stale replies. No request reported truncation. The fixed positions were used during prompt development; the independent seeded games provide a further check. These are small local regressions, not a general model accuracy benchmark. Inference round-trip time affects the headless schedule, so exact counts may vary between runs.

The model still makes mistakes: there was one forbidden reversal in matched games, and growing bodies can lead to collisions. The short local input cannot plan future escape routes. Model mistakes remain visible: reversals are rejected by ordinary Snake physics, while wall/body choices cause real crashes.

The regenerated actual replay contains 382 decisions over 60 simulation seconds, best score 27, final score 6, 1 crash and 11.7 ms median inference. Replay matches exactly. The original Flappy, Runner and Tetris replays also pass. No responses were replaced to improve the recording.

Native browser DOM checks confirmed all four descriptions and raw bars, including wall and reverse-neck options. Twelve captured Snake requests used the stock English checkpoint and all four options; twelve corresponding actions used the exact returned choice. Desktop 1280×800 and mobile 390×844 had no horizontal overflow. Native screenshot capture failed in the preview client, so screenshot-based visual inspection was unavailable.

Mechanics regressions verify four options for every heading, wall/body/reverse descriptions, vacating-tail passages, authoritative returned choice even if its probability is not largest, fatal collision choices, reversal rejection without rescue, stale handling, one fresh answer per model move and human controls.

Reproduce:

```bash
node tools/check_snake.mjs
node tools/evaluate_snake.mjs --previous --out /tmp/snake-v5.json
node tools/evaluate_snake.mjs --out /tmp/snake-v6.json
node tools/evaluate_snake.mjs --seeds 101,202,303,404,505 --out /tmp/snake-heldout.json
node tools/evaluate_snake.mjs --seeds 808 --speed 2 --seconds 12 --latency-ms 175
ONLY=snake SEED=20261006 SECONDS=60 MACHINE="your hardware" node tools/record_run.mjs
node tools/verify_replay.mjs
```
