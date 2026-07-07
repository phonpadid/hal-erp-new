## Context

The scaffold provides the nine document entities; all upstream capabilities are
implemented and export the services document-engine needs: `ExchangeRateService`
(resolve/convert), `FiscalYearService` (`assertOpenPeriod`), `VendorService`/`ItemService`
(enablement guards + GL default), `BudgetLedgerService` (`reserve`/`settle`/`releaseAll`),
`QuotaUsageService` (`reserve`/`releaseAll`), plus `CompanyScopeService` and the
`inTransaction`/`lockForUpdate` UoW helpers. No schema change.

## Goals / Non-Goals

**Goals**
- Config CRUD (document_type, form_template/field, dept_doc_type).
- Safe per-company/type/year numbering under `SELECT FOR UPDATE` (concurrency test).
- Create draft (resolve mapping, issue number, ref chain), store typed field values + lines.
- Submit: required-field validation, lock FX + base amounts, period guard, enablement
  guards, config-driven budget/quota reserve, DRAFT→SUBMITTED — atomic.
- Cancel + reusable `releaseDocumentHolds` (budget + quota).
- Attachment metadata registration.

**Non-Goals**
- Approval routing / step evaluation / `post_action` execution (approval-workflow).
- Server-side conditional form rendering (`condition_json`) — store + required-validate only.
- Real S3 upload — metadata-only attachments.
- 3-way matching / receipt flow (`received_qty`) beyond storing the column.

## Decisions

### D1 — Numbering issued at create, under a locked counter
`document.doc_no` is NOT NULL, so the number is issued at **create** (not submit).
`NumberingService.next(companyId, documentTypeId, year)` runs in `inTransaction`:
`lockForUpdate(doc_running_number, {company, documentType, year})`; if absent, create it
(prefix derived e.g. `${typeCode}-${companyCode}-${year}-`); increment `current_no`;
return `prefix + zeroPad(current_no)`. Two concurrent creates serialize on the row →
unique, gap-free (the second required concurrency test). Created within the same
transaction as the document insert so a rolled-back create doesn't burn a number... except
the counter increment must persist to avoid reuse — acceptable trade-off: numbers are
unique and monotonic; a failed document insert may leave a gap, which the spec permits
("no gaps **from collision**"). Numbering uses its own committed transaction before the
document insert to keep the lock window tiny.

### D2 — Create resolves dept_doc_type to pin template + workflow
`createDraft` looks up the active `dept_doc_type` for (department, documentType); its
`form_template` and `workflow` are copied onto the document (versioned forms: the document
keeps that `form_template_id` forever). Rejects if no active mapping. `ref_document_id`,
`vendor`, `related_employee`, `currency` are set from the create input. Company + createdBy
come from the request context.

### D3 — Field values and lines are child collections
`doc_field_value` upserted by `form_field_id` (unique per document+field). `document_line`
rows carry `line_no`, optional `item` (GL defaults from the item when absent), `qty`,
`unit_price`, `line_amount`, and an optional `budget_id`. Line base amounts are computed at
submit (D4), not create, since FX is locked at submit.

### D4 — Submit is one transaction, ordered defensively
`submit(documentId)` in `inTransaction`:
1. Load document (scoped) + lines + required form fields; reject if status ≠ DRAFT.
2. **Validate** every `form_field.is_required` has a non-empty `doc_field_value`.
3. **Lock FX**: `convert(totalAmount, document.currency, company.baseCurrency, submitDate,
   companyId)` → stamp `exchange_rate` (resolved rate) + `base_total_amount`; per line,
   `base_line_amount = convert(line_amount, …)` (same locked rate). If currency == base,
   rate = 1.
4. **Period**: `assertOpenPeriod(submitDate)` when `requires_budget` (budget posts into a
   fiscal year).
5. **Enablement**: for `vendor` and each line `item`, call
   `assertVendorEnabled` / `assertItemEnabled` for the active company.
6. **Config-driven holds** (invariant 7): if `documentType.requires_budget`, build reserve
   lines from `document_line` (budgetId + base_line_amount) and `BudgetLedgerService.reserve`;
   if `requires_quota`, `QuotaUsageService.reserve` for each supplied `quotaReservations`
   entry. Neither flag → no holds.
7. Set `status = SUBMITTED`, `submitted_at`, `current_step_no = 0` (approval-workflow
   advances it). The workflow is already bound from create.
All within one `em.transactional`, so a failure (e.g. HARD_STOP over-budget) rolls back the
whole submit and the document stays DRAFT.

### D5 — Holds release is shared
`releaseDocumentHolds(documentId)` calls `BudgetLedgerService.releaseAll` and
`QuotaUsageService.releaseAll`. `cancel(documentId)` sets `status = CANCELLED` and releases;
approval-workflow's reject path will reuse `releaseDocumentHolds` (exported). Idempotent —
releaseAll is a no-op when nothing is outstanding.

### D6 — Quota at submit via explicit input (schema gap)
There is no `document → quota` column in the DBML, so submit accepts an optional
`quotaReservations: { quotaId, employeeId?, qty }[]`. When `requires_quota` is true and the
array is empty, submit rejects (a quota document must declare what it consumes). Documented
as the integration seam; a future schema addition could derive it from a form field.

### D7 — Cross-cutting filter handling
`document` is company-scoped (reads via `CompanyScopeService.forActiveCompany`). Child
reads that touch scoped relations (lines→budget, etc.) follow the budget-control pattern
(`{ filters: { company: false } }`) where the global filter would otherwise demand params,
with company isolation preserved by always loading the document in the active company first.

## Risks / Trade-offs

- **Numbering gap on rolled-back create** — accepted (spec forbids only collision gaps);
  keeping the lock window tiny (own short transaction) matters more than perfect density.
- **Submit orchestrates five subsystems in one transaction** — long transaction, but
  correctness (all-or-nothing holds) outweighs it; lock order is budget rows sorted by id
  (already handled inside `BudgetLedgerService.reserve`).
- **Quota-at-submit explicit input** — slightly leaky abstraction; documented, and isolates
  the schema gap to one DTO field rather than inventing a table.
- **`em.transactional` nesting**: `submit` runs its own transaction and calls
  `BudgetLedgerService.reserve`/`QuotaUsageService.reserve`, which also open transactions →
  MikroORM joins the ambient transaction (savepoints), so it stays atomic. Verified by the
  cancel/rollback tests.

## Migration Plan

No DB migration. Steps: build `DocumentEngineModule` importing budget/quota/currency/
multi-company/master-data; add config + numbering + document + submit services,
controllers, DTOs, permission constants; register in `AppModule`; add unit + concurrency
tests (numbering) + submit-integration tests; `pnpm build` + `pnpm test`. Rollback = revert
the module.

## Open Questions

- Should `total_amount` be derived from the sum of lines or accepted from the client?
  Default: if lines exist, `total_amount` = Σ `line_amount`; otherwise use the provided
  `total_amount` (header-only documents). Documented in the submit logic.
- Should submit advance `current_step_no` to 1? Default: leave 0 and let approval-workflow
  initialize the first step, to keep the routing logic in one place.
