## Why

With the auth shell and seed data in place, the first real feature screen is documents:
a requester needs to create a PR (or memo/leave), fill its form, add lines, and submit it
into approval — then track it. The backend document-engine has the runtime endpoints, but a
**requester** (only `DOC_CREATE`) currently can't discover *which* document types they may
create or fetch a form's fields — those reads are gated by `DOC_CONFIG_MANAGE`. So this
change adds a small requester-facing read surface to document-engine and builds the Vue
screens on top of it.

## What Changes

- **New capability `web-documents`** — the document screens in the Vue shell.
- **Backend (document-engine delta, minimal)**: two `DOC_CREATE`-gated reads so a requester
  can drive creation without config rights —
  - `GET /documents/creatable-types` → the active department's enabled document types
    (`dept_doc_type` → `document_type` with `requires_budget`/`requires_quota`/code/name);
  - `GET /documents/types/:id/form` → the pinned form template's fields for a type.
- **My Documents** (`DOC_VIEW`): a list of the active company's documents with status chips
  and a status filter; click through to detail.
- **Document detail** (`DOC_VIEW`): header (no, type, status, currency, base total),
  rendered field values, line items, attachments, and the approval log; action buttons
  (Submit / Cancel) shown by permission + status.
- **Create / edit draft** (`DOC_CREATE`): pick a creatable type → a dynamic form rendered
  from its fields (required validated client-side) → a line-item editor (description, qty,
  unit price, line amount; optional budget when `BUDGET_VIEW`, optional item when
  `MASTER_VIEW`) → save draft (`POST /documents`, then `PUT fields`/`PUT lines`).
- **Submit / cancel** (`DOC_SUBMIT` / `DOC_CANCEL`): submit a draft (surfacing server
  errors — over-budget, missing field, closed period, vendor/item not enabled) and cancel
  an own document; the detail reflects the new status.
- **Attachments**: register attachment metadata (filename/path/size/mime) on a document.
- **Shell integration**: a "Documents" nav entry (gated by `DOC_VIEW`); a typed
  `api/documents.ts` wrapper + a small Pinia store; the seeded sample `CompanyFormView`
  home is replaced by the My Documents view.
- **Tests**: backend tests for the two new reads; frontend unit tests for the documents
  store/helpers + the dynamic-form required-field validation.

## Capabilities

### New Capabilities
- `web-documents`: the Vue screens to list, create/edit, submit/cancel, and view documents,
  with dynamic forms and line items, permission-gated.

### Modified Capabilities
- `document-engine`: adds a requester-facing read surface — list creatable document types for
  the active department and fetch a type's form fields under `DOC_CREATE` — so creation can
  be driven without `DOC_CONFIG_MANAGE`. Existing requirements are unchanged.

## Impact

- **Affected**: `front-end/` (new views/store/api, router/nav) and a small
  `back/src/modules/document/` read addition (controller + service method, spec delta,
  tests).
- **Invariants reflected on the client**: 5 (gate create/submit/cancel by permission code;
  the new reads are `DOC_CREATE`-gated server-side) and 7 (the form is rendered from
  `form_field` config, not hardcoded per type).
- **Consumes**: existing `/documents`, `/documents/:id`, `PUT fields|lines`, `submit`,
  `cancel`, `attachments`, `approval-log`, plus the two new reads; `/budgets` and
  `/items/enabled` when the user has those view permissions.
- **No new dependency**; no schema change.

## Out of Scope

- The approver inbox / approve-reject UI — follow-up `web-approvals`.
- Budget/quota dashboards and the document-config admin UI — `web-budgets` / `web-doc-config`.
- File upload to S3 (attachments are metadata-only here, as on the backend); a presigned
  upload lands with the `s3-attachment-upload` change.
- Quota-reservation entry on submit for `requires_quota` types beyond a simple input — full
  leave UX is a later `web-quota` slice.
