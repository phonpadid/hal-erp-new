## 1. The two figures

- [x] 1.1 The budget side per account × fiscal year: appropriated, committed, consumed (design D2),
      reusing the existing balance derivation rather than a second formula.
- [x] 1.2 The ledger side: `Σ debit − Σ credit` over lines whose entry date falls in the fiscal
      year's range, taken in the account's natural direction.
- [x] 1.3 The fiscal year comes from `entry_date`, never from a timestamp.
- [x] 1.4 Company-scoped; nothing is written.

## 2. The decomposition

- [x] 2.1 Ledger movement whose source has no `ACTUAL`, grouped by `source_type`.
- [x] 2.2 The capitalised-into-stock share, taken per document as `ACTUAL` on the account minus what
      that document's entries debited there — NOT re-derived from the stock lines (design D3).
- [x] 2.3 `ACTUAL` rows whose document has no journal entry at all.
- [x] 2.4 The unexplained remainder, per account.
- [x] 2.5 The vouchers-on-budgeted-accounts figure and the vouchers behind it (design D6).

## 3. The blind spot

- [x] 3.1 A read of `SKIPPED` postings whose document has no `ACTUAL`, with the document's number,
      status and total.
- [x] 3.2 Classified at read time, not stored (design D5). No schema change.
- [x] 3.3 The undelivered read and the period close are untouched — assert it.

## 4. The endpoints

- [x] 4.1 The reconciliation, gated by `REPORT_VIEW`, company-scoped.
- [x] 4.2 The skipped-for-want-of-budget read, gated the same way.
- [x] 4.3 Money as decimal strings on the wire.

## 5. The client

- [x] 5.1 api + store + a reconciliation screen for a chosen fiscal year.
- [x] 5.2 The unexplained remainder on the row, not only in the expansion; marked when non-zero.
- [x] 5.3 The skipped documents shown on the same screen.
- [x] 5.4 Amounts through `fmtBase`; i18n in three locales.

## 6. Tests

- [x] 6.1 An account with budget-derived postings only reconciles to an unexplained remainder of
      zero — the case that proves the arithmetic before any exception is added to it.
- [x] 6.2 A manual voucher on a budgeted account lands under `MANUAL_JV` and leaves the remainder
      zero.
- [x] 6.3 A stock purchase lands under capitalisation and leaves the remainder zero.
- [x] 6.4 A reversal reduces the ledger movement and does NOT reduce `consumed` — the divergence
      stated as a test, since it is the behaviour a later change may decide to alter.
- [x] 6.5 Movement dated outside the fiscal year is excluded — with a fixture whose dates differ,
      not one where they coincide.
- [x] 6.6 A document with no budget appears in the skipped read and contributes nothing to the
      reconciliation — both halves asserted, since the point is that one is blind and the other is
      not.
- [x] 6.7 A `SKIPPED` posting whose document DID charge a budget is absent from the skipped read.
- [x] 6.8 Company isolation on both reads.
- [x] 6.9 Neither read writes anything — counted before and after.
- [x] 6.10 Each new test must fail with its feature removed. Check it.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
- [x] 7.2 No migration in this change — confirm the schema is untouched.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand.
