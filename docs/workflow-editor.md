# Workflow editor

Open `/workflow.html` with the local server running. Build graphs with Input,
Decision, Condition, Switch, Set, For Each, Map, Filter, Group By, Subflow, CSV Input, Output and CSV Output nodes.
For Each, Subflow and nested Map/Filter bodies appear inside their parent cards.
Use **Show body / Hide body**, or double-click a container, to toggle its preview.
Use **Edit body** to open its own canvas; breadcrumbs return to the caller.

## Branches and joins

Connect one output port to several nodes to run every connected branch. Decision,
Condition and Switch still choose one port; all connections on that chosen port
run. Branches execute in a deterministic order, one step at a time.

Sibling branches start with separate variable scopes. A shared downstream node
waits for the active branches and runs once with their combined fields. Unselected
conditional paths do not block it. Use different result names for independent
classifications. If siblings assign conflicting values to the same field, the
join fails with the field and both node names; connect those steps in sequence
if the later value should replace the earlier one.

Output and CSV Output finish their own branch. Several terminal nodes retain
all results and CSV downloads; **Outputs (N)** opens a picker for their node
results. A single terminal keeps its existing result shape. In the runtime API,
multiple terminals return an array in `output`, plus `outputs` records identifying
each node and its value. Map and Filter bodies require exactly one final Output
per item: join independent classifiers at a shared Output to combine their fields.
Reachable cycles fail with a diagnostic; use For Each, Map or Filter for repetition.

Try **Examples → Tag reviews with fan-out** for two classifications per review.
The nested Input connects to Sentiment and Topic, and both connect to Combine tags.
Map keeps the original fields and CSV Output adds both labels and confidences.
An importable version with 100 reviews is in
[`examples/workflows/product-reviews-fanout.json`](../examples/workflows/product-reviews-fanout.json).

## Editing

The palette groups nodes into **Data**, **Logic**, **Lists** and **Reuse**.
**Run** stays beside the workflow/file controls; **Run settings** in the editing
bar contains the optional model and language settings. Result/export actions
appear after a run starts.

Node settings put source, operation and result name first. Expand the options
or reference guide for less common settings. The blue reference card shows how
to use the result in a later node, and follows the configured variable name.
CSV file options include original columns, sort direction, delimiter and the
spreadsheet compatibility marker. For Each's item/index names remain under
**Item variable names**. Expanded sections stay open while editing that node.
Run output appears above settings once a run exists; group/file summaries lead,
with **JSON preview** available on demand.

**Workflow input** sits at the top of the sidebar, above the scrolling node
palette. Paste plain text or JSON; the badge shows how it will be read and the
field/item count. **Format JSON** prettifies valid JSON and can be undone.
Incomplete JSON is still accepted as plain text, with that behavior explained
below the editor. **Expand** opens a larger editor for the same live value;
**Done** or Escape returns it to the sidebar. Selecting the root Input node
also offers **Edit workflow input** to focus the panel. Autosave preserves the
exact editor text, including whitespace, separately from the parsed run value.

- **Undo / Redo** restore graph nodes, positions, connections, configuration,
  workflow name and run input, including nested bodies. History keeps up to 80
  edits for the current page session. The current workflow still autosaves
  locally; reloading starts a new undo history.
- Typing in a field is grouped into one edit until focus leaves the field.
  Canvas shortcuts are Ctrl/⌘ Z for undo, Ctrl/⌘ Shift Z (or Ctrl/⌘ Y) for redo.
  Focused text fields retain their native text editing shortcuts; the toolbar
  buttons can undo a whole field edit.
- **Duplicate** or Ctrl/⌘ D copies the selected node with a small position
  offset. Nested bodies are copied independently. Decision copies get a fresh
  result key. Connections to other nodes are not copied. Other configuration,
  including output variable names and template references, stays as authored;
  edit those if the copy should write separate results. Input nodes cannot be
  duplicated.
- Delete/Backspace removes the selected node or connection while outside a
  text field. These edits are undoable too, as are imports, examples and New.

