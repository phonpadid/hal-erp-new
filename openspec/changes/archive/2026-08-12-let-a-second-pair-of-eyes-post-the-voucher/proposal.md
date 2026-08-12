# Let a second pair of eyes post the voucher

## Why

`GlPermissions.GL_JV_POST` documents its own gap:

> Write a journal entry by hand, and reverse one. **The largest privilege in the system**: it is the
> only way a person writes the ledger directly, and it is guarded by this code rather than by an
> approval route. **Grant it to very few people until that route exists.**

The screen for it shipped and the route did not. One person holding one code can today debit and
credit any account in the company, in any amount, with no second party involved — while a
five-thousand-kip requisition passes through a configured approval chain.

That is the wrong way round. Every other value-moving act in this system is reviewed by somebody
other than the person who initiated it; the one act with no upper bound and no supporting document
is not.

## What Changes

- A `journal_voucher` draft: its date, memo, lines, and a status. Submitting a voucher records the
  intent; it does not touch the ledger.
- Approval posts it, through the same `createEntry` every other entry goes through. Rejection
  records a reason and posts nothing.
- `GL_JV_APPROVE`, a new code, gates approval.
- **No self-approval**: the person who submitted a voucher cannot approve it, whatever codes they
  hold — invariant 8, applied to the act it was written for.
- The submitter may **withdraw** a pending voucher of their own, so a voucher whose period closed
  before a checker reached it does not sit in the queue forever (design D6).
- Reversals are submitted and approved on the same path, so `GL_JV_POST` keeps one meaning.
- The voucher screen becomes submit-and-await rather than post-immediately, and a pending list shows
  what is waiting.

## What This Change Does NOT Do

- **Does not route vouchers through the document approval engine.** `approval_log.document` is a
  required foreign key to `document`, and a voucher is not a document: its lines are account, debit
  and credit, which `form_template` and `document_line` do not model. See design D1.
- No multi-step chain, no delegation, no amount thresholds. Maker-checker is the control the
  standard asks for here; a configurable chain is a bigger question and this change does not
  pre-empt its answer.
- No change to what a reversal IS: still keyed to the entry it reverses, still at most once, still
  dated the caller's choice. It does now pass the same checker, because it is a voucher whose lines
  were computed — see design D5, which corrects an earlier draft of this proposal that left
  reversals unreviewed.

## Impact

- Affected specs: `gl-journal`, `web-accounting`
- Affected code: new entity + migration + DBML, `journal-voucher.service.ts`, its controller and
  DTOs, `gl/permissions.ts`; frontend api/store/view, i18n, smoke.
- Migration: two new tables. Existing behaviour changes: posting a voucher now requires a second
  person, which is the point.
