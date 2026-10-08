# Document difficulty levels

At `/#checkpoint`, choose **Easy**, **Medium** or **Hard** above the shift generator. Changing level starts a new shift with the current seed and resets scores and throughput. Each level supports 1–10,000 lazy, reproducible arrivals, human inspection, edited practice papers, live stock English Laya calls and instant auto-advance. Easy is the default. The original twelve-case recorded demonstration remains selectable under **Shift generator**.

## Progression

Counts below describe complete packets; faults can remove required documents.

| Level | Papers | Documents and cross-checks | Primary fault families |
| --- | --- | --- | --- |
| Easy | 3–4 | Passport, entry permit, arrival declaration; employment letter for work. Names, passport references, validity dates and purpose agreement; signed, confirmed employment. | 12; one fault per invalid arrival |
| Medium | 4–6 | Adds identity supplement and work pass. Issuing-city and seal registers, stay allowance, measured height/weight, appearance readings, employer and occupational-field agreement. | 25; one or up to three compatible faults |
| Hard | 5–7 | Access permit replaces entry permit and identity supplement for ordinary visits. Adds vaccination certificate and identity/alias record. Diplomatic authorization or asylum grant replaces the access permit on those routes. Destination/nationality checks, asylum birth date and fingerprints, registered aliases, current polio coverage and the previous employment checks. | 36; one or up to three compatible faults |

Every level has its own visible rulebook. Medium and Hard expose an **Authority register** with allowed issuing cities and printed seal codes. Different paper colors and titles distinguish the new documents. All printed fields can be edited, including lists of registered aliases and diplomatic destinations; edits are unscored practice.

The generator builds valid packets and then injects faults appropriate to the level and route. Work faults force a work visit; diplomatic/asylum faults force the relevant authorization. Further faults affect independent fields, so they cannot erase the primary defect. Valid hard packets sometimes use a registered alias, or legitimately omit an ordinary permit under a diplomatic/asylum exception. These valid exceptions exercise more than blanket rejection of unfamiliar papers.

## What the model does

Every submitted paper is sent separately, with its full printed fields and short typed questions, to the existing **stock English checkpoint**. No OCR, model training, hidden answer key or generated mock response is used. Multiple questions about the same paper share one request. Separating papers keeps long packets within the encoder's input budget; the demo does not ask it to reason over one concatenated packet.

| Paper | Typed reading |
| --- | --- |
| Passport | Issuing country |
| Permit / access permit | Authorized purpose; access-permit appearance |
| Arrival declaration | Purpose; medium/hard appearance; hard entry status |
| Identity supplement | Hair/appearance profile |
| Work pass | Occupational field |
| Employer letter | Paid-employment confirmation and medium/hard occupational field |
| Diplomatic authorization / asylum grant | Authorized entry status |
| Vaccination certificate | Polio coverage versus another vaccine only |
| Identity record | Same-person alias confirmation versus different identities |

Admission compares actual model readings across the submitted papers. The adjustable 60% threshold can send uncertain necessary readings to review. Confident semantic disagreements deny entry; a known discrepancy is sufficient even if an unrelated reading is uncertain. Diplomatic/asylum routes do not require ordinary-purpose or employment readings.

Hard entry status uses the question “Which type of entry is described?” and short positive descriptions of ordinary civilian travel, official diplomatic service and asylum. Each remains an available model choice; the access permit never supplies the declaration's answer. Low-confidence messages show the selected reading and probability. [Prompt comparison and full-admission results](checkpoint-entry-validation.md) show the improvement and remaining model errors at the unchanged 60% threshold.

Code explicitly checks exact names and passport references, dates, stay arithmetic, physical measurements, printed city/seal codes, destination lists and fingerprint-code equality. The alias list can resolve a name mismatch only within a linked identity record whose model reading confirms a single identity and whose fingerprint code matches the arrival record. The **Documents → model input**, **Raw model responses** and exact-check panels expose these boundaries. Printed fingerprint/seal codes are symbolic test data; they do not imply visual authentication. Appearance comes from written descriptions, not portraits.

Construction annotations are used only for scoring. Altering them cannot change the requests or runtime decision. A wrong model reading can produce a citation on otherwise valid documents; uncertainty and errors remain visible.

## Inspiration and deliberate adaptations

Reviewed the [official game site](https://papersplea.se/), [official press kit](https://papersplea.se/presskit/) and [Lucas Pope's development-log index](https://dukope.com/devlogs/papers-please/). The developer describes document inspection and fingerprint evidence as core tools. Detailed document fields and exception rules were cross-referenced against the [community document reference](https://papersplease.fandom.com/wiki/Category:Documents), [vaccination reference](https://papersplease.fandom.com/wiki/Certificate_of_Vaccination) and [document-inspection guide](https://steamcommunity.com/sharedfiles/filedetails/?id=168642147).

The original game escalates paperwork across campaign days; these three levels are our own test profiles. Entry/identity/access permits, work passes, diplomatic authorizations, asylum grants, alias evidence and vaccination records inspire the progression. This scenario keeps the existing fictional Aster setting and original document artwork. It adds a written arrival declaration and employer letter to test semantic consistency, requires identity records for every Hard traveler, and uses visible codes for seals/fingerprints. It does not reproduce the game's campaign, all national exceptions, search mechanics, or original assets.

## Validation

`node tools/check_checkpoint_levels.mjs` checks 10,000 packets per level: reproducibility, valid/invalid truth, every primary fault, three exception routes, no scoring-label leakage, model-dependent decisions and required-document exceptions. The original checkpoint/generator/throughput suites remain available.

`node tools/evaluate_checkpoint_levels.mjs --cases 200 --seed final-heldout-20261007 --out /tmp/levels.json` performs real stock-model calls, grading individual readings separately from admission. It retains raw requests and responses for every reviewed or incorrect case. See [measured results](checkpoint-levels-validation.md).
