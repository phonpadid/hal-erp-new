## Context

The Forms section (`/doc-config/forms`, `FormTemplatesView.vue`) lets a `DOC_CONFIG_MANAGE`
user build versioned form templates per document type. Today it stacks three concerns in one
card: a toolbar `Select` for the document type, a `DataTable` of template versions selected by
row click, and — once a version is picked — a fields `DataTable` with an add-field dialog. A
template is only editable while `DRAFT`; publish makes it immutable and a new version must be
created to change it (server-enforced).

The backend is complete and unchanged. Available operations (via `docConfigApi` / `docConfig`
store): `loadTemplates`, `loadFields`, `createTemplate`, `publishTemplate`, `retireTemplate`,
`addField`, `updateField`. Notably there is **no delete-field endpoint** and **no
reorder/bulk endpoint** — reorder is done by swapping two fields' `sortOrder` via two
`updateField` calls (as the current `moveField` does). Field shape:
`{ id, fieldName, fieldLabel, fieldType, isRequired, sortOrder, optionsJson?, conditionJson? }`.
Field types: `text, number, date, dropdown, file, line_items`. Condition ops:
`eq, ne, in, nin, empty, notEmpty`. Client validation uses the shared `formFieldSchema`.

This is a presentation-layer redesign. No `budget_txn`/`quota_usage` writes are involved, so no
transaction-boundary or locking notes apply.

## Goals / Non-Goals

**Goals:**
- A legible master–detail form builder: pick type → pick version → edit fields → see the form.
- A **live preview** that renders the selected template's fields as an end user would see them,
  so the builder gives immediate feedback.
- Explicit, highlighted template/version selection (not an un-hinted row click).
- Expose **edit field** on DRAFT templates using the existing `updateField` endpoint; keep
  reorder; remove the manual `sortOrder` entry by auto-assigning on add.
- Make the DRAFT-editable vs PUBLISHED-locked distinction obvious.
- Keep parity with existing scenarios and shared-schema validation; theme-token styling so
  light/dark both work.

**Non-Goals:**
- No backend, DB, API, route, or permission changes.
- No field **delete** (no endpoint) and no drag-and-drop reordering library — reorder stays
  the two-`updateField` swap, just presented more clearly. (Drag can be a later change.)
- No change to how document forms are actually rendered at runtime for end users; the preview
  is a faithful-enough approximation for configuration, not the production renderer.
- No changes to the other doc-config sections (types, mappings, workflows).

## Decisions

**1. Layout: three-region master–detail, one card per region.**
Left rail = document-type `Select` + a vertical list of version items (card/segment per
template showing `v{n}`, a status `Tag`, and field count) with the active one highlighted.
Center = the field list for the selected template. Right = the live preview. On narrow
viewports the regions stack (responsive via Tailwind grid/flex + PrimeUI tokens). Rationale:
separates "which form" from "what's in it" from "what it looks like"; the current single-card
stack forces the user to scroll and guess. *Alternative considered:* keep the `DataTable` of
versions but add a selected-row style — rejected because a table for ~1–3 versions is heavier
than a compact selectable list and still reads as a grid, not a picker.

**2. Field list stays a `DataTable`, gains row actions.**
Keep the tabular field list (name / label / type / required / rule) but add an **Edit** action
per row (DRAFT only) that opens the same builder dialog pre-filled, and keep grouped
move-up/move-down controls. Rationale: the table already conveys order and columns well; the
gap is editing, which `updateField` supports. Reuse one dialog for add and edit to avoid
divergence. *Alternative:* inline-edit cells — rejected as fiddly for type-dependent inputs
(dropdown choices, condition rule).

**3. One builder dialog, add/edit modes, wider and grouped.**
The dialog keeps `@primevue/forms` + `zodResolver(formFieldSchema)` and groups inputs into
Basics (name, label, type, required), Type options (dropdown choices, shown only for
`dropdown`), and Show-when rule (field/op/value referencing another field). In **add** mode
`sortOrder` is auto-assigned as `max(existing)+1` and the number input is removed from the UI;
in **edit** mode the field's current values seed `initialValues` and submit calls
`updateField(id, …)`. Rationale: removes a confusing manual field and keeps client/server
validation aligned via the single shared schema.

**4. Live preview = a small presentational renderer, config-only.**
Add a `FormPreview.vue` (or inline block) that maps each field to a read-only-ish PrimeVue
control: `text`→InputText, `number`→InputNumber, `date`→DatePicker, `dropdown`→Select fed by
`optionsJson`, `file`→a file drop affordance placeholder, `line_items`→a small table
placeholder. It respects `isRequired` (asterisk) and visually flags fields carrying a
`condition_json` show/hide rule (e.g. a "conditional" chip) rather than trying to evaluate
rules live. Rationale: gives the builder feedback without duplicating the production document
renderer or its data. *Alternative:* embed the real runtime renderer — rejected as
out-of-scope coupling; the config preview only needs to be representative.

**5. Editability strictly mirrors server state.**
All mutate affordances (add/edit/reorder) render only when the selected template is `DRAFT`;
`PUBLISHED`/`RETIRED` show a "locked" tag and a read-only field list + preview. Publish/retire
buttons sit on the selected version. The server remains the enforcer; the UI only mirrors, per
the frontend conventions.

## Risks / Trade-offs

- **Preview diverges from the real document form** → Keep the preview explicitly labeled as a
  configuration preview and keep its control mapping in one small component so it is cheap to
  align later; do not claim it evaluates conditional rules.
- **Reorder still costs two sequential `updateField` calls** (no atomic endpoint) → Unchanged
  behavior; keep the existing swap logic and disable move controls at the ends. Acceptable for
  small field counts; a batch endpoint is a possible follow-up.
- **No delete-field endpoint** → Do not add a delete affordance that would 404; if users need
  removal, it is a separate backend change. Document this limitation in tasks.
- **Wider/preview layout must not break on small screens** → Use responsive grid that stacks
  regions; verify light/dark with theme tokens only (no hardcoded colors).
- **i18n drift** → Add all new labels as `admin.docConfig.*` keys; no hardcoded copy.
