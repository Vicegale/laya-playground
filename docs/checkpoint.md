# Document checkpoint

The Papers, Please-inspired desk lives at `/#checkpoint`. Choose Easy, Medium or Hard to increase document count and cross-check complexity. Easy starts with passport, permit and declaration; Medium adds identity supplements and work passes; Hard adds access permits, vaccination and identity records, diplomatic authorizations and asylum grants. The default Easy shift has 1,000 generated travelers. See [difficulty rules and model boundaries](checkpoint-levels.md). The original twelve-arrival deck remains available as the recorded demo.

## Play

Start the existing server with `.venv/bin/python server.py` and open <http://127.0.0.1:8770/#checkpoint>. The English checkpoint must be ready for live inference. The game starts idle: **Inspect documents** inspects one traveler; **Auto-run shift** advances after a configurable reading interval and pauses when offscreen or the browser tab is hidden. **Next traveler** advances after a stamp; **New shift** resets the score.

**You inspect** enables Approve / Deny / Review, also available on A / D / R while the game is visible. Correct inspections earn 10 points, incorrect stamps earn a citation and lose 5, and secondary review earns no points. **Edit the documents** changes wording or exact fields; edited arrivals are unscored because arbitrary user text has no fixture answer key.

## Random shifts

Choose a difficulty above **Shift generator**, then choose the shift length (1–10,000), invalid-document chance (0–100%), seed and fault variation. **Start shift** restarts the entered seed with those settings. **New shift** uses a fresh random seed with the same settings. The same seed and settings reproduce the same sequence, including arrival order and defects. Invalid chance is a probability per traveler, so a 50% setting will not always produce exactly half invalid arrivals.

`static/demos/checkpoint-generator.js` constructs each arrival from its seed and index, without allocating a deck. Inspection history retains at most fifteen completed packets, independent of shift length. The generator combines 32 first names and 32 surnames, ten countries, unique passport numbers within a shift, valid calendar dates, jobs, employers, courses, destinations, attractions and authored paraphrases. It uses eight permit and declaration templates per purpose and six positive/negative employer-letter templates, filled with random details. This is template generation, with no extra model call.

The Easy level has twelve primary fault families: missing passport, missing permit, expired passport, expired permit, future permit, holder mismatch, passport-number mismatch, purpose mismatch, missing employer letter, unsigned letter, withdrawn employment and an impossible calendar date. Letter faults construct a work visit. Easy uses one fault; Medium and Hard introduce 25 and 36 primary families and can add up to two compatible identity/number/expiry faults. They include biometrics, work authorization, seal codes, stay allowances and hard-level health/exception faults. Valid cases agree semantically and pass all exact checks. Constructed purpose/employment labels are used only for scoring, never to supply Laya's readings or admission outcome.

For large live runs, enable **Instant advance** beside the auto-run controls. It removes the reading delay and starts the next traveler when the current inspection completes. Turn it off to use the selected normal reading pace again. Requests remain sequential, with no accumulated request queue; the visible desk and score update for every traveler. Offscreen/hidden-tab pausing still applies. Stop auto-run to change shift settings while a shift is running.

## Recent inspections

Below the desk, **Recent inspections** keeps the last five **Approved**, five **Denied** and five **For review** results for the current shift, newest first. Both Laya and human inspections appear with their source and grading outcome. Results are grouped by the actual stamp, so an incorrect approval remains in Approved and is marked as a citation.

Expand an arrival to see its saved decision reasons, submitted papers (including missing documents), exact code checks, model readings and probability distributions, and raw inputs/responses. These are detached snapshots, captured before instant advance; moving to another traveler or editing current papers does not alter them. Existing expanded entries stay open until they age out of their five-entry list. Starting a new shift or changing difficulty clears the history. History lives in memory and also clears on page reload.

Verify snapshot isolation and bounded storage with `node tools/check_checkpoint_history.mjs`.

## Throughput

The throughput panel counts completed **Laya traveler inspections**, not individual document calls or human stamps. It shows total, correct, incorrect (citations) and reviewed inspections per minute, alongside their actual counts. Total includes secondary review and any edited, unscored practice inspections; those are not counted as incorrect. Live, recorded or mixed responses are labeled explicitly, so replay speed is distinguishable from live inference speed.

Rates are the average for the current shift: `completed count × 60,000 / active elapsed milliseconds`, measured with `performance.now()`. Active time includes model requests, network/frontend overhead, and any intentional reading delay during auto-run. Paused/offscreen/hidden-tab idle time is excluded; an already pending request remains timed until it completes. Manual **Inspect documents** calls add their actual active duration. Stopping or finishing freezes the rates; restarting/resuming adds to the accumulated active time, while a new shift resets all counts and time. This measures the desk's end-to-end throughput, rather than GPU-only inference latency.

