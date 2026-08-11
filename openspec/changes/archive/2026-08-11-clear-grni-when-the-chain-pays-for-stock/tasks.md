## 1. Resolve the account through the chain

- [x] 1.1 `back/src/modules/gl/gl-posting.service.ts` — `stockPortionByAccount`: when a line carries
      no `budget`, fall back to the lines of the document this settlement actually charged, matched
      by `lineNo`.

      **Revised from the design while implementing (D1 updated).** The plan was to walk
      `ref_document_id` for the nearest ancestor carrying a `RESERVE`, mirroring
      `PostActionService.reservingAncestorBudgetByLine`. Writing the test showed the better answer:
      `postForPayment` has already walked the chain in `settlementActuals`, and the document it
      landed on is the one `perAccount` is keyed by. Passing that id down gives one walk and one
      answer, and the accounts agree with the expense side by construction instead of because two
      independent derivations happen to match. The second traversal disappeared rather than being
      written.
- [x] 1.2 Resolve the account from that budget, **not** from the item's `default_gl_account`
      (design D1). The item route lands on the same account today and drifts silently the moment an
      item's default GL is edited after its PR was approved — and the spec requires the stock figure
      and the cut to agree by construction, not by currently matching.
- [x] 1.3 Leave the `capped` guard exactly as written. It has never bound on a chained document
      because the share was always zero; once the share is real it does its job, and rewriting it in
      the same change would make it impossible to see that the guard is what stopped an overshoot
      rather than the new lookup (design D2).
- [x] 1.4 Comment at the fallback that `create-from` copies a chain 1:1 with `lineNo` preserved, and
      that this is the assumption `cutBudget` already runs on — so it is shared, not new, and a
      chain that broke it would strand the reservation long before the GL saw it (design D3).

## 2. Spec

The requirement text lives in this change's `specs/gl-journal/spec.md` delta, which `/opsx:archive`
syncs into `openspec/specs/`.

- [x] 2.1 `specs/gl-journal/spec.md` delta — MODIFIED `Settling a Stock Purchase Clears GRNI Rather
      Than Expense`, restated in full (archive replaces the requirement wholesale), stating that the
      account is resolved through the reference chain when the paying document's lines carry no
      budget, and why that is the ordinary case rather than an edge one.
- [x] 2.2 The delta keeps all four existing scenarios and adds the chain-settled one and the cap one.
      Anything omitted from a delta is deleted from the spec at archive.

## 3. Tests

This requirement has three written scenarios and **no** implementations — `GRNI` appears in
`stock-posting.spec.ts` only, which covers the receipt side, and the chain case in
`gl-posting.service.spec.ts` uses no items so it cannot reach the split. Building the fixture is
most of this change.

- [x] 3.1 Extend `gl-posting.service.spec.ts`'s `settle` helper so a document can carry lines: an
      item (stock-tracked or not), a `budget_base_line_amount`, and a `budget` — with the budget
      omitted on the paying document of a chained pair, which is the whole point.
- [x] 3.2 Self-settled stock purchase: the entry debits `GRNI` for the line's base amount and does
      not debit the expense account. This is scenario 1 of the requirement, previously untested.
- [x] 3.3 **Chain-settled stock purchase** (`PR` reserves, `DISB` references it and carries no line
      budget): the entry debits `GRNI`, not expense. This case fails before the fix — it is the
      defect, and it must be seen failing before 1.1 is applied.
- [x] 3.4 Mixed document: one stock-tracked line and one untracked line on the same budget split
      between `GRNI` and expense. Assert both sides, not just the total, since a wrong split still
      balances.
- [x] 3.5 A document with no stock-tracked line debits the expense account exactly as before —
      the regression guard for every non-stock purchase, which is most of them.
- [x] 3.6 The cap: stock-tracked lines totalling more than the amount cut on their account debit
      `GRNI` only up to the cut, with no negative expense line.
- [x] 3.7 Existing suites stay green with no edits — 1339 backend tests today. The receipt and issue
      postings are untouched, and every non-chained, non-stock settlement must post exactly what it
      posted before.

      **Result:** `npx vitest run` — **1344 passed, 36 skipped, 0 failed**, up from 1339 by the five
      cases added here. `nest build` clean. No existing assertion changed.

      Worth recording, because it narrowed the defect: with the fixture in place and before the fix,
      exactly ONE of the five new cases failed — the chain-settled one. The self-settled, mixed,
      no-stock and cap cases all passed on the old code. The split was never broken in general; it
      was broken only where the account had to come from another document, which is why nothing in
      the suite could see it and why the requirement's own scenarios would not have caught it either
      had they been written as stated — all three describe a self-settling document.