Body previews show their nodes and connections directly in the caller's canvas.
Click a preview node's header for its inspector, then **Edit node** to change it
inside its body editor. Linked bodies remain read-only in callers. Collapse an
expanded container before dragging it. Preview layout reserves space around
containers without changing the saved node positions. Expansion is a view
setting and does not create undo entries. Deeper containers start collapsed;
large previews stop at 240 visible nodes and eight expansion levels. Open a
body's editor to inspect more of a large workflow.

## Field picker and column mapping

Click **{}** beside a reference field to choose from input, item fields,
variables and earlier decisions. Search by path or type. Selection replaces an
exact reference, or inserts at the text cursor; condition fields use bare paths.
Manual references remain editable, including bracket paths for CSV headers
containing spaces or dots.

The picker follows reachable predecessors and the current nested scope.
A Decision inside a Map body appears only after that Decision in the body,
not at the parent Map's input. For Each respects custom item/index names and
resets decisions; Subflow starts a fresh decision scope. Fields introduced on
only some incoming branches are marked **conditional**.

Names and types come from input samples, CSV headers, node settings and known
JSON/column projections. **Configured / Not run yet** means the shape is known
but the value has not been captured. Input and CSV samples are labelled as such;
model values are shown only from **Last run**, using the selected item. Changes
after execution are labelled **edited since run**. Dynamic object keys (including
Group By's encountered groups) become available after a run. Truncated or missing
trace samples are unavailable rather than treated as real values. The picker
bounds nesting, sample fields and the catalog to keep large data responsive;
other paths can still be entered manually.

Choose **Map → Inline mapping or value → Column mapping** to build a row without
writing JSON. Each card has an output column, a value/reference and a transform:
As is, Trim, Trim + lowercase/uppercase, To number, To boolean, or Round to 2
decimals. **Keep original fields** preserves other columns; matching output names
replace their values. The preview applies transforms to known samples and
leaves unavailable values as **Not run yet**. It does not run inference.
Try **Examples → Clean CSV columns** for a complete CSV → Map → CSV Output flow.

For model-derived columns, choose **Output → Column mapping** after the Decision
inside a nested Map body. **Examples → Tag CSV rows** returns `category` from
`{{decisions.category.choice}}` and `confidence` from
`{{decisions.category.confidence}}`; the parent Map adds both to each original row.
Existing Value and JSON template workflows keep their behavior.

Column names must be nonempty and unique. Text cleanup requires text; numeric
conversion rejects blank/nonfinite values, and boolean conversion accepts only
booleans or the text `true`/`false`. As is preserves original types. Missing
fields and invalid conversions fail with the column name and item location in
diagnostics. Column edits, insertion/removal and format changes support undo,
autosave, portable JSON and library versions.

Run `node tools/test_workflow_fields.mjs` for scope/branch inference, honest
samples, selected execution data, transformations and enriched CSV exports.

## Switch

**Decision** asks Laya to interpret text and choose a branch. **Condition** tests
exact rules and branches true/false. **Switch** routes an existing value across
several named cases without calling Laya. Try **Examples → Route by email type**.

Set **Value to match** to a reference such as `{{input.email_type}}`,
`{{item.email_type}}` inside Map/For Each, or `{{decisions.email_type.choice}}`
after a Decision. Add cases with a unique port name and a matching value.
The first exactly equal case wins; comparisons are case-sensitive and preserve
types. Text values remain strings (including CSV cells); JSON values support
numbers, booleans, null and quoted strings. References preserve their types in
both modes. Switch accepts scalar values; select a field from a row or list.

Output ports follow case order, followed by **default** for an unmatched value.
Connect each case and default to its next node. A matched but unconnected port
does not fall through to default; it stops with the existing unconnected-branch
diagnostic. Missing references fail at Switch instead of selecting default.
Duplicate/empty port names and the reserved `default` case name fail validation.
Renaming/removing a case removes its connections; Undo restores both.

The node output reports the resolved value, selected case and whether it matched.
The Result dialog shows cases checked, and Inputs/Diagnostics show the received
value and references. Case expressions are evaluated in order until a match.
Switch settings, cases and connections persist in workflow JSON and library
versions. Run `node tools/test_workflow_switch.mjs` for typed comparisons, default,
first-match routing, unwired branches and nested diagnostics checks.

## Group By

Add **Group By** to collect list items sharing a key. For classified emails,
set **Items to group** to `{{tagged_emails}}`, **Group by** to
`{{item.email_type}}`, and **Store groups as** to `groups`.
Choose **Output format** to fit how the next nodes use the groups:

- **Keyed object** (new-node default) returns named item arrays, such as
  `{ "support": [rows], "other": [rows] }`. Use `{{groups.other}}` directly in
  CSV Output, Map or Filter, and `{{groups.other.length}}` for its size. Keys
  containing punctuation support brackets, e.g. `{{groups["feature.request"]}}`.
  Only encountered keys exist; an absent key resolves to undefined.
- **Group list** returns ordered `{key, items, count}` objects for Map/For Each.
  Use `{{groups}}` as the collection, then `{{item.key}}`, `{{item.items}}` and
  `{{item.count}}` inside the body. Existing Group By nodes keep this format;
  select Keyed object explicitly to change their output shape. Format changes
  can be undone and persist in workflow JSON/library versions.

Both formats preserve every original row and its order within its group, with
detached copies and no source-list changes. Group lists follow first appearance;
keyed object property order follows ordinary JSON/JavaScript object rules.
Empty input returns `{}` in keyed format or `[]` in list format.

Keys are case-sensitive strings, numbers, booleans or null; references retain
their types. Keyed object property names become strings, so a number `42` and a
string `"42"` would collide. Such collisions fail at the relevant item rather
than overwriting or merging a group; choose Group list for distinct typed keys.
A combined text template such as `{{item.country}} / {{item.email_type}}` is
also supported. During key evaluation, `{{item}}` and `{{input}}` refer to the
current item, `{{index}}` is its zero-based position, and `{{parentInput}}`
refers to the caller's input. Missing references fail with the exact item's
index and row preview. Partial counts remain visible; the result variable is
only written after successful completion.

Try **Examples → Export other emails** for direct `{{groups.other}}` CSV export.
**Examples → Group emails and export** uses Group list and For Each to produce
one CSV per type; select a group in the item picker, then download its nested
CSV Output. A Switch inside that body can route on `{{item.key}}` for different
processing per category.

Group By shows full item→group counts and group sizes on its execution card.
The inspector and Result dialog show group sizes; Group list also shows key types. Expand **JSON preview** for the underlying data. The table shows
up to 12 groups and raw previews are bounded; workflow variables retain every
group and item. Run `node tools/test_workflow_groups.mjs` for both formats,
direct/bracket access, typed keys/collisions, ordering, full counts, nested scopes,
empty/missing values and CSV export.

## List item counts

Execution cards, the node inspector and the Result dialog show full list counts,
for example **50 in → 25 out**. Map, Filter and For Each count their source list
and returned items. Group By labels input items and output groups. CSV counts parsed data rows (excluding the header); CSV
Output counts received and exported rows. Input, Output and Subflow show counts
when their received or returned value is an array; scalar values have no list count.
Counts use the full runtime data even when a diagnostic preview is shortened.
An empty list shows **0 in → 0 out**.

While a collection runs, its card shows produced items and progress, such as
**50 in → 10 produced · 20/50 processed**. A failed collection retains these
partial counts; its result variable is only written after successful completion.
Counts belong to the selected invocation when visualizing nested loop items and
are included in exported diagnostics as `listCounts`.

## Checks

Run `node tools/test_workflow_history.mjs` for nested snapshot isolation,
grouped typing, redo-branch replacement and the history bound. Run
`node tools/test_workflow_runtime.mjs` for runtime branches, decisions, loops
and subflows.

## Map and Filter

Add **Map** or **Filter** from the palette. Set **Items** to an array
reference such as `{{input.items}}`, then choose **Store list as** and connect
the `done` port to the next node. A later node can use `{{mapped}}` or
`{{filtered}}` as its collection. Try **Examples → Filter and map a list**:
it keeps active items and returns their names, `["Ada", "Cleo"]`.

- **Map → Inline mapping or value** returns one transformed value for
  every item. `{{item.name}}` extracts a field without changing its type.
  Mixed templates produce text; JSON templates can build objects such as
  `{"name": {{item.name}}, "position": {{index}}}`. Missing exact values fail
  with per-item diagnostics; use JSON `null` to return an explicit null.
- **Filter → Inline rules** keeps the original items matching all or any
  of the configured exact rules. For example, `item.active equals true` or
  `item.score ≥ 0.75`. An empty “all” rule set keeps everything; empty “any”
  keeps nothing.
- **Nested workflow** runs a body for each item. Map's body must reach Output
  with a value. Filter's body must return a real boolean: `true` keeps the
  original item, `false` removes it. Choose Output's JSON format for literal
  `true`/`false`, or return a reference to a boolean. String `"false"`, numbers,
  null and unfinished branches are errors. A Laya Decision can route its
  `true` and `false` branches to those boolean Outputs. Bodies can also contain
  linked library Subflows, other Map/Filter nodes and exact Conditions.

Map's **Keep original fields** merges an object of new values into each original
item. Both the item and mapped output must be objects; matching names replace
existing fields. This works in inline JSON and nested modes, and is useful for
adding tags to CSV rows. With the option off, Map returns only its mapped value.

In both modes, `{{item}}` and `{{input}}` refer to the current item, `{{index}}`
is its zero-based position in the source list, and `{{parentInput}}` is the
caller's input. Parent variables and prior decisions are copied into each
item's scope. Writes stay local to that item; only the resulting list is stored
in the parent. Filtering keeps original values, and both operations preserve
order, execute sequentially and return `[]` for an empty collection. For Each
retains its existing scope and output-collection behavior.

The item picker also works for inline Map/Filter. Their output cards show the
aggregate list plus the selected item's transformation/predicate result. Click
the output to inspect values and rules; the diagnostic panel's execution picker
switches between the collection step and selected item result. Nested body
outputs appear on their own nodes.
Run `node tools/test_workflow_collections.mjs` for chained lists, typed/JSON
mapping, nested predicates, variable isolation, linked subflows, errors and
large-list trace bounds.

## CSV import, tagging and export

Try **Examples → Tag CSV rows**. The complete flow is **CSV Input → Map → CSV Output**.
The CSV node contains three sample messages. Map asks Laya for each message's
category, returns an object with `category` and `confidence`, and keeps the
original fields. Run the flow and click **Download CSV** on the output node to
get `tagged.csv` with the original columns followed by those two new columns.
The sample demonstrates the wiring; model labels and confidence are the actual
Laya results.

1. Select **CSV Input** and choose a UTF-8 `.csv` or `.tsv` file, or expand **Paste or edit CSV**. The first row must contain unique, nonempty column names. The
   inspector previews five rows and up to twelve columns. Comma, semicolon,
   tab and pipe delimiters can be detected or chosen explicitly. Quoted
   delimiters, escaped quotes, multiline cells and an initial UTF-8 marker are
   supported. Short rows get empty trailing fields; extra fields and malformed
   quotes fail with a line number. Blank physical lines are skipped.
2. **Store rows as** defaults to `rows`: an array of objects with the exact
   header names as keys. Values remain strings, preserving IDs such as `001`.
   `rowsCsv` holds `columns`, `columnCount`, `delimiter`, `filename` and `rowCount`; changing the
   variable to `customers` stores metadata as `customersCsv`. Use `{{rows}}`
   as a Map or For Each collection. CSV has a `next` port and can start the flow
   directly or follow another node.
3. In a nested Map, use `{{item.text}}` as Decision State and connect every
   decision branch to **Output → Column mapping**. Add `category` with
   `{{decisions.category.choice}}` and `confidence` with
   `{{decisions.category.confidence}}`. JSON templates also remain available.
   Enable **Keep original fields** on Map and store the list as `tagged`.
   Columns containing dots or spaces can use bracket references such as
   `{{item["customer.name"]}}` or `{{item["Message text"]}}`.
4. Set **CSV Output → Rows to export** to `{{tagged}}` and **Columns and file options → Original columns** to
   `{{rowsCsv.columns}}`. It preserves that header order and appends additional
   fields encountered in the output rows. Leave column order blank to infer
   all columns; for an empty list, provide the original headers or an explicit
   JSON array such as `["id", "text", "category", "confidence"]`. Select a
   filename and delimiter. The optional UTF-8 marker defaults on. Null and
   missing cells export empty; objects/arrays in cells export as JSON. The
   node is terminal and also returns the row list as the workflow output.

**Sort by** optionally orders CSV Output's row list by a named
column, ascending or descending. Leave it blank to preserve the collection's
order. Sorting is stable: tied values retain their original order, empty values
go last, and the source collection stays unchanged. The returned output and
downloaded file use the same sorted order. The Result modal shows the sort used.
An unknown sort column in a nonempty dataset is an error.

For a ready-to-import email example, see
[emails-by-type.json](../examples/workflows/emails-by-type.json) and
[emails-input.csv](../examples/workflows/emails-input.csv). The input has exactly
100 lines including its header (99 synthetic emails). The JSON embeds that CSV,
adds `email_type` and `confidence`, and exports rows sorted alphabetically by
type. See the [example instructions](../examples/workflows/README.md).

For reusable flows receiving CSV text from a caller, choose **CSV Input → Workflow text** and a reference such as `{{input.csv}}`. In file/paste mode, the CSV
contents are embedded in the node: autosave, undo/redo, templates and workflow
JSON exports retain them. File uploads accept up to 10 MiB. Browser storage may
fill sooner; **not saved · export workflow** means the current flow still runs
but needs a JSON export to preserve its embedded data and edits.

Downloads are available on the node, in its inspector and in its Result modal.
They contain all rows, independently of shortened diagnostic previews. Files
belong to the captured run; editing afterward does not alter an existing
download. Run again to generate a new file. The next Run or page reload clears
previous generated files. Failed input/tagging runs do not generate a root
CSV output. This version processes the whole CSV in browser memory; it does
not stream files or write back to the uploaded file.

Run `node tools/test_workflow_csv.mjs` for parser/export round trips, malformed
files, Unicode/leading zeros, preserved and appended columns, typed tagging,
full-size downloads, empty datasets, portable embedded files and scope isolation.

## Run diagnostics

Execution information lives on the flow. Each node has an output card showing
its status, duration, selected branch and a compact value/error preview. Input
shows the received value; Decision shows its answer; Condition shows its boolean
result; Set shows values written; containers show their collected/returned
output. Nodes show running/warning in yellow, passed in green and failed in red;
taken connections are green for the visualized item. Completed values remain
available if a later node fails. A compact toolbar above the canvas keeps the
run summary, **Inspect failure**, **Final output** and **Export diagnostics**.

While running, For Each, Map and Filter show a **View** item picker. **Follow
latest** follows execution; choosing a numbered item pins its body outputs and
branches. Item numbers start at 1; `{{index}}` stays zero-based. Nested pickers
belong to the selected outer invocation, so changing an outer item never mixes
its inner results with another item. The body editor also shows ancestor item
pickers. Nodes on an untaken branch show no output for that item. Failure
inspection selects the exact failing item automatically.

Selecting a node shows **Run output** above its settings, updating live. Click
its output card or **Details** for the diagnostic modal:

- **Result** puts output first, followed by the selected route, model
  probabilities, conditions or assignments and expandable variables.
- **Inputs** shows resolved State, received input, collection and item scope.
- **Diagnostics** shows resolved/missing references and expandable request,
  response and captured settings.

The header shows the nested path and item. If the node executed repeatedly, the
execution picker selects among its retained steps in the current item scope.
**Show node in canvas** selects a visible preview or opens the relevant body.
Pinned library bodies retain their read-only behavior.

Failure inspection opens **Diagnostics** for missing references, or **Inputs**
for other errors. The error remains visible above the tabs.

A missing State reference such as `{{item.text}}` now reports the missing path
at the Decision node before contacting the server. Null, blank text, empty
objects and empty arrays also stop before inference with an actionable error.
Partially missing State references in otherwise nonempty text produce a warning.
Unconnected selected branches and undefined Output values are warnings; inspect
them to see where execution stopped. A missing field in an intentional
`exists`/`not_exists` condition is recorded without automatically warning.

Each run captures its workflow, input, checkpoint and language. Editing while
running does not change that run; diagnostics show **edited since run** and
continue to display captured values. If a node was deleted, its panel remains
available even though canvas navigation can no longer find it. The next Run
replaces the previous diagnostics; reloading clears them.

**Export diagnostics** downloads `workflow-diagnostics.json` with the captured
workflow, input preview, model/language, trace, output preview and failure. The
canvas and export use up to the last 1,000 retained steps and record how many
earlier steps were omitted. Item pickers list only items with retained steps;
older omitted items have no diagnostic output. Value previews are detached and bounded:
12 array items, 30 object fields, six nesting levels, 200 visited values and
16,000 string characters per preview (8,000 per string), with omissions marked.
These limits apply to diagnostic previews; execution uses the complete data.

Run `node tools/test_workflow_diagnostics.mjs` for contextual nested failures,
empty/missing State validation, live trace updates, server rejection details,
condition and route diagnostics, navigation paths and bounded previews/traces.
Run `node tools/test_workflow_canvas.mjs` for immutable preview layout, qualified
nested identities, scoped item selection, branch isolation and node outputs.

## Linked subflows and templates

Open **Library** in the editing bar. Save the current canvas with a name and
description as either a reusable subflow or a whole workflow template. Templates
include the run input. The library lives in this browser's local storage on the
current origin; another browser or port has a separate library.

1. **Insert linked** adds a Subflow node pinned to the selected published version.
   Connect its input and `done` ports to the caller. Set its **Input value** to
   `{{input}}`, `{{input.customer}}`, `{{item}}` or another value/template, and
   choose a variable under **Store output as**. Existing subflows without an
   input setting continue to inherit their caller's input.
2. **Edit body / Open subflow** lets you inspect a pinned body. Its canvas and configuration
   are read-only. Use **Edit latest as library draft** in the caller's inspector,
   or **Open as draft** in the library, to revise the shared flow.
3. Edit the draft, reopen Library and choose **Publish new version**. Published
   versions remain available. Publishing from an outdated draft is rejected;
   open the latest version first. **Save new item** creates a separate library
   entry when that is what you intend.
4. Existing callers keep their pinned version. Select a linked node and choose
   **Update to vN** to replace its body with the latest published version. Its
   caller input/output mappings and connections are preserved. That update can
   be undone. Nested linked dependencies retain their own pinned versions until
   you update them in their parent library draft.
5. **Use template** loads the selected full workflow version and its sample input
   into the editor. Loading templates or drafts can be undone.

Library publications are separate from canvas undo: undoing a save's draft
metadata, an insertion or a caller update does not erase shared published
versions. Workflow JSON exports embed every pinned body, so imports and runs
work even when the originating library is unavailable. In that case the
inspector explains why updates are unavailable. Library synchronization across
browsers and library import/export are not included in this first version.

Run `node tools/test_workflow_library.mjs` to check pinned versions, stale draft
rejection, portable execution, input mapping, template input, failed persistence
and undoing a caller update without deleting a publication.

Full canvas restores use the [X6 resetCells API](https://x6.antv.antgroup.com/en/api/mvc/model)
to replace nodes and edges together, avoiding stale views during repeated undo.
Canvas rendering is synchronous so nested replacements and immediate trace
highlights operate on mounted views; X6 documents the timing tradeoff under
[view rendering](https://x6.antv.antgroup.com/en/api/mvc/view).
Root routing ignores inline preview children using X6's
[excludeNodes routing option](https://x6.antv.antgroup.com/en/api/registry/router),
so child cards do not obstruct connections between their callers.
