# CLAUDE.md — Multi-Company ERP (Approval + Budget + Quota)

This file is read automatically every session. It is the guardrail against spec drift.
The authoritative specs live in `openspec/specs/<capability>/spec.md`; the data model
is `erp_approval_system.dbml` (37 tables). When a prompt conflicts with these, the
specs win — surface the conflict instead of silently following the prompt.

## Tech stack
**Backend:** NestJS (TypeScript, Node 20+) · PostgreSQL 15+ · MikroORM · REST+JSON ·
JWT auth · class-validator DTOs · Vitest + Playwright · S3/MinIO for files.
**Frontend:** Vue 3 (`<script setup>`, TS) · PrimeVue 4 (Aura, `.dark` selector) ·
PrimeIcons · Tailwind + tailwindcss-primeui · `@primevue/forms` + Zod (`zodResolver`) ·
Pinia.
Money is always DECIMAL/NUMERIC carried as string or Decimal — **never** a JS number,
on either side of the wire.

## Non-negotiable invariants
Treat these as hard constraints. If a task would violate one, stop and flag it.

1. **Company isolation.** Every main table is scoped by `company_id`. Queries filter
   by the active company first, then by permission scope. Data never crosses companies
   except GROUP-scope reads (read-only). Inter-company transfers are forbidden.
2. **Append-only ledgers.** `budget_txn` and `approval_log` are insert-only. Never
   UPDATE or DELETE a row. Corrections are new rows.
3. **Derived balances.** Budget balance = amount_total + ADJUST_INCREASE
   − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT − RESERVE + RELEASE, in the company
   base currency. ACTUAL is **not** a deduction: it converts money RESERVE already took
   out of the budget into money spent, so the un-released reserve *is* the spend
   (outstanding = Σ RESERVE − Σ RELEASE − Σ ACTUAL). Subtracting ACTUAL as well charges
   the budget twice. Never overwrite `budget.amount_total` to reflect usage.
4. **Reserve → actual → release.** Reserve on submit; convert to actual on
   receipt/payment; release the unused difference. Reject/cancel ALWAYS auto-releases
   reserved budget and quota.
5. **Permission codes, not role names.** Authorize on codes like `DOC_PR_APPROVE`.
   Role names are per-company labels and may collide across companies.
6. **Locked FX.** The exchange rate is stamped on the document at submit and never
   recomputed. FX gain/loss at payment goes to accounting, not to the budget.
7. **Configuration over code.** Document behavior comes from `document_type` flags
   (`requires_budget`, `requires_quota`, `post_action`), the form from
   `form_template`/`form_field`, the routing from `workflow`. Don't hardcode per-type
   logic — branch on configuration.
8. **No self-approval.** A user cannot approve a document they created, directly or via
   delegation. Delegation cannot be chained.

## Concurrency rules (MikroORM)
- Wrap any unit of work that writes `budget_txn` or `quota_usage` in a single
  `em.transactional(...)` so paired rows (e.g. TRANSFER_OUT + TRANSFER_IN) commit
  atomically.
- Reserve budget and issue document numbers under `LockMode.PESSIMISTIC_WRITE`
  (SELECT FOR UPDATE) to prevent over-commit and duplicate numbers.
- Every endpoint that reserves budget or issues a number needs a concurrency test.

## Frontend conventions
- Forms use `@primevue/forms`: `<Form :resolver :initialValues @submit>` with
  `<FormField>`; the resolver is `zodResolver(schema)` from
  `@primevue/forms/resolvers/zod`. Show field errors with
  `<Message v-if="$form.<field>?.invalid">{{ $form.<field>.error.message }}</Message>`.
- One Zod schema per form, mirroring the backend DTO. Client and server validation
  must not drift — prefer a shared schema package as the single source of truth.
- Show/hide and enable/disable UI by **permission code** from the active-company
  context (Pinia), mirroring the server's scope rules. The client guard is UX only;
  the server still enforces.
- Style with PrimeUI theme tokens via `tailwindcss-primeui`; no hardcoded colors, so
  light/dark both work. Icons are PrimeIcons (`pi pi-*`).
- Format amounts using the currency's `decimal_places`; never use a JS number for money.

## Working with OpenSpec
- Implement through changes: `/opsx:propose <capability/slice>` → review → `/opsx:apply`.
- Source specs use RFC 2119 (SHALL/MUST/SHOULD/MAY); scenarios are Given/When/Then with
  four-hashtag `#### Scenario:` headers. Match this when editing specs.
- Reference table/column names from the DBML exactly. Don't invent tables without a
  proposal; if a table seems missing, propose it rather than improvising.

## Build order (dependencies flow downstream)
multi-company → rbac → master-data → multi-currency → budget-control →
quota-management → document-engine → approval-workflow → notifications

## Definition of done (per slice)
Migration + entities match the DBML · service enforces the invariants above ·
DTOs validated · permission-code guard on every endpoint · company scope applied ·
unit tests for business rules · concurrency test where budget/numbering is touched.
