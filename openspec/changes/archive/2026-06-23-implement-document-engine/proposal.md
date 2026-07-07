## Why

`document-engine` is the integrator: it turns configuration (`document_type` flags, form
templates, per-department mappings, workflows) into runtime documents, and on **submit**
it wires together everything built so far — multi-currency `convert` (lock FX), fiscal
`assertOpenPeriod`, master-data enablement guards, budget `reserve`, and quota `reserve`.
The scaffold ships the entities (`document_type`, `form_template`, `form_field`,
`dept_doc_type`, `document`, `doc_field_value`, `document_line`, `document_attachment`,
`doc_running_number`); this change makes them behave. Behavior is driven by configuration,
never hardcoded per type (invariant 7).

## What Changes

- **`DocumentEngineModule`** registering the document entities and importing the budget,
  quota, multi-currency, multi-company, and master-data modules to consume their services.
- **Configuration** (`DOC_CONFIG_MANAGE`): CRUD for `document_type` (with
  `requires_budget` / `requires_quota` / `post_action`), versioned `form_template` +
  `form_field`, and `dept_doc_type` mappings (department → type → template + workflow).
- **Safe numbering** (`NumberingService`): per company + type + year via
  `doc_running_number`, incremented under `SELECT FOR UPDATE` in one transaction — unique,
  gap-free under concurrency (the second required concurrency test).
- **Document creation** (`DOC_CREATE`): resolve the active department's `dept_doc_type`
  to pin `form_template` + `workflow`, issue `doc_no`, set `ref_document_id` for the
  reference chain; persist `doc_field_value` (typed) and `document_line` rows (each able to
  charge a distinct budget).
- **Submit** (`DOC_SUBMIT`), all in one transaction:
  1. validate required `form_field`s are present;
  2. **lock FX** — resolve the rate (multi-currency) at submit date, stamp
     `exchange_rate`, compute `base_total_amount` and per-line `base_line_amount`, and
     never recompute (invariant 6);
  3. reject submitting into a CLOSED fiscal period (`assertOpenPeriod`);
  4. enforce vendor/item enablement for the active company (master-data guards);
  5. **config-driven holds** — if `requires_budget`, `reserve` per line grouped by budget;
     if `requires_quota`, `reserve` quota; if neither, create no holds (invariant 7);
  6. transition `DRAFT → SUBMITTED` and bind the workflow (routing is approval-workflow's).
- **Cancel** (`DOC_CANCEL`) and a reusable `releaseDocumentHolds` that releases budget +
  quota (invariant 4 — reject/cancel always frees holds); approval-workflow reuses it on
  reject.
- **Attachments**: register `document_attachment` metadata (path, size, mime) — bytes live
  in S3/MinIO, never in the DB.

No schema change — all nine entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `document-engine`: adds the runtime lifecycle requirements the existing eight implied
  but did not pin down — the **submit** integration (lock FX + base amounts, period guard,
  enablement, config-driven budget/quota reserve), **holds released on cancel/reject**, and
  authorized/company-scoped document operations. The eight existing requirements
  (Configurable Document Type, Per-Department Enablement, Versioned Forms, Dynamic Form
  Values, Multi-Line Items, Attachments, Safe Numbering, Reference Chain) are unchanged.

## Impact

- **Affected capability**: `document-engine` (unblocks approval-workflow, which drives the
  bound workflow to APPROVED/COMPLETED and runs `post_action`).
- **Invariants exercised**: **7** (configuration over code — branch on `document_type`
  flags), **6** (locked FX stamped at submit), **4** (cancel/reject release holds), **1**
  (company-scoped documents), the concurrency rule (numbering under `SELECT FOR UPDATE`),
  **5** (permission codes).
- **Code**: new `back/src/modules/document/` services, controllers, DTOs, module;
  consumes `ExchangeRateService`, `FiscalYearService`, `VendorService`/`ItemService`,
  `BudgetLedgerService`, `QuotaUsageService`. Registered in `AppModule`.
- **New permission codes**: `DOC_CONFIG_MANAGE`, `DOC_VIEW`, `DOC_CREATE`, `DOC_SUBMIT`,
  `DOC_CANCEL`.
- **Consumers (later)**: approval-workflow drives the workflow, on full approval converts
  budget reserve → actual (`settle`) and runs `post_action` (e.g. transfer/adjust exec,
  employee updates), and on reject calls `releaseDocumentHolds`.

## Out of Scope

- Approval routing, step evaluation, delegation, and `post_action` execution
  (approval-workflow) — submit only binds the workflow and sets `SUBMITTED`.
- Server-side form rendering / `condition_json` evaluation — the backend stores and
  validates field values; conditional display is the frontend's job.
- Real S3 upload (presigned URLs / streaming) — attachments are metadata-only here; the
  client uploads to storage and registers the path.
- Quota-at-submit has no document→quota column in the DBML, so it is driven by an explicit
  `quotaReservations` input on submit (documented integration point), not inferred.
