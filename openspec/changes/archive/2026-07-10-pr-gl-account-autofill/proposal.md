## Why

A requester creating a document (e.g. a PR to pay an electricity bill) is not an
accountant and must not be asked to pick a raw GL (General Ledger) code or hunt for the
correct budget line. The data model already anticipates this — `item.default_gl_account`
is annotated "ช่วย auto เลือกหมวดงบตอนสร้าง PR" and `budget` is unique on
`(fiscal_year, department, gl_account)` — but the specs currently (a) contradict each
other on whether the line GL is editable, and (b) still make the requester choose the
budget line explicitly. This change makes the requester pick **what** they are buying
(the item), and lets the server derive the **GL account and budget line** for them.

## What Changes

- The requester selects an **item** on a document line; the server derives the line's
  `gl_account` from `item.default_gl_account` (server-authoritative, not requester-typed).
- From the derived `gl_account` + the document's `department_id` + the fiscal year that
  contains the document date, the server **resolves the line's `budget_id`** against the
  unique `(fiscal_year_id, department_id, gl_account)` budget, so the requester no longer
  picks a budget line for item-backed lines.
- When an item has **no default GL**, or **no active budget** matches the resolved
  `(fiscal_year, department, gl_account)`, the line/submit is **rejected with a specific
  error** (which GL / department / year failed) rather than silently reserving nothing.
- **Resolve the spec conflict**: the line GL is auto-filled and **read-only** to the
  requester (aligns `master-data` with `web-documents` and invariant 7). The prior
  "editable by the user" wording is removed.
- The requester-facing budget picker becomes a **fallback**, shown only for lines that
  carry **no item** (e.g. free-text lines) on a `requires_budget` type, not the primary
  path. An item-backed line whose item lacks a default GL is **blocked** (see above), not
  routed to the picker.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: line creation/edit derives `gl_account` from the selected item and
  resolves `budget_id` from `(fiscal_year, department, gl_account)`, server-authoritative,
  rejecting unresolvable lines.
- `budget-control`: add a read that resolves the single active budget for a given
  `(fiscal_year, department, gl_account)` triple used during line creation.
- `master-data`: the item-default-GL requirement changes from "editable by the user" to
  auto-filled/read-only, matching the document behavior.
- `web-documents`: the line-item editor presents item selection as the primary action;
  the derived GL and resolved budget are shown read-only; the explicit budget picker is a
  fallback for lines without an item default GL.

## Impact

- **Backend**: document line service (GL derivation + budget resolution + validation),
  a budget-control resolver read, DTOs for line create/edit. No DBML change — all needed
  columns exist (`document_line.gl_account`, `document_line.budget_id`,
  `item.default_gl_account`, `budget` unique key, `document.department_id`).
- **Frontend**: `LineItemsEditor.vue` — item picker drives the line; GL and budget shown
  read-only; budget picker demoted to fallback.
- **Invariants**: reinforces invariant 7 (configuration over code). Budget reservation
  (invariants 3–5) is unchanged — this only changes how a line's `budget_id` is chosen,
  not how it is reserved/released. Company scope (invariant 1) still applies to item,
  budget, and fiscal-year lookups.
