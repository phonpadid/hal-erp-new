## Context

The Budget Control backend is feature-complete and spec-aligned. The frontend exposes only
read screens (`BudgetListView`, `BudgetDetailView` with breakdown + ledger) and an Adjust
dialog. Three user-facing gaps remain, all confirmed against the code:

1. **No create/edit budget UI** — `POST /budgets` and `PATCH /budgets/:id` exist (gated
   `BUDGET_MANAGE`) but have no Vue screen, so budgets can only be created via API/seed.
2. **No approval-gated transfer path** — adjustment has `BudgetAdjustmentService.create()` +
   `POST /budgets/:id/adjustments`, but transfer has only the *manual*
   `POST /budgets/transfer` that writes `budget_txn` immediately (no approval). The
   post-action `TRANSFER` case (`post-action.service.ts:42`) already consumes a
   `budget_movement`, and `BUDGET_TRANSFER` is **not** seeded as a document type. So both an
   intake service and a doc-type seed are missing before any UI can exist.
3. **Money formatting** — budget list/detail call `formatAmount()` with no `decimalPlaces`,
   defaulting to 2 — wrong for 0/3-decimal currencies and a violation of the money invariant.

Constraints: company isolation (#1), append-only ledger (#2), derived balance never written
back over `amount_total` (#3), permission-code gating (#6), money as string/Decimal with the
currency's `decimal_places` (never a JS number). The transfer must stay approval-gated — the
client only creates a document.

## Goals / Non-Goals

**Goals:**
- A `BUDGET_MANAGE` create/edit budget form (dimension + amount + policy), reusing the
  existing endpoints, that never offers `amount_total` for edit.
- An approval-gated transfer: a new backend intake mirroring the adjustment intake, plus a
  budget-aware transfer dialog that creates the document and routes to it.
- Currency-correct money formatting on every budget screen.
- en/la i18n parity and PrimeUI-token theming for all new UI.

**Non-Goals:**
- No change to the reserve/actual/release engine, the post-action TRANSFER/ADJUST execution,
  or the append-only ledger — those are done and stay untouched.
- No standalone "execute transfer" UI on top of the manual `POST /budgets/transfer` (that
  endpoint stays as a dev/test affordance; the user-facing path is the approvable document).
- No carry-forward, no bulk budget import, no budget delete (out of scope).
- No Playwright suite added here (Vitest store/component tests only, matching the repo).

## Decisions

### D1 — Transfer intake mirrors `BudgetAdjustmentService`, not the manual execute endpoint
Add `BudgetTransferService.create(dto)` that creates a `Document` (type `BUDGET_TRANSFER`,
`post_action = TRANSFER`) **plus** a `BudgetMovement` (`movementType = 'TRANSFER'`,
`fromBudget`, `toBudget`, `amount`, `reason`) in one `em.transactional()`, writing **no**
`budget_txn`. Expose it as `POST /budgets/transfers` (`BUDGET_MANAGE`), with
`CreateTransferDto { fromBudgetId, toBudgetId, amount, reason }`.
- *Why:* keeps the ledger approval-gated and append-only (#2). The paired TRANSFER_OUT/IN is
  written only by the existing post-action on full approval.
- *Routing:* the transfer document routes by the **source** budget's department (the one
  giving up money), resolved via `DeptDocTypeService.resolve(fromBudget.department.id, …)` —
  same mechanism the adjustment intake uses.
- *Alternative rejected:* point the dialog at `POST /budgets/transfer` (manual execute). It
  writes the ledger immediately, bypassing approval — contradicts the budget-control
  "Budget Transfer via Approved Document" requirement and bullet #4.

### D2 — Validate transfer constraints at intake, re-validate at execution
At intake, fail fast (400) when: source = destination, source/destination in different
companies, or different fiscal years, or `amount <= 0`, or a budget is outside the active
company (NotFound via the company-scoped `BudgetService.get`). The active company is taken
from `RequestContext`, never the client.
- *Why:* gives the user an immediate error instead of a rejected approval days later.
- The existing `executeTransfer()` already re-checks company/year and real available balance
  under a pessimistic lock at approval time — intake validation is UX, execution validation
  is authority. Available-balance is intentionally **not** hard-blocked at intake (balance
  can change before approval); the dialog shows it for guidance only.

### D3 — Budget create/edit is a dedicated form view, not a dialog
New `views/budgets/BudgetFormView.vue` at routes `budgets/new` and `budgets/:id/edit`
(`meta.permission = 'BUDGET_MANAGE'`). Create posts `{ fiscalYearId, departmentId, glAccount,
budgetName?, amountTotal, controlPolicy }`. Edit patches only `{ budgetName?, controlPolicy?,
status? }` — the form **omits `amount_total` in edit mode** (invariant 3); the field renders
read-only with a hint that changes go through Adjust.
- *Why a full view:* the dimension form (3 selects + amount + policy) is larger than a dialog
  and benefits from a dedicated route for deep-linking and validation.
- One Zod schema (`@primevue/forms` + `zodResolver`) mirrors `CreateBudgetDto`/`UpdateBudgetDto`;
  `amountTotal` is a string field validated as a positive decimal, never coerced to a number.

### D4 — Money formatting via the currency context
Replace bare `formatAmount(x)` calls in `BudgetListView`/`BudgetDetailView` with the
currency-aware `useFormat().formatMoney(x, currency)` (or `formatAmount(x,
currency.decimalPlaces)`). The budget's currency is the **company base currency** (budgets
are base-currency, invariant 3/8); resolve it from the active-company context in Pinia so the
list (which lacks per-row currency) can still format correctly.
- *Why:* one source of decimal places (the company base currency) is correct for budgets and
  avoids per-row currency lookups.

### Sequence — transfer creation (no `budget_txn` written here)
```
User → Transfer dialog (pick from/to budget, amount, reason)
  POST /budgets/transfers            [guard: BUDGET_MANAGE]
    BudgetTransferService.create():
      RequestContext.companyId()      ← server-trusted active company
      from = BudgetService.get(fromBudgetId)   ← company-scoped (NotFound if cross-company)
      to   = BudgetService.get(toBudgetId)
      assert from ≠ to, from.company == to.company, from.fy == to.fy, amount > 0
      docType = BUDGET_TRANSFER (post_action TRANSFER)
      mapping = DeptDocTypeService.resolve(from.department, docType)
      em.transactional(em):                      ← single UoW
        docNo = NumberingService.next(...)       ← SELECT FOR UPDATE on running number
        persist Document(status DRAFT, ...)
        persist BudgetMovement(TRANSFER, fromBudget, toBudget, amount, reason)
      return { documentId }
  → client routes to /documents/:documentId to submit for approval
```
The `budget_txn` paired TRANSFER_OUT/IN is written later, only by the existing post-action
`TRANSFER` handler on full approval, inside its own `em.transactional()` with both budgets
locked `PESSIMISTIC_WRITE` in sorted id order (unchanged by this change).

### Transaction boundary & locking
- **Intake (this change):** `Document` + `BudgetMovement` insert in one `em.transactional()`;
  the document number is allocated under `SELECT FOR UPDATE` (existing `NumberingService`). No
  budget rows are locked — no `budget_txn` is touched, so no over-commit risk at intake.
- **Execution (unchanged):** `executeTransfer()` locks source and destination budgets with
  `LockMode.PESSIMISTIC_WRITE` in deterministic id order and writes the paired rows in one
  transaction.

## Risks / Trade-offs

- **[Available balance shown at intake can be stale]** → It is advisory only; the authoritative
  real-available check happens under lock at approval. Label it as "available now."
- **[`BUDGET_TRANSFER` doc type not seeded in existing DBs]** → Seed it in `seed-data.ts` and
  document that environments seeded before this change must re-run the doc-type seed; intake
  returns a clear 400 ("BUDGET_TRANSFER document type is not configured") if missing, matching
  the adjustment behavior.
- **[Editing `amount_total` would corrupt derived balance]** → The edit DTO already omits it;
  the form omits the field in edit mode and the server ignores it — defense in depth.
- **[List has no per-row currency]** → Use the company base currency from context; correct
  because budgets are always base-currency.
- **[Client/server validation drift]** → One Zod schema per form mirrors the DTO; transfer
  same-company/year rules are enforced server-side regardless of the client.

## Migration Plan

1. Backend: add `BudgetTransferService`, `CreateTransferDto`, controller route, wire into
   `BudgetControlModule`; add the `BUDGET_TRANSFER` doc type to `seed-data.ts`.
2. Run the seed (or a targeted doc-type upsert) in each environment so `BUDGET_TRANSFER` exists.
3. Frontend: add API client methods, store actions, `BudgetFormView`, transfer dialog, router
   entries, i18n keys, and the formatting fix.
4. Rollback: the additions are new endpoints/screens; reverting the frontend hides the
   affordances, and the new endpoint/doc-type are inert if unused (no ledger writes happen at
   intake). No data migration to undo.

## Open Questions

- Should the source budget's department or the **creator's** department drive transfer routing
  when they differ? Default chosen: the source budget's department (the money's owner). Confirm
  with approval-config owners if a different routing is expected.
- Should `status` transitions on a budget (ACTIVE/INACTIVE/CLOSED) be constrained (e.g. block
  CLOSED while outstanding reservations exist)? Out of scope here; flag for a follow-up if the
  product wants guardrails.
