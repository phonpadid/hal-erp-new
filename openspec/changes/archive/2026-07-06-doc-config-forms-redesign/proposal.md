## Why

The `/doc-config/forms` page (Forms section of Document Configuration) works but is hard to
use: the document type is a detached toolbar dropdown, a template version is selected by an
un-hinted row click, fields live in a bare table with no way to see the form they produce, and
the only field affordances are "add" and up/down reorder — there is no way to edit or remove a
field even though the backend already supports editing. The result is a builder that gives no
feedback on what is being built. This change redesigns the page into a clear master–detail form
builder that is easier to use and visually consistent with the rest of the admin surface.

## What Changes

- Restructure the page into a three-pane **master–detail builder**: document type + template
  version picker (left), the field list for the selected template (center), and a **live form
  preview** that renders the fields as an end user would see them (right).
- Make template/version selection explicit and legible — show version, status
  (DRAFT/PUBLISHED/RETIRED) and field count as selectable cards/segments instead of a
  row-click table, with the active selection clearly highlighted.
- Expose **edit an existing field** (name, label, type, required, dropdown choices, show/hide
  rule) on DRAFT templates via the field row, using the existing `updateField` endpoint.
- Improve the **field builder dialog**: give it room, group inputs (basics / type-specific
  options / conditional rule), and preview the field type inline. Auto-assign `sortOrder` on
  add so users no longer type an order number by hand.
- Keep reorder, but make it clearer (grouped move controls / drag handle affordance) and keep
  it DRAFT-only.
- Surface the DRAFT-vs-locked state and the publish/retire actions prominently so the editable
  vs immutable distinction is obvious.
- No backend, DB, or API changes — this is a presentation-layer redesign of an existing
  capability. All field input remains validated client-side against the shared `formFieldSchema`.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `web-doc-config`: the **Form Template and Field Management** requirement gains UX-level
  behavior — a live form preview, explicit template/version selection, and editing an existing
  field on a DRAFT template. The existing scenarios (build/publish, ordering, dropdown choices,
  conditional rule, file/line-items, reorder) are preserved.

## Impact

- **Frontend only.** Rewrites `front-end/src/views/admin/doc-config/FormTemplatesView.vue` and
  may add small presentational sub-components (e.g. a field-preview renderer). Route
  `doc-config/forms`, permission gate `DOC_CONFIG_MANAGE`, and the `docConfig` store/API are
  unchanged (uses existing `updateField`).
- i18n: new keys under `admin.docConfig.*` for the added affordances (edit field, preview).
- No cross-capability invariant is affected. Company scope, permission-code gating, and the
  DRAFT-only editability rule (server-enforced) are all preserved; the UI only mirrors them.
