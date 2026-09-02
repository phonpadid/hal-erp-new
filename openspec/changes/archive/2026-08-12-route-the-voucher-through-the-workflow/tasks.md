## 1. The document behind the voucher

- [x] 1.1 `journal_voucher.document_id` — nullable in the schema, required by the code once the
      migration has filled it; unique, so one voucher is one document.
- [x] 1.2 Drop `JournalVoucherStatus` as a field: `document.status` is the status (design D5). Keep
      `entry_date` and `reverses_entry_id`, which a document cannot express.
- [x] 1.3 Seed a `JV` document type: `requires_budget` / `requires_quota` / `requires_vendor` /
      `requires_item` / `requires_payee` / `requires_warehouse` all false, `post_action`
      `POST_JOURNAL`, and a form template with no fields (the form is bespoke — design D8).
- [x] 1.4 Seed a two-band workflow and map it to the accounting department via `dept_doc_type`.
      The band figures are DATA (design: proposal, "the ladder ships as data").

## 2. Submitting

- [x] 2.1 `submit()` creates the document (number, department from the preparer, workflow from
      `dept_doc_type`), stamps `total_amount` and `budget_base_total_amount` as Σ debits (design D2),
      writes the voucher and its lines, and starts routing.
- [x] 2.2 Every rule it checks today stays checked at submit: balance, one non-zero side per line,
      and account resolution through `AccountService.resolvePostable`.
- [x] 2.3 A voucher dated into a closed period is refused at submit (design D3).
- [x] 2.4 `submitReversal()` takes the same path with computed lines; still at most one reversal per
      entry, counting both posted reversals and vouchers still in approval.
- [x] 2.5 Idempotent on the voucher id, as it is today.

## 3. Approving

- [x] 3.1 `POST_JOURNAL` in `PostActionService`: posts the voucher's lines through `createEntry`,
      dated the voucher's `entry_date`, authored by the SUBMITTER, `source_id` the voucher (or the
      reversed entry).
- [x] 3.2 It writes no `budget_txn` and records no posting attempt, and `paymentReady` stays false.
- [x] 3.3 The period is checked before an approval is accepted, in front of the `approval_log`
      insert, naming the period and saying the author must withdraw and re-date (design D3).
- [x] 3.4 Self-approval, rejection with a remark, and cancellation by the author come from routing —
      the hand-written versions go (design D5).
- [x] 3.5 `GL_JV_APPROVE` still gates approving a voucher; routing eligibility decides WHO, the code
      decides whether they may act on vouchers at all.

## 4. The vouchers already waiting

- [x] 4.1 Migration: a document for every existing voucher, in the status matching its own — pending
      ones `SUBMITTED` and routed from the first applicable step (design D7).
- [x] 4.2 `down()` drops the link and leaves the documents, because deleting them would delete
      `approval_log` rows (invariant 2).
- [x] 4.3 The DBML gains `journal_voucher.document_id` and loses the status column.

## 5. The client

- [x] 5.1 The voucher form submits a document; the success message names the document number.
- [x] 5.2 The pending screen reads from the document side and shows the step and who it waits for.
- [x] 5.3 i18n in three locales; amounts through `fmtBase`.

## 6. Tests

- [x] 6.1 A voucher above the threshold needs both approvers; one below needs one — both asserted,
      since a ladder that never engages passes the second alone.
- [x] 6.2 The first approval posts nothing; the last one posts.
- [x] 6.3 The author cannot approve, and neither can someone the author delegated to (design D5).
- [x] 6.4 A voucher whose period closed while it waited is refused at the step, with no
      `approval_log` row written for the refusal.
- [x] 6.5 The entry's author is the submitter, not the last approver.
- [x] 6.6 A retried approval posts once.
- [x] 6.7 `total_amount` is Σ debits, not zero and not double — the case that decides the routing
      (design D1).
- [x] 6.8 A reversal rides the ladder too.
- [x] 6.9 Company isolation on the pending read.
- [x] 6.10 Each new test must fail with its feature removed. Check it.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
- [x] 7.2 `npm run migration:up` against the real database, with a pending voucher present.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand.
