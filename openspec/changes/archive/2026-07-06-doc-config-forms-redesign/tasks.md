## 1. Layout & template/version selection

- [x] 1.1 Restructure `FormTemplatesView.vue` into a responsive master–detail layout: left rail (document-type `Select` + version list), center (field list), right (live preview); regions stack on narrow viewports using Tailwind grid + PrimeUI tokens only (no hardcoded colors).
- [x] 1.2 Replace the row-click template `DataTable` with an explicit version picker: one selectable card/segment per template showing `v{version}`, a status `Tag` (DRAFT/PUBLISHED/RETIRED), and field count; highlight the active selection.
- [x] 1.3 Keep "New template version" (create), and place Publish/Retire actions on the selected version; keep them gated by template status.
- [x] 1.4 Preserve loading via the `docConfig` store (`loadTemplates`/`loadFields`) and `EmptyState`/`ErrorState` for the no-type / no-selection / error cases.

## 2. Field list & builder dialog

- [x] 2.1 Keep the field list as a `DataTable` (name / label / type / required / rule) and add a per-row **Edit** action shown only when the selected template is DRAFT.
- [x] 2.2 Refactor the add-field dialog into a single builder dialog with add and edit modes; widen it and group inputs into Basics (name, label, type, required), Type options (dropdown choices — shown only for `dropdown`), and Show-when rule (field/op/value referencing another field).
- [x] 2.3 In add mode, auto-assign `sortOrder = max(existing sortOrder) + 1` and remove the manual order input; in edit mode seed `initialValues` from the field and submit via `updateField(id, …)`.
- [x] 2.4 Keep `@primevue/forms` with `zodResolver(formFieldSchema)` and per-field `<Message>` errors; keep `optionsJson`/`conditionJson` assembly (VALUELESS_OPS handling) intact for both add and edit.
- [x] 2.5 Keep grouped move-up/move-down reorder controls (DRAFT only) using the existing two-`updateField` swap; disable at the ends. Do NOT add a delete affordance (no backend endpoint).

## 3. Live preview

- [x] 3.1 Add a presentational `FormPreview.vue` that renders the selected template's fields: `text`→InputText, `number`→InputNumber, `date`→DatePicker, `dropdown`→Select (fed by `optionsJson`), `file`→file drop placeholder, `line_items`→small table placeholder.
- [x] 3.2 Show the required flag (asterisk) and visually flag fields that carry a `condition_json` show/hide rule (e.g. a "conditional" chip); label the pane clearly as a configuration preview (do not evaluate rules live).
- [x] 3.3 Render the preview read-only/locked for PUBLISHED/RETIRED templates and empty-state it when the template has no fields.

## 4. Editability & permission mirroring

- [x] 4.1 Render all mutate affordances (add/edit/reorder) only when the selected template is DRAFT; otherwise show a "locked" tag and read-only field list + preview (mirror the server; server stays the enforcer).
- [x] 4.2 Keep the route `doc-config/forms` and its `DOC_CONFIG_MANAGE` gate unchanged; confirm the sub-sidebar navigation and existing guard tests still pass.

## 5. i18n

- [x] 5.1 Add new `admin.docConfig.*` keys for the added affordances (edit field, preview pane title, conditional chip, locked-preview text) in all locale files; no hardcoded copy.

## 6. Tests & verification

- [x] 6.1 Add/adjust a component spec for `FormTemplatesView.vue` covering: selecting a version loads its fields, add auto-assigns sort order, edit pre-fills and persists via `updateField`, and mutate affordances are hidden for a PUBLISHED template.
- [x] 6.2 Add a spec for `FormPreview.vue` covering the field-type→control mapping, the required marker, and the conditional-rule flag.
- [x] 6.3 Run the frontend unit tests and lint; verify light/dark rendering and responsive stacking manually; confirm no backend/API/DB changes were introduced.
