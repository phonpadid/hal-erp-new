## Why

The claim system (HAL) raises a claim as a document here, waits for it to be approved, and then has
to learn two things from us: which budget its line charges, and whether the money has actually left.
Both answers stopped being reachable, and neither failure announced itself.

The paid-or-not read, `GET /documents/<id>/settlement`, was documented in
`docs/claim-integration.md` and lost when `document_settlement` was absorbed into `payment` — the
table's method, reference and date became columns there, but nothing kept the read. A caller polls
`GET /documents/<id>` for `COMPLETED` and asks the settlement once it reads so; with the read gone
the endpoint answers 404 for ever, which the contract defines as "approved, not yet paid". A claim
paid last Tuesday is indistinguishable from one finance has not got to, and no claim can be closed.

The budget half is the mirror image. Only the requester may choose between the budgets sharing an
account, and a machine requester had no way to see the list: `GET /budgets/selectable` takes a JWT
alone. So an API-key integrator could only guess a UUID or send a line naming no budget, which is
accepted into the DRAFT and refused at submit — on a document whose id the caller has already
persisted.

## What Changes

- **Restore `GET /documents/<id>/settlement`**, served from the `payment` row: `method` →
  `settlementType`, `paidAt` rendered as the **company's own day** → `settledAt`, and `reference`.
  Not-found stays the documented answer for an approved-and-unpaid document, and a document in
  another company stays not-found rather than a refusal.
- **Add `GET /documents/budgets`**, the same picker the create wizard uses, reachable by an API key.
  Identity only — no amounts — gated on `DOC_CREATE`, the grant the caller already needs to raise
  the document at all.
- **Say in `docs/claim-integration.md`** that every line must name a `budgetId`, where the id comes
  from, and that the settlement answer is read from the payment record — so the next time that
  record moves, the read moves with it.

No breaking change: both endpoints are additive, and the settlement response is the shape the
integration doc has always promised.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: adds two read requirements on the document API — whether a document's money
  has left, and which budgets a caller may charge a line to. Neither existed as a requirement; the
  settlement read lived only in the integration document, which is how it came to be dropped.

## Impact

- **Code**: `back/src/modules/document/document.controller.ts` (two routes),
  `back/src/modules/document/document.service.ts` (`settlement`, `selectableBudgets`), and a new
  `settlement-read.spec.ts`.
- **Data**: none. No migration, no new column, no write path — both endpoints are reads over
  `payment` and `budget` as they already stand.
- **Contract**: `docs/claim-integration.md` — the budget rule on lines, the budgets read, and a note
  on what backs the settlement answer.
- **Consumers**: the HAL claim line, which sends `budgetId` on every line and polls the settlement
  read (its own change: `fix-claim-erp-lines-name-a-budget`).
- **Invariants**: company isolation holds — both reads go through the active-company scope, and a
  cross-company document is not-found. Nothing touches `budget_txn` or `approval_log`, so the
  append-only ledgers are unaffected, and no budget balance is recomputed.
