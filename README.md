# Laya playground

A website, five games, a benchmark and an agent skill for [Laya](https://github.com/NandhaKishorM/laya), the open-source decision model: typed questions in, real probabilities out, one forward pass, no generated text. It runs on your own machine.

The live site is at **[brainfunctioncollapse.com/laya](https://brainfunctioncollapse.com/laya)**. It has no model behind it and replays recorded runs. Clone this repository and the same pages run against the real model.

Laya is created by [Nandakishor M](https://github.com/NandhaKishorM) of Convai Innovations. This repository is not his and does not contain the model: it installs his package and downloads his open weights.

## Run it

```bash
git clone https://github.com/wdobry/laya-playground
cd laya-playground
uv venv --python 3.12 && uv pip install laya
.venv/bin/python server.py
```

Then open <http://127.0.0.1:8770>. The first start downloads 2.3 GB of open weights and takes about 90 seconds to load them. Apple silicon, NVIDIA or plain CPU.

You get the whole site, live:

- `/` the landing page, where the model plays Flappy, a lane runner, Tetris and Snake itself, about 30 decisions a second
- `/#snake` classic Snake: Laya chooses a direction from the current state, or you steer with arrow keys, WASD or on-screen arrows
- `/#checkpoint` the document inspection desk: compare permits, travel declarations and employer letters, with live Laya readings or human stamping
- `/playground` the editor: write some text and a few typed questions, see every answer with its probabilities, compare all three checkpoints
- `/workflow.html` the visual workflow editor: connect decisions, switches, exact rules, maps, filters, grouping, CSV files, loops and nested subflows, with fan-out branches and joins, scoped field picking, column cleanup/mapping, undo/redo, node duplication, linked library versions and saved templates; see [editing controls](docs/workflow-editor.md)
- `/about` why this exists

The web server itself is the Python standard library and binds to loopback, so nothing is reachable from your network. The only dependency is `laya`.

### Classify a question

Ask the English checkpoint whether a question is `technical`, `product`, `billing`, or `other`, without starting the server:

```bash
.venv/bin/python tools/classify_question.py "How do I fix this Python error?"
.venv/bin/python tools/classify_question.py --offline < question.txt
```

The script accepts a text argument or stdin and prints the complete model response as JSON, including the selected category and every option's probability. Use `--offline` once weights are cached.

### Document checkpoint

Open <http://127.0.0.1:8770/#checkpoint>. Choose **Easy**, **Medium** or **Hard**; the default Easy shift has **1,000 randomly generated travelers**. Expand **Shift generator** to choose 1–10,000 arrivals, the chance of invalid papers, one or multiple faults, and a replayable seed. **Start shift** uses the entered seed; **New shift** rerolls it. Easy has 3–4 papers and 12 fault families. Medium has 4–6 papers, identity supplements and work passes, and 25 families. Hard has 5–7 papers with access permits, health/identity records, diplomatic and asylum exceptions, and 36 families. Names, IDs, dates, employers, wording and valid exceptions vary.

Inspect one traveler, auto-run the shift, or choose **You inspect** and stamp with A / D / R. Enable **Instant advance** beside auto-run to remove the reading delay for throughput tests. The throughput panel shows total, correct, incorrect and reviewed travelers per active wall-clock minute; paused time and human stamps are excluded. **Edit the documents** lets you test different wording and fields as unscored practice cases.

The desk renders the same printed text sent to Laya. The stock English model reads country, purpose, appearance, occupational field, entry status, vaccination coverage and identity statements from separate full-paper inputs. The admission policy cross-checks those actual readings; code handles exact names, IDs, dates, measurements and printed seal/fingerprint codes. Probabilities, highlighted discrepancies, model latency and the full API payloads are visible. This uses structured text, with no OCR step.

A static server supports human play on random shifts. Choose **Shift generator → Recorded demo → Start shift** for the twelve recorded arrivals. Matching document text uses real recorded answers and labels them as recorded; new wording needs the local model. Model errors earn visible citations. See [difficulty rules and inspiration](docs/checkpoint-levels.md), [real-model test results](docs/checkpoint-levels-validation.md) and [the implementation notes](docs/checkpoint.md).

### Snake

Open <http://127.0.0.1:8770/#snake> to watch the English model play. It receives the food position and four option descriptions grounded in their neighboring cells: open passage, wall, body or reversal into the neck. All four choices — up, right, down and left — stay available. The controller applies the returned direction directly, with no probability filtering or substitute move. Normal Snake physics rejects reversal into the neck; wall/body choices cause collisions. The feed shows the exact option descriptions, all four probabilities and the actual choice. Each step waits for a fresh answer. See [the grounded-option test results](docs/snake-grounded-options-validation.md) for measured improvements and remaining model mistakes.

Choose **You play** for arrow keys or WASD, with on-screen arrows available on phones. Space restarts after a crash; otherwise a new life starts automatically. Pause/resume works in both modes. Static hosting replays a real model run. See [the Snake implementation notes](docs/snake.md).

Use **Simulation speed** (0.1×–2×) to change game time immediately. Snake waits for the model if inference takes longer than the movement interval, so an old answer cannot carry it through additional cells.

### Without the model

Any static file server shows the recorded version, exactly as the public site does:

```bash
python3 -m http.server 8771 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8771>. The games replay real recorded decisions and say so; the playground answers its presets from recordings.

## The agent skill

One file teaches a coding agent to add Laya to a project properly: the API, questions that work, thresholds, calibration, and the traps found building this site.

```bash
mkdir -p .claude/skills/laya-integration && curl -fsSL https://brainfunctioncollapse.com/laya/skills/laya-integration/SKILL.md -o .claude/skills/laya-integration/SKILL.md
```

Claude Code reads `.claude/skills` natively. Any agent that accepts a markdown instruction file can use [the file](skills/laya-integration/SKILL.md) as it is.

## The benchmark

Laya and TypeSafe AI's hosted Jev, on the same 500 labelled examples with the same questions and no tuning. Jev is more accurate out of the box. Laya matches it on simple questions, answers several times faster from a laptop, is free, and is yours to fine-tune. The numbers on the site are rendered from [`static/data/versus.json`](static/data/versus.json), never typed by hand.

To reproduce it:

```bash
.venv/bin/python eval/build_dataset.py                       # rebuilds the sampled texts from their public sources
.venv/bin/python server.py                                   # Laya, local: leave it running in another terminal
TYPESAFE_API_KEY=... .venv/bin/python eval/run_eval.py       # writes static/data/versus.json
```

Two of the source datasets restrict redistribution, so the sampled texts and the raw API responses are not in this repository. `eval/provenance.json` records where every example comes from. The harness only measures: nothing from Jev is ever fed into Laya.

## What is in here

| Path | What it is |
| --- | --- |
| `server.py`, `poc.py` | the local model server and the proof of concept it grew from |
| `index.html`, `about.html`, `playground.html` | the three pages |
| `static/` | styles, scripts, and the recorded data the public site replays |
| `static/demos/` | the four arcade simulations and the document checkpoint's fixtures, translation and admission policy |
| `static/checkpoint.js`, `static/checkpoint.css` | the document desk, inspector controls, live calls and recorded-answer fallback |
| `static/demos/checkpoint-generator.js` | lazy seeded generation of large shifts with varied valid and invalid documents |
| `skills/laya-integration/SKILL.md` | the agent skill |
| `eval/` | the benchmark: dataset builder, tasks, runner |
| `tools/` | recorders for the replays, and small site checks |

Tools worth knowing:

- `tools/record_run.mjs` records a real model-driven game run (`ONLY=tetris` records a single game); `tools/verify_replay.mjs` checks a recording replays identically
- `tools/check_checkpoint_levels.mjs` checks 10,000 packets per difficulty, every fault family and the model/code boundary
- `tools/evaluate_checkpoint_levels.mjs` measures stock-model parsing and admission on all three document levels
- `tools/check_snake.mjs` checks Snake movement, growth, collisions, controls and deterministic replay
- `tools/evaluate_snake.mjs` runs fixed-position and seeded headless tests against the real model; `--previous` reproduces the v5 prompt with identical game physics (`--baseline` retains the older v3 policy)
- `tools/record_presets.py` records the playground's preset answers
- `tools/record_checkpoint.mjs` records real document readings; `tools/check_checkpoint.mjs` verifies admission policy, translation and recording fidelity
- `tools/check_checkpoint_generator.mjs` checks 10,000 generated cases for grading truth, reproducibility, variety and answer-key isolation
- `tools/check_checkpoint_throughput.mjs` checks wall-clock rate accounting, pauses, outcome categories and resets
- `tools/build_nav.py` stamps the one shared top bar into every page; `tools/build_faq.py` regenerates the FAQ structured data from the visible Q&As
- `tools/check_widows.mjs` fails if any text block ends on a single word, at three widths

## Credits

**Laya** is created by [Nandakishor M](https://github.com/NandhaKishorM) (Convai Innovations) and released under Apache-2.0: [code](https://github.com/NandhaKishorM/laya), [weights](https://huggingface.co/convaiinnovations/laya), [the original paper](https://arxiv.org/abs/2503.23303), [the follow-up](https://arxiv.org/abs/2510.01237). If Laya is useful to you, support its author.

This playground, the Laya vs Jev benchmark and the agent skill are by [brain function collapse](https://brainfunctioncollapse.com).

Not affiliated with or endorsed by TypeSafe AI. Jev is their product, named here only to compare.

## Licence

[MIT](LICENSE) for everything in this repository. Laya itself, its code and its weights, is Apache-2.0 and belongs to its author.
