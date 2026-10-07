# Snake prompting research

Researched 2026-10-06 after the direct-action and shortened prompts both performed poorly in user play. The initial section records a source/code review; later sections document implementation and real-model tests.

## What the other games actually ask

| Game | Model input and question | Work done by code |
| --- | --- | --- |
| Flappy | A sentence saying the bird is below, level with, or above the gap. Asks where the bird is relative to the gap. | Computes the spatial relation; flaps when P(below) exceeds a threshold. |
| Runner | Each lane is described as empty or blocked by a barrier. Asks which lane is empty. | Maps the selected lane to steering, with a stay threshold. |
| Tetris | A possible landing result is described in terms of holes and bumps. Asks how the stack looks after landing. | Enumerates landings, computes their characteristics, and selects the highest P(clean). |
| Initial direct-action Snake | Heading, food direction and neighboring cell contents. Asks which way to move to eat food and avoid obstacles. | Applies the returned direction, except normal game rules prevent reversal. |

Sources in this checkout: `static/demos/flappy.js:41`, `static/demos/runner.js:47`, `static/demos/tetris.js:21` and `:85`, `static/demos/snake.js:9` and `:83`.

The original games reduce a situation to textual facts for recognition. Snake's current question requires combining goal location, occupancy and action rules. Shortening it did not remove those reasoning requirements. Tetris in particular demonstrates grading code-produced outcomes, rather than planning directly from the board.

## External findings

