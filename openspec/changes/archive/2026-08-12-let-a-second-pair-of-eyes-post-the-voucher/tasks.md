## 0. The conflict this change resolves

- [x] 0.1 `A Person Can Post A Journal Voucher` stated there SHALL be no separate voucher header,
      because "a second table would duplicate it with an opportunity to disagree". Right for a
      direct post, and incompatible with an approval step: a pending voucher must exist somewhere
      before it is an entry, and an append-only ledger cannot hold one. MODIFIED, with the
      duplication concern answered in the requirement itself — the entry is created FROM the
      voucher, once, and never edited, and the voucher's id IS the entry's `source_id`.
      Surfaced to the user before implementing rather than decided quietly.

## 1. The draft

- [x] 1.1 `JournalVoucher` + `JournalVoucherLine`: company, entry date, memo, status
      (`PENDING | APPROVED | REJECTED | WITHDRAWN`), `reverses_entry_id`, created by, decided
      by/at, reject reason.
- [x] 1.2 DBML for both, with the note saying why the header exists.
- [x] 1.3 `Migration20260819000000`. No data change — entries posted under the old direct-post rule
      stand.

## 2. Submitting

- [x] 2.1 `submit` validates balance, one non-zero side per line and account resolvability, then
      writes the voucher and nothing else.
- [x] 2.2 A voucher that could never post is refused at submit, so no checker is asked to read it.
      The balance check moved from `createEntry` to submit-time, which changed its message from
      `Unbalanced` to `does not balance` — the existing test was updated rather than the message
      bent to fit it.

## 3. Approving, rejecting, withdrawing

- [x] 3.1 `approve` posts through `createEntry`, dated the VOUCHER's date, keyed
      `(company, MANUAL_JV | REVERSAL, voucherId | reversedEntryId)`.
- [x] 3.2 The submitter cannot approve, enforced in the service.
- [x] 3.3 `reject` requires a reason and posts nothing.
- [x] 3.4 Approving twice resolves to the entry already written.
- [x] 3.5 `GL_JV_APPROVE` added; `GL_JV_POST`'s comment rewritten to say it now submits.
- [x] 3.6 `withdraw` by the author only, while pending (design D6).
- [x] 3.7 Not in the plan: a SECOND reversal is refused while the first is merely PENDING. Two
      pending reversals of one entry would both be approvable and the loser would fail at the unique
      index with nobody having been told.

## 4. Reads and endpoints

- [x] 4.1 `GET /journal/vouchers/pending` under `GL_VIEW`.
- [x] 4.2 `POST /journal/vouchers` submits; `/approve` and `/reject` under `GL_JV_APPROVE`;
      `/withdraw` under `GL_JV_POST`; `POST /journal/:id/reverse` now submits a reversal.
- [x] 4.3 No direct-post endpoint beside the control.

## 5. The client

- [x] 5.1 The voucher form submits for approval and says so — the button reads "submit for
      approval", the success toast says submitted, and the doc comment states it does not post.
- [x] 5.2 `PendingVouchersView` with approve/reject gated by `GL_JV_APPROVE`, reject requiring a
      reason, and withdraw on the viewer's own.
- [x] 5.3 The approve control is NOT hidden on a viewer's own voucher — it is marked. The server
      refuses self-approval and its refusal is the one that matters; hiding it would make a rule
      look like a missing feature.
- [x] 5.4 Route, i18n in three locales, smoke registry entry.

## 6. Tests

- [x] 6.1 Submitting writes no entry.
- [x] 6.2 Approval by a second user writes it, with the voucher's date and the SUBMITTER as author.
- [x] 6.3 Self-approval refused even holding both codes.
- [x] 6.4 Rejection needs a reason and posts nothing.
- [x] 6.5 Approving twice posts once.
- [x] 6.6 A voucher whose period closed between submit and approval is refused at approval — and the
      same case shows its author withdrawing it, which is why withdrawal exists.
- [x] 6.7 Company isolation on the pending read.
- [x] 6.8 Existing tests updated, not deleted. Thirteen cases in `journal-voucher.spec.ts` pinned
      direct posting; `year-close.spec.ts` used a voucher as the way to give a year something to
      close and now approves it with a second user. Neither file's subject changed.
- [x] 6.9 Negative check on eight behaviours, backend and front: self-approval allowed, posting at
      submit, reject without a reason, withdraw by anyone, the approver recorded as the entry's
      author, the approve control without its code, hiding it on one's own voucher, and the client
      reject without a reason. Each reddens the case that claims it.

## 7. Checks

- [x] 7.1 Backend and frontend suites, `nest build`, `typecheck` — reported in the summary.
- [x] 7.2 `npm run migration:up` applied `Migration20260819000000` against the real database.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 `openspec/specs/**` untouched.