The clock and grading-accounting checks can be run with:

```bash
node tools/check_checkpoint_throughput.mjs
```

Verify generator reproducibility, all fault types, construction truth and absence of answer-key leakage with:

```bash
node tools/check_checkpoint_generator.mjs
```

The 10,000-arrival structural check is separate from model accuracy. A historical smoke sample of 200 original generated travelers completed 449 calls without truncation and produced 182 correct stamps, 17 reviews and 1 citation. These are demonstration checks, not an independent accuracy benchmark.

## Translation and calls

`static/demos/checkpoint.js` preserves the original deck and delegates difficulty packets to `static/demos/checkpoint-levels.js`. Document schemas, full printed inputs, per-level exact checks and model-reading comparisons live there; `checkpoint-level-generator.js` constructs the new packets. `static/checkpoint.js` renders those data and orchestrates the calls through the existing `predict` helper and `/api/predict` endpoint. No server changes or dependencies are needed for this game.

The original deck has three translation layers. Difficulty packets send full printed fields and add country, appearance, work field, entry status, vaccination coverage and alias-confirmation questions; see [the new translation](checkpoint-levels.md#what-the-model-does).

1. **Printed text → typed readings.** The permit asks which kind of visit is permitted; the declaration asks the visit's purpose. Both use the English checkpoint's `choice` question with work, tourism, transit and study criteria. A supplied employer letter asks a `noul` question about paid employment. Each document produces its own request with `model: "english"` and `lang: "en"`.
2. **Exact fields → code checks.** Holder names and passport numbers are compared with trimming, case folding and Unicode normalization. ISO calendar dates are validated and compared against the fixed scenario date, 6 October 2026. These checks are shown separately and can highlight the relevant fields.
3. **Readings + checks → admission.** Failed formal checks deny entry. A purpose probability below the default 60% threshold routes to review; different permitted and declared purposes deny entry. Work requires a signed letter and a sufficiently confident positive employment reading. Otherwise entry is approved. The threshold is adjustable and is a demo policy, not a calibrated assurance of accuracy.

The policy uses actual model answers. The fixture annotations only grade the final stamp; they never enter model input or admission logic. Expand **Documents → model input** and **Raw model responses** to inspect the full boundary. The papers use structured printed text, not screenshots or OCR.

## Static recordings

Without `/api/health`, choose **Shift generator → Recorded demo → Start shift** to use the original twelve arrivals from `static/data/checkpoint.json`. Human play on random documents works offline. The desk matches the exact serialized semantic requests before replaying an answer and clearly labels the source as recorded. Editing a name or date can reuse an unchanged recorded text reading, while changing text requires a live model. New wording never silently receives another fixture's answer.

To regenerate from a running local server:

```bash
LAYA_API=http://127.0.0.1:8770 MACHINE="your hardware" node tools/record_checkpoint.mjs
node tools/check_checkpoint.mjs
```

The recorder warms the model and saves the actual outputs, input fingerprints, version, hardware label, timing and aggregate results. It rejects truncated inputs. The current recording used Laya 0.3.28 on NVIDIA RTX 5080 CUDA: 28 document calls, a median 12.7 ms per document, 10 correct inspections, 1 review and 1 citation. This small authored deck is a demonstration, not an accuracy benchmark.

## Limits exposed by the demo

Whole-document trials were unreliable for exact holder-name matching, so that comparison is explicit code. Separate purpose questions worked better than asking the model to compare all the papers at once. The study permit currently receives less than 60% confidence and is reviewed. The withdrawn job offer is incorrectly interpreted as confirming employment and earns a citation; the game preserves that actual model error rather than replacing it with the fixture truth.

This is an English-language scenario on a fixed inspection date. Difficulty packets add registered aliases and diplomatic/asylum exemptions; the exact adaptations are described in [the level notes](checkpoint-levels.md). Printed seal and fingerprint codes are compared symbolically; the game does not inspect images or authenticate physical documents. It does not implement OCR, multiple-purpose ordinary permits, actual immigration rules, a campaign or model training. New generator wording can extend the template pools while keeping constructed labels consistent with the printed meaning. Regenerate the recorded demo whenever its semantic input changes; random shifts always use actual live inference or matching recorded text, without generated mock answers.

The new per-level real-model evaluation covers 600 travelers and 2,667 document calls; [results and parsing breakdown](checkpoint-levels-validation.md) retain errors and reviews.

The later [entry-status prompt comparison](checkpoint-entry-validation.md) reduces ordinary-entry uncertainty on the stock checkpoint while keeping all three statuses and the 60% threshold. It includes matched full-inspection results and the existing purpose error exposed by the more confident status reading. Review messages now show the selected answer and probability.
