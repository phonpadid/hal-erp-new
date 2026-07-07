## 1. Data model & migration

- [x] 1.1 Add `journal_entry` to `erp_approval_system.dbml`: `id`, `company_id`, `entry_date`, `source_type`, `source_id`, `memo`, `created_by`, `created_at`, with unique `(company_id, source_type, source_id)` for idempotency.
- [x] 1.2 Add `journal_line` to the DBML: `id`, `company_id`, `journal_entry_id`, `account_id`, `debit decimal(15,2)`, `credit decimal(15,2)`, `memo`, indexed on `journal_entry_id` and `account_id`.
- [x] 1.3 Add `account_role` to the DBML: `id`, `company_id`, `role` enum (CASH_CLEARING/FX_GAIN/FX_LOSS), `account_id`, unique `(company_id, role)`.
- [x] 1.4 Add the `account_role` enum + a `journal_source_type` (or plain varchar) to `back/src/common/enums`.
- [x] 1.5 Create MikroORM entities `JournalEntry`, `JournalLine`, `AccountRole` (company-scoped; JournalLine → JournalEntry + Account; AccountRole → Account).
- [x] 1.6 Generate the migration (create the three tables + constraints/indexes) and verify it applies cleanly.

## 2. Append-only enforcement & permission code

- [x] 2.1 Add `JournalEntry` and `JournalLine` to the `LedgerGuardSubscriber` append-only set so UPDATE/DELETE throw.
- [x] 2.2 Add the `GL_VIEW` permission code (registry + seed grant to admin).

## 3. Backend: GL module & posting engine

- [x] 3.1 Scaffold a `general-ledger` (gl) NestJS module: entities wiring, posting service, journal read service, controller, DTOs; import the accounting module for the account resolver.
- [x] 3.2 Implement `AccountRoleService.resolve(companyId, role)` → account, throwing/logging when unmapped/inactive/other-company.
- [x] 3.3 Implement `GlPostingService.postForPayment(documentId)`: in one `em.transactional()`, read the payment (base_locked, base_actual, fx_delta, fx_kind) and the document's budget-line accounts; build a balanced entry (Dr expense per account at locked base, Cr cash-clearing at actual base, FX line for the delta); assert Σdebit = Σcredit; persist header + lines. Writes no `budget_txn`.
- [x] 3.4 Enforce idempotency: check `(company, source_type='PAYMENT', source_id)` first; no-op if an entry exists (safe for event retries).
- [x] 3.5 Subscribe to `payment.settled` (a listener in the gl module, or extend the existing seam) and call `postForPayment`; catch + log failures so the payment flow is never affected.
- [x] 3.6 Implement the company-scoped, read-only journal query (entries with their lines) and the `GL_VIEW`-gated controller endpoint (`ParseUUIDPipe` on id params).

## 4. Seed

- [x] 4.1 Seed default `account_role` mappings per company (CASH_CLEARING → a cash account, FX_GAIN / FX_LOSS → seeded FX accounts), adding those accounts to the chart of accounts if not already seeded.

## 5. Frontend

- [x] 5.1 Add a typed API client + Pinia store for the journal (paged read).
- [x] 5.2 Add a read-only Journal view (entries with expandable balanced lines: account, debit, credit) gated by `GL_VIEW`, with route + nav entry.
- [x] 5.3 Add i18n keys (en + la) for the journal view, roles, and columns.

## 6. Tests

- [x] 6.1 Unit: posting for a no-FX settlement produces a balanced 2-line entry (Dr expense, Cr cash) equal on both sides.
- [x] 6.2 Unit: posting for an FX loss and an FX gain each produce a balanced entry with the FX line on the correct side (Σdebit = Σcredit).
- [x] 6.3 Unit: the balanced-entry assert rejects an unbalanced entry and writes no line.
- [x] 6.4 Unit: idempotency — a second `payment.settled` for the same document posts no second entry.
- [x] 6.5 Unit: a missing `account_role` mapping makes the posting a logged no-op and does not throw into the payment flow.
- [x] 6.6 Unit: append-only — UPDATE/DELETE of a `journal_entry` / `journal_line` is rejected.
- [x] 6.7 Unit: company isolation + authorization — the journal read returns only the active company's entries and rejects requests without `GL_VIEW`.
- [x] 6.8 Frontend: the journal view renders entries with balanced debit/credit lines.
