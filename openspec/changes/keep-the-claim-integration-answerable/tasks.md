## 1. The paid-or-not read

- [x] 1.1 Add `DocumentService.settlement(id)`: assert the document is visible, find the `payment`
      naming it, and answer `{ settlementType, settledAt, reference }` from `method`, `paid_at` and
      `reference` — not-found when no payment names it
- [x] 1.2 Render `settledAt` with `localDateIn` in the company's timezone (`company.timezone`,
      falling back to UTC), so a late-UTC transfer reports the company's day
- [x] 1.3 Add `GET :id/settlement` to `DocumentController` under `DOC_VIEW`, beside the detail read
      so it inherits `JwtOrApiKeyGuard`

## 2. The budget picker for a machine requester

- [x] 2.1 Add `DocumentService.selectableBudgets()` delegating to `BudgetService.listSelectable()`,
      so the department scope resolves from `RequestContext` exactly as it does for a person
- [x] 2.2 Add `GET budgets` to `DocumentController` under `DOC_CREATE`, declared before `:id` so the
      literal path is not read as a document id

## 3. Tests

- [x] 3.1 `settlement-read.spec.ts`: not-found while approved and unpaid
- [x] 3.2 A recorded payment answers method, the company-local day (an instant that falls on the next
      day in Asia/Vientiane) and the reference
- [x] 3.3 A payment recorded without a reference still answers
- [x] 3.4 Another company's paid document is not-found, and its reference never appears
- [x] 3.5 Run with the test database pinned (`DB_NAME=erp_test`) — the specs call
      `refreshDatabase()`, and `back/.env` points `DB_NAME` at the live database

## 4. Contract

- [x] 4.1 `docs/claim-integration.md`: every line must name a `budgetId`, with the refusal it causes
      quoted, and `GET /documents/budgets` documented with its response shape and grant
- [x] 4.2 Note in the settlement section that the answer is read from the payment record, so the next
      move of that record keeps the read

## 5. Verification against a running stack

- [x] 5.1 `GET /documents/<id>/settlement` with an API key: 404 before payment, and
      `{TRANSFER, <day>, <reference>}` after finance records one
- [x] 5.2 `GET /documents/budgets` with an API key returns the list, no figures
- [x] 5.3 End to end with the HAL claim line: submit reserves the budget, two approvals complete the
      document, finance records the payment, and the consumer's poller reads the settlement and
      closes the claim
