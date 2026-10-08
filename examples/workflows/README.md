# Email classification example

Import **emails-by-type.json** in `/workflow.html`, then click **Run** and
**Download CSV** on **Export sorted emails**. The JSON embeds the sample input,
so it works immediately. To use another file, select **Read emails CSV** and
choose a UTF-8 CSV with the same column names.

**emails-input.csv** contains exactly 100 lines: one header and 99 synthetic
email records. The columns are `id`, `from`, `subject`, and `body`. All addresses
use the reserved example.com domain. The messages are interleaved across
support, billing, sales, feature requests, spam, and other correspondence.

The flow reads the CSV, runs a nested Map with **Keep original fields**, asks
Laya to classify each subject/body, and adds `email_type` and `confidence`.
CSV Output exports **emails-sorted-by-type.csv**, sorted by `email_type` ascending.
Emails with the same type retain their original order. The original input file
is preserved.

The category values are `billing`, `feature_request`, `other`, `sales`, `spam`,
and `support`. Confidence is the runtime's Laya decision confidence. Actual
stock-model validation on 2026-10-08 completed 99 decisions/300 traced steps,
exported all 99 unique IDs with unchanged original cells and stable alphabetical
category groups. Labels matched 88 of the 99 intended sample categories; this
example preserves model answers without corrections.
