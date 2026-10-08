# Checkpoint level validation — 2026-10-07

These results use the original entry-status prompt. The later [entry-status comparison](checkpoint-entry-validation.md) records the current prompt, its separate held-out tests and a matched full Hard replay; this historical artifact remains unchanged.

Real stock **English Laya 0.3.28**, RTX 5080 CUDA. The final sample uses seed `final-heldout-20261007`, 200 travelers per difficulty, 50% invalid chance and the default 60% review threshold. Cases are lazy and deterministic; Easy injects one fault, Medium/Hard permit one to three. Every supplied document is read even when a formal failure already establishes denial. No answer keys are supplied to the model or admission policy.

| Level | Correct stamps | Incorrect stamps | Secondary reviews | Document calls | Correct typed readings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 186 | 0 | 14 | 649 | 647/649 |
| Medium | 143 | 1 | 56 | 927 | 1,172/1,195 |
| Hard | 137 | 2 | 61 | 1,091 | 1,501/1,558 |

Each level contained 108 valid and 92 invalid arrivals. Reviews are neither correct clearances nor incorrect stamps. Stamp counts combine exact code checks and model interpretations; they are **not model-only accuracy**. Typed-reading counts grade the raw winning answer before the review threshold, separately from admission. A withdrawn letter supplies no meaningful current job field, so its sector answer is excluded from this reading metric. All other questions are graded, including ones whose formal discrepancy makes the final verdict independent of that answer.

All **2,667 calls reported no truncation**; the largest reported input usage was 408 tokens. [Full results](data/checkpoint-levels-validation.json) include per-question counts and raw requests/responses for all reviewed and incorrect arrivals. This is a small local generator evaluation, not a calibrated assurance or independent real-document benchmark.

Country and exception-route readings were strong in this sample. Appearance interpretation is the main weak point: Medium declaration appearance was 184/200; Hard declaration appearance 123/141 and access-permit appearance 109/134. Hard identity-record interpretation was 195/198 and vaccination coverage 198/199. The game preserves those errors and low-confidence readings. The comparison uses different document layouts and fault pools, so it should not be interpreted as a controlled causal measurement of document count alone.

Structural checks separately covered **10,000 packets per level**, all 12/25/36 primary fault families, constructed valid/invalid truth, aliases, all three hard entry routes, seed replay and mutable-data isolation. Altering generator annotations or packet ordering cannot affect model requests or runtime admission. A regression intentionally supplies a wrong model reading on valid documents and confirms it changes the verdict. Diplomatic exemptions correctly allow absence of an ordinary permit. The original 10,000-case generator test, twelve recorded cases, throughput suite and all arcade replays remain intact.

Native browser checks confirmed seven Hard papers and eleven typed questions on a work packet, live inspection with actual responses, repeatable seed configuration, and a twelve-arrival instant-advance shift with matching throughput counts (8 correct, 1 citation, 3 reviews). Desktop 1280×800 and mobile 390×844 have no horizontal overflow. Offline original recorded inspection remains available; offline Hard human stamping and edits to vaccine text and the signed checkbox work, edited practice is unscored and human decisions do not enter model throughput.

Reproduce:

```bash
node tools/check_checkpoint.mjs
node tools/check_checkpoint_generator.mjs
node tools/check_checkpoint_levels.mjs
node tools/check_checkpoint_throughput.mjs
node tools/evaluate_checkpoint_levels.mjs --cases 200 --seed final-heldout-20261007 --out /tmp/levels.json
```

See [level rules, inspiration and implementation boundaries](checkpoint-levels.md).
