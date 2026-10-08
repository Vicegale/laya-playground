# Entry-status prompting — 2026-10-07

The Hard level asks stock **English Laya 0.3.28** to distinguish ordinary civilian entry, diplomatic service and asylum. The previous ordinary description combined four purposes with the abstract phrase “as an ordinary traveler.” Work and transit declarations often chose the correct answer below the game's 60% threshold. Improving this reading does not make Laya choose the final admission stamp: the existing admission code still cross-checks its actual readings and exact document fields.

The new question is **“Which type of entry is described?”**, with these three options on every applicable paper:

| Option | Description |
| --- | --- |
| Ordinary | Ordinary civilian travel for personal reasons or a paid job. |
| Diplomatic | Official diplomatic service at an embassy. |
| Asylum | Refugee protection and asylum. |

All printed fields, the stock weights and calibration, the three choices, and the 60% review threshold remain in place. There is no document-type shortcut to infer the declared status, probability adjustment, option removal, or retry/extra inference pass. The declaration and diplomatic/asylum authorizations use the same question wording.

## Prompt comparison

Two development sweeps compared twelve distinct wordings/layouts on 111 printed-document requests each, including independently authored declarations. Moving the statement ahead of other printed fields worsened the tested readings and was rejected. The selected wording produced 111 correct statuses and no entry-status reviews on that development set.

A separate seed, `entry-heldout-20261007`, supplied **800 readings**: 100 ordinary declarations each for work, study, tourism and transit, plus 200 diplomatic and 200 asylum readings split between declarations and authorizations. These are unseen generated packets with shared template pools, not an independent real-document benchmark.

| Reading group | Cases | Previous reviews | New reviews | Previous correct choices | New correct choices |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary work | 100 | 66 | 0 | 100 | 100 |
| Ordinary study | 100 | 8 | 0 | 100 | 100 |
| Ordinary tourism | 100 | 0 | 0 | 100 | 100 |
| Ordinary transit | 100 | 22 | 2 | 100 | 100 |
| Diplomatic | 200 | 0 | 0 | 200 | 200 |
| Asylum | 200 | 0 | 0 | 200 | 200 |
| **Total** | **800** | **96** | **2** | **800** | **800** |

Reviews here mean that the selected entry-status probability is below 60%, even when the choice is correct. Both variants made zero confidently wrong status choices and reported zero truncation. Other admission readings are not included in this table.

A final 119-reading check uses the production translator directly. It includes 23 manually authored/screenshot declarations, including civilian work at an embassy, paid diplomatic service, and asylum declarations mentioning later work/study. The old wording yielded 117 correct choices/18 low-confidence readings; production yielded 119 correct/0 low-confidence readings. The user-provided physician declaration's printed fields were reproduced in a dedicated request. Its raw probability distributions are retained in the [validation data](data/checkpoint-entry-validation.json).

## Full admissions and remaining errors

An explicit live baseline and production replay each inspect the same **200 complete Hard packets**, seed `final-heldout-20261007`, with 108 valid and 92 invalid travelers. Each reads 1,091 supplied documents using the stock model. All reported no truncation. All per-question winning-answer accuracy counts are identical between variants; only the entry-status prompt changes.

| Full inspection result | Previous prompt | New prompt |
| --- | ---: | ---: |
| Correct stamps | 137 | 147 |
| Incorrect stamps / citations | 2 | 3 |
| Secondary reviews | 61 | 50 |
| Reviewed arrivals with uncertain entry status | 24 | 3 |

The additional citation is **arrival 44** (zero-based index 43), a valid study visit. Both variants read its purpose incorrectly as work at 64.65%; the old ordinary-status reading at 56.85% stopped the dependent purpose/work checks with review. The new ordinary reading at 82.73% enables those checks, which deny for absent employment papers. This existing purpose error is preserved in the result and raw outputs. No fixture answer replaces it.

Appearance readings are still the main source of reviews. Once ordinary entry clears, more dependent appearance/purpose checks run, so the reduction in total reviews is smaller than the reduction in entry-status uncertainty. Review messages now name the reading, selected answer and probability, e.g. `Arrival declaration: entry status needs review (Ordinary entry: 59.00%; below 60%).`

The [raw validation artifact](data/checkpoint-entry-validation.json) retains sweep summaries, all low-confidence held-out comparisons, representative successful comparisons, independently authored/screenshot cases, and full reviewed/incorrect admission requests and responses for both variants.

## Reproduce

```bash
node tools/evaluate_checkpoint_entry.mjs --variants baseline,current --per-group 100 --seed entry-heldout-20261007 --no-extra --out /tmp/entry-heldout.json
node tools/evaluate_checkpoint_entry.mjs --variants baseline,current --per-group 12 --out /tmp/entry-authored.json
node tools/evaluate_checkpoint_levels.mjs --levels hard --cases 200 --seed final-heldout-20261007 --entry-prompt baseline --out /tmp/entry-baseline.json
node tools/evaluate_checkpoint_levels.mjs --levels hard --cases 200 --seed final-heldout-20261007 --out /tmp/entry-current.json
node tools/check_checkpoint_levels.mjs
```

Policy regressions cover genuine low-confidence ordinary review, a confident wrong status causing denial, all three available options, the exact 60% acceptance boundary, and the existing document/annotation boundaries. Native browser checks confirm the production prompt and actual probabilities, human-readable uncertainty reasons and retained inspection history.