- [Playground methodology](https://brainfunctioncollapse.com/laya/#flappy): its author reports inverted Flappy answers to action questions and better results from asking about position. Its Runner example also reports sensitivity to the wording used for barriers. These are specific observations, not proof that every action question fails.
- [Upstream option-order documentation](https://github.com/NandhaKishorM/laya#option-order): presented option position can affect answers; it documents probability averaging over balanced rotations using `option_order`, with the rotations batched into one forward pass. Current Snake always presents up first. This is a possible additional bias, not a diagnosed cause here.
- [Upstream limits](https://github.com/NandhaKishorM/laya#honest-limits): the base checkpoints are not established as reliable zero-shot decision engines; domain fine-tuning is the stronger route when direct state-to-action decisions are required.
- A [Rust Snake implementation](https://docs.rs/laya-snake/latest/src/laya_snake/policy.rs.html) computes safe moves and a preferred direction before preparing its model request. Its approach would not satisfy the user's requirement that the model choose from current state without a suggested move.

Local Laya 0.3.28 has `option_order` support, and this project's server passes the question definitions through to the agent. No dependency upgrade is needed to experiment with rotations.

## Recommendations within the current-state/direct-choice constraint

1. Use explicit natural-language facts, following Runner's sentences, rather than compact `up-left` and semicolon fragments. State the food relationship once, then describe each neighboring cell in a separate sentence. Do not insert candidate outcomes or a preferred direction.
2. Give each fixed direction a description of the relation it represents, following Flappy's descriptive criteria. An experimental perception-style question could be **Which direction has empty space toward the food?** The model's selected direction would still be applied directly. This remains harder than Runner because it combines two facts and offers no explicit answer when progress is blocked; it is a hypothesis, not a proven fix.
3. Separate wording quality from option-position effects. Compare balanced presentations; upstream's averaging technique preserves a model-derived choice without adding a pathfinding policy. Implementing it would require updating Snake's answer aggregation, feed and recording format for multiple questions per request.
4. Judge prompts on fixed positions covering food in every direction, blocked food-side cells, diagonals and reversal situations. Include positions where detouring is necessary. A high score from one random run cannot identify whether a prompt understands these cases. Testing remains with the user unless requested otherwise.

Example state for the first recommendation:

```text
The snake is heading left.
The food is above and to the left of the head.
The cell above the head is empty.
The cell to the right of the head contains the snake's body.
The cell below the head is empty.
The cell to the left of the head is empty.
```

Example fixed criteria for the second recommendation (the other directions should be symmetric):

```json
{"up": "empty space above the head, with food above the head"}
```

These descriptions are static rules for interpreting the state, not labels dynamically populated with a computed best move. They may still fail when the best action requires a detour or longer planning. Reliable direct play may ultimately require Snake-specific training rather than further prompt compression.

## Implementation follow-up

The user approved implementing recommendations 1–3. Snake now uses the complete fact sentences, the descriptive direction criteria and relation question above, plus four balanced option-order questions in one request. Steering and the feed use their mean probabilities. The recorder retains every distribution for faithful replay. Once-per-position gating and normal game rules remain. Testing continues with the user; implementation alone is not evidence of improved play.

The matching recorded demo contains 206 requests over 60 simulation seconds, best score 3 and 16 crashes, with 12.9 ms median model latency. Frequent crashes remain in this sample; the implementation is not evidence of improved gameplay. No test suite or browser verification was run.

## Tested fix after persistent failures

The user subsequently requested real-model tests. The earlier balanced compound question reproduced poor gameplay. Prompt variants, checkpoint comparisons and seeded games established stronger results from a food-position perception question, with occupancy sentences first, compass heading and food position last. Reversal is omitted from the options. An explicit playable-direction filter excludes immediate wall/body collisions before selecting the largest model probability. Raw probabilities and exclusions remain visible. Model-controlled steps wait for a fresh answer, including under delayed inference. This supersedes the four-order averaging experiment.

The improvement comes from both question design and game constraints, not prompt wording alone. See [the measured validation](snake-validation.md) for baseline, matched and held-out results. No candidate outcome or computed preferred route is sent; no pathfinder prevents eventual body enclosure.

## Direct-choice requirement restored — 2026-10-06

The user rejected reversal-option removal and controller filtering. The historical v5 policy kept all four action labels and applies the actual returned choice. The prompt explains heading and the no-reversal rule as continuing forward or turning sideways. This wording avoided reversal in 39 fixed cases and six 30-second seeded games, but food seeking and collision avoidance remain weak. The earlier heading-heavy prohibition also avoided reversal while mostly driving straight into walls. Constraint filtering is not a substitute for the requested model decision. See [v5 tests](snake-model-choice-validation.md); previous v4 guarded results are historical.


## Stock checkpoint, four grounded options — 2026-10-07

The user explicitly requires the stock checkpoint, all four options, and direct application of the model's returned choice. The current v6 policy meets those requirements without a runtime safety layer.

Further primary-source research found [upstream issue 377](https://github.com/NandhaKishorM/laya/issues/377), which reproduces negated cancellation instructions being ignored by both stock checkpoints in particular examples. [Question documentation](https://github.com/NandhaKishorM/laya/blob/main/docs/questions-and-answers.md) also describes limits around labels, input budgets and negation. This evidence does not establish universal negation failure, but it explains why repeating “cannot reverse” was an unreliable approach here.

Inspection of installed Laya 0.3.28 `common.py` confirms that question instructions, option labels/descriptions and state all enter the encoder: the rule was not silently dropped. Each option has a 48-token cap and English shared head context has a 192-token budget. Evaluated v6 inputs report no truncation. A related [browser-agent input-layout guide](https://github.com/NandhaKishorM/laya/blob/main/docs/finetune_browser_agent.md) puts actionable local facts on options; its fine-tuning results alone do not establish stock-model performance, so the Snake approach was tested locally.

The effective layout places only the food relation in state and binds current neighboring-cell facts to all four direction descriptions. Empty neighbors use “open passage above the head” and equivalent bearings. Blocked neighbors use “obstacle, wall”, “obstacle, snake body” or “obstacle, reverse into the neck”. The direction key remains, but redundant directional wording inside blocked descriptions is omitted. The question is “Which open direction is toward food?” This gives the encoder a short, positive matching task while the unsuitable choices remain present and scored.

On 39 fixed positions, a grounded preference variant gave 33 safe/progress choices and 3 reversals; neutral option IDs mostly failed to improve it. The selected wording gave 39 safe/progress choices and no reversals, versus v5's 34 safe and 17 progress choices. Adding heading back into the grounded variant reduced progress to 16/39, an observed wording effect rather than a proven explanation of the encoder's internals. Removing redundant bearings from blocked descriptions was useful in these trials, but is not a general prompting theorem.

The exact production policy was then checked on matched seeded games, five held-out seeds and delayed inference. All options and raw choices remained intact. See [v6 results and reproducible tests](snake-grounded-options-validation.md). Local cell annotation is the translation layer; it does not evaluate routes or supply a best direction. A research Snake-trained checkpoint was investigated in isolation and stopped; it is not used by the playground.
