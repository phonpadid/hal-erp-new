## 1. Align the specs with invariant 3

The corrected requirement text lives in this change's `specs/` deltas, which `/opsx:archive` syncs
into `openspec/specs/`. Editing `openspec/specs/` here would apply the same correction twice.

- [x] 1.1 `specs/budget-control/spec.md` delta — `Derived-Balance Breakdown Query`: `− ACTUAL` gone
      from the `Components reconcile to available` scenario, the requirement body states that ACTUAL
      is reported but never subtracted, cross-referencing `Append-Only Budget Ledger` /
      `Outstanding Reservation Accounting` so the next reader lands on the rule rather than on a
      second opinion, and the settled-document scenario is present (design D3).
- [x] 1.2 `specs/reporting/spec.md` delta — `Real-Time Budget Balance Report by Department and
      Category`: `− ACTUAL` gone from the formula in the requirement body. `Derived Budget Figures`:
      `− ACTUAL` gone, `consumed = Σ RESERVE − Σ RELEASE` stated explicitly with both rejected forms
      and why they are rejected (design D1), the existing zero-ACTUAL scenario kept, the
      settled-document and reconciliation scenarios added.
- [x] 1.3 Both deltas restate each MODIFIED requirement in full — the archive step replaces the
      requirement wholesale, so anything omitted from a delta is deleted from the spec.
      `openspec validate report-the-budget-spend-once` passes.
- [x] 1.4 Grep the repo for any other `− ACTUAL` / `+ ACTUAL` formula outside `budget_txn` type
      lists — `openspec/specs/`, `CLAUDE.md`, `erp_approval_system.dbml`, `back/src`,
      `front-end/src` — and confirm the passages above were the only drifted ones. Record
      the result in the task rather than leaving it implicit.

      **Result:** exactly three drifted passages, all covered by this change's deltas —
      `openspec/specs/reporting/spec.md:33` (Real-Time Budget Balance Report),
      `openspec/specs/reporting/spec.md:233` (Derived Budget Figures), and
      `openspec/specs/budget-control/spec.md:376` (Derived-Balance Breakdown Query).
      `CLAUDE.md:29` and the `budget` note in `erp_approval_system.dbml:476` also match the grep but
      are **correct**: they state the *outstanding* formula `Σ RESERVE − Σ RELEASE − Σ ACTUAL`, which
      is a different quantity from available and does subtract ACTUAL by design. No occurrence in
      `back/src`, `front-end/src` or `shared` outside `BudgetTxnType` enum members.

## 2. Fix the utilization computation

- [x] 2.1 `back/src/modules/reporting/reporting.service.ts` — `budgetUtilization`: the
      per-department accumulator carries `released` instead of `actual` (the group rows already
      supply it, `BudgetBalanceGroup.released`), and `consumed = Money.subtract(e.reserved,
      e.released)`.

      **Deviation from design D2:** D2 said to keep `actual` on the accumulator unread. It was
      dropped instead — `BudgetUtilizationRow` never exposed it, so nothing observable changes, and
      an accumulated-but-unread `actual` next to `reserved` is the exact invitation that produced
      `reserved + actual`. D2 has been updated to record this.
- [x] 2.2 Replace the method's doc comment: it currently says `consumed = reserved + actual` and
      claims the figure "can never disagree" with the balance groups. State the new formula, and
      state *why* — ACTUAL draws down a reservation already counted — so the next reader does not
      re-derive the wrong one from the field names. The comment also records why
      `amountTotal − available` is rejected (design D1), since that is the form a reader is most
      likely to reach for next.
- [x] 2.3 Confirm `BudgetUtilizationRow` and its DTO are unchanged, so
      `front-end/src/api/reports.ts` and `BudgetUtilizationReport.vue` need no edit.

      **Result:** `BudgetUtilizationRow` (`reporting.service.ts:146`) is untouched — the changed
      type is the local accumulator intersection only. No frontend edit.

## 3. Tests

Three fixture budgets in their own departments (`UTIL-SETTLED` / `UTIL-PARTIAL` / `UTIL-DECREASED`,
GL 5100 / 5200 / 5300, 1,000,000 each), so the existing assertions keep their numbers. Their
`budget_txn` rows hang off a dedicated DRAFT document `PR-UTIL-1`, not `PR-RES-1`: the budget-audit
spec filters that document's movements and asserts the exact pair it carries.

- [x] 3.1 `back/src/modules/reporting/reporting.service.spec.ts` — a budget with RESERVE 100,000,
      ACTUAL 90,000, RELEASE 10,000 asserts `consumed` 90,000 and `utilizationPct` 9 on a
      1,000,000 budget. This is the case the old code gets wrong (190,000) and no existing test
      covered.
- [x] 3.2 Same file — a partially received order (RESERVE 100,000, ACTUAL 60,000, RELEASE 0, so
      40,000 still outstanding) asserts `consumed` 100,000: outstanding reservations are consumption
      too, which distinguishes `Σ RESERVE − Σ RELEASE` from `Σ ACTUAL`.
- [x] 3.3 Same file — asserts `consumed + available == amountTotal` across every department whose
      budgets carry no adjustment or transfer, pinning the reconciliation the old code broke.
- [x] 3.4 A budget carrying an `ADJUST_DECREASE` of 200,000 with 50,000 reserved asserts
      `available` 750,000 and `consumed` 50,000 — the decrease does **not** appear in `consumed`,
      pinning the rejection of `amount_total − available` (design D1).
- [x] 3.5 Run the existing budget and reporting suites unchanged — `BudgetBalanceService` is not
      modified and its tests must stay green without edits, which is the check that this change
      corrected the report rather than the reference implementation.

      **Result:** `npx vitest run` — **1320 passed, 36 skipped, 0 failed** (129 files). `nest build`
      clean. One pre-existing assertion changed, and it is the behaviour this change deliberately
      alters: the utilization spec asserted `consumed` 250,000 / 25% on a fixture holding RESERVE
      250,000 **and RELEASE 50,000**, and now asserts 200,000 / 20%. That fixture is itself evidence
      of the defect — under the old formula its `consumed` (250,000) plus its `available` (800,000)
      came to 1,050,000 against a 1,000,000 budget. Every `BudgetBalanceService` assertion stands
      unedited.
