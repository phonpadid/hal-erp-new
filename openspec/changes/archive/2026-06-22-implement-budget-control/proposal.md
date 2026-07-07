## Why

`budget-control` is where the platform's money invariants become real: the append-only
`budget_txn` ledger (invariant 2), balances **derived** by summation and never stored
mutably (invariant 3), the reserve → actual → release lifecycle (invariant 4), and
concurrency-safe reservation under row locks (CLAUDE.md). The scaffold ships the
entities (`budget`, `budget_txn`, `budget_movement`) and the seams
(`LedgerGuardSubscriber`, `AppendOnlyRepository`, `inTransaction`/`lockForUpdate`); this
change finally uses them in anger. It delivers the **budget ledger engine** that
document-engine (reserve on submit, settle on receipt) and approval-workflow (execute
transfers/adjustments on full approval) will call.

## What Changes

- **`BudgetControlModule`** registering the three entities, with services + controllers.
- **Budget registry**: CRUD for `budget` (per fiscal year + department + GL account),
  guarded by `BUDGET_MANAGE` / `BUDGET_VIEW`. `amount_total` is set at creation and
  **never overwritten** to reflect usage.
- **Derived balance** (`BudgetBalanceService`): `availableBalance(budgetId)` =
  `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT
  − RESERVE − ACTUAL + RELEASE`, summed from `budget_txn` in base currency
  (invariant 3). Exposed as a read endpoint and consumed by every check below.
- **Reserve on submit** (`reserve`): given a document id and per-line base-currency
  amounts, group by `budget_id`, lock each budget row `FOR UPDATE` inside one
  `em.transactional`, enforce the control policy (HARD_STOP blocks, SOFT_WARNING warns),
  and insert one RESERVE `budget_txn` per budget. Returns over-budget warnings.
- **Reserve → actual → release** (`settle`): on receipt/payment record ACTUAL for the
  consumed amount and RELEASE the unused reserved remainder for that document+budget.
- **Auto-release** (`releaseAll`): on reject/cancel, RELEASE the full outstanding reserved
  for the document (invariant 4 — reject/cancel always frees budget).
- **Transfer & adjustment execution** (`executeTransfer` / `executeAdjustment`): on a
  fully-approved `budget_movement`, write a paired TRANSFER_OUT + TRANSFER_IN (or a single
  ADJUST_INCREASE / ADJUST_DECREASE) atomically in one transaction. Transfers are
  rejected across companies and across fiscal years, and rejected if the source lacks
  sufficient available balance.
- **Append-only enforcement**: `budget_txn` is insert-only — writes go through the
  append-only path; the `LedgerGuardSubscriber` rejects any update/delete (invariant 2).
- **Concurrency test**: two concurrent full-balance reservations against a HARD_STOP
  budget — exactly one succeeds (required by CLAUDE.md for budget-reserving paths).

No schema change — the three entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `budget-control`: adds the concrete administration/accounting requirements the existing
  ten implied but did not pin down — budget registry administration with a derived-balance
  query (never mutate `amount_total`), the **outstanding-reservation accounting** that
  makes settle/auto-release exact, and authorized/company-scoped budget operations. The
  ten existing requirements are unchanged.

## Impact

- **Affected capability**: `budget-control` (unblocks document-engine reserve/settle and
  approval-workflow transfer/adjust execution).
- **Invariants exercised**: **2** (append-only ledger), **3** (derived balance, never
  overwrite `amount_total`), **4** (reserve→actual→release; reject/cancel auto-releases),
  plus the concurrency rule (PESSIMISTIC_WRITE + `em.transactional`), **1** (company
  isolation — transfers forbidden across companies), **5** (`BUDGET_VIEW`/`BUDGET_MANAGE`).
- **Code**: new `back/src/modules/budget/` services, controllers, DTOs, module; first
  real use of `LedgerGuardSubscriber`, `AppendOnlyRepository`, `inTransaction`,
  `lockForUpdate`. Registered in `AppModule`.
- **New permission codes**: `BUDGET_VIEW`, `BUDGET_MANAGE`.
- **Consumers (later)**: document-engine calls `reserve`/`settle`/`releaseAll`;
  approval-workflow calls `executeTransfer`/`executeAdjustment`. These are delivered and
  unit/concurrency-tested here.

## Out of Scope

- Document submission, lines, and the receipt flow that *trigger* reserve/settle
  (document-engine) — budget-control exposes the engine; callers supply document id +
  base-currency line amounts.
- Wrapping transfer/adjustment as approvable documents and routing them
  (document-engine / approval-workflow) — here the **execution** runs on an
  already-approved `budget_movement`.
- Currency conversion: amounts arrive already converted to the company base currency
  (multi-currency `convert`); the ledger is base-currency only.
- Payment-time FX gain/loss posting to accounting (a later payment slice).
