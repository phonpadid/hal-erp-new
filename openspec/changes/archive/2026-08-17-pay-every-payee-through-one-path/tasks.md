## 1. The payment record

- [x] 1.1 `payment` gains `method`, `reference` and `note`. Migration + entity + DBML.
- [x] 1.2 `method` is validated against a supported set; an unsupported value is refused BY NAME,
      never coerced (the rule `settlement_type` already carried).
- [x] 1.3 Recording a payment accepts any document the company owes, by the SAME predicate the queue
      uses — shared, not restated (design D3).
- [x] 1.4 The ledger effect stays the existing accrued branch, which already clears whatever account
      the accrual credited (design D1). Assert it clears `CLAIM_PAYABLE` — do not add a branch.
- [x] 1.5 Withholding works whoever the payee is; nothing about WHT is vendor-conditional.
- [x] 1.6 Still no `budget_txn` (invariant 6); still one payment per document.

## 2. The queue

- [x] 2.1 Ready-to-Pay is one predicate: fully approved, no payment, no open batch, and owed —
      an accrual credited a payable OR the type's `post_action` is `CUT_BUDGET` (design D3).
      ONE implementation, shared with the record endpoint so they cannot disagree.
- [x] 2.2 Each row carries the kind of payable and who is owed.
- [x] 2.3 A document with no vendor still resolves a row — payee bank account absent, not an error.
- [x] 2.4 Company-scoped; nothing is written.

## 3. The evidence rule

- [x] 3.1 A payment with no batch behind it requires at least one evidence file, supplied in the same
      request (design D4).
- [x] 3.2 A payment produced by a batch import requires none, and may still be given one.
- [x] 3.3 Every refusal runs BEFORE anything is written — no `payment`, no attachment, no entry, and
      no object in storage. The upload happens after validation, not before it.
- [x] 3.4 The record endpoint accepts the file with the payment (multipart), the shape the settlement
      endpoint already used.

## 4. The payables read

- [x] 4.1 Open payables cover every payable account the ledger raises; the kind comes from the
      account the accrual credited, never from `document.vendor`.
- [x] 4.2 Who is owed: the vendor for a trade payable; the document's related employee for a claim;
      absent when none is named — never the document's author.
- [x] 4.3 A claim is due on its accrual's `entry_date` — no term, no default, not null (design D6).
- [x] 4.4 An unmapped payable role contributes no rows and does not fail the read.
- [x] 4.5 The ageing summary covers both kinds and reports a per-kind total beside the overall one.

## 5. The deletions

- [x] 5.1 Remove `document_settlement`: entity, migration (drop), DBML, `SettlementService`, its
      controller routes and DTOs.
- [x] 5.2 Remove `postSettlementClearing` and `SOURCE_SETTLEMENT` from the posting service.
- [x] 5.3 Remove the settlements api, store, view, route, nav entry and i18n keys in three locales.
- [x] 5.4 Delete the `web-settlement` capability's spec on archive — do NOT hand-edit
      `openspec/specs/**`.
- [x] 5.5 `GET /documents/unsettled` is gone; nothing references it.
- [x] 5.6 Grep for `settlement` across `back/src` and `front-end/src` afterwards — what remains must
      be the accrual's own vocabulary, not this flow's.

## 6. The seed

- [x] 6.1 Map `CLAIM_PAYABLE` to an account in the seeded chart.
- [x] 6.2 Seed a claim document type: accrues on approval, no vendor, no payee bank account, so the
      path is reachable on a fresh install (design D7).
- [x] 6.3 The seeded company therefore holds both an accrued disbursement and an accrued claim — the
      fixture the queue test needs.

## 7. Tests

- [x] 7.1 A claim is paid by recording a payment; the entry debits `CLAIM_PAYABLE` and credits
      cash-clearing, and balances.
- [x] 7.2 A vendor payment is unchanged — same lines, same FX, same WHT as before.
- [x] 7.3 The queue lists both a disbursement and a claim, and both leave it when paid.
- [x] 7.4 Both clauses of the predicate are exercised: a claim owed only by its accrual, and a
      `CUT_BUDGET` document that accrues nothing, are both listed and both payable.
- [x] 7.5 A hand-recorded payment with no file is refused, and NOTHING is written — including no
      object in storage, asserted against the storage service.
- [x] 7.6 A batch-produced payment needs no file.
- [x] 7.7 Withholding on a payment to a person stores `wht_amount` and produces its certificate.
- [x] 7.8 An open claim appears in open payables, aged from its accrual date with no term added.
- [x] 7.9 The per-kind totals sum to the overall total; the buckets sum to it too.
- [x] 7.10 A company with no `CLAIM_PAYABLE` mapped still reads its payables.
- [x] 7.11 FX revaluation still excludes claim payables (design D8) — the neighbouring read widened
      and this one did not.
- [x] 7.12 Company isolation on the queue, the record, and both reads.
- [x] 7.13 Concurrency: two records against one document still produce one payment.
- [x] 7.14 Each new test must fail with its feature removed. Check it.

## 8. Checks

- [x] 8.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1482 passed, 1 failed — `attendance-period.service.spec.ts` "rejects a correction into a
      closed period", which pins `2026-07-15` against a 30-day correction window and therefore fails
      on any run after 2026-08-14. Pre-existing, date-triggered, and untouched by this change.
      `nest build` clean; front-end 807 tests and `vue-tsc` clean (three duplicate `gl.payables.total`
      keys fixed here).
- [x] 8.2 The migration drops `document_settlement` and adds the three `payment` columns — nothing
      else. Schema and DBML agree.
- [x] 8.3 `openspec validate --all` passes.
- [x] 8.4 Do NOT edit `openspec/specs/**` by hand.
- [x] 8.5 The specs that enumerate the posting paths stop counting the deleted one. `gl-journal`'s
      constructor and entry-date requirements, and `accounting-period`'s closed-period guard, each
      listed "a claim settlement" as the fourth path; `platform-foundation` named the finance
      worklist by the removed `GET /documents/unsettled`. Carried as MODIFIED deltas so the sync
      applies them — not hand-edited into `openspec/specs/**`.
