# Design

## D1. Maker-checker on the voucher, not the document workflow engine

The obvious move is to reuse `workflow` — it exists, it is configurable, it already carries
delegation and no-self-approval. It does not fit:

- `approval_log.document` is a **required** FK to `document`. Routing a voucher through the engine
  means either making a voucher a document or making that column nullable and polymorphic. The
  first needs a `form_template` describing account/debit/credit lines, which the form engine does
  not model — `document_line` carries budget, item and tax, and a voucher line carries none of
  them. The second changes the shape of the approval log for every capability that uses it, to
  serve one caller.
- A configured chain answers "who must approve a 500,000 purchase from department X". A manual
  journal entry has no department, no budget, no vendor and no amount that means anything
  comparable — its whole point is that no business event produced it.

What the standard actually asks for here is segregation of duties: the person who prepares a manual
entry is not the person who accepts it. That is one checker, not a chain, and it needs no engine.

If a configurable chain is wanted later, this change does not block it: the voucher has a status and
an approver, which is what a chain would replace.

## D2. The entry posts at approval, not at submit

A submitted voucher writes `journal_voucher` and nothing else. `createEntry` runs when it is
approved.

Posting at submit and reversing on rejection would put unapproved entries in the ledger — briefly,
but the ledger is append-only, so "briefly" means permanently visible. The control exists precisely
to keep them out.

It also keeps the idempotency story unchanged: the voucher's id is the entry's `source_id`, so the
approval is idempotent on `(company, MANUAL_JV, voucherId)` exactly as the direct post was.

## D3. The entry date is the voucher's, not the approval's

A voucher states an accounting date — a depreciation for March, an accrual at a period end. The date
the checker got to it is not an accounting fact.

The consequence, and it is deliberate: a voucher submitted for an open month and approved after that
month closed will be refused by the period guard, and must be resubmitted for a date the books will
accept. That is the correct outcome — the alternative is silently moving somebody's March entry into
April.

## D4. No self-approval, checked on the act rather than trusted to the codes

The submitter cannot approve their own voucher, even holding both codes. Two people with both codes
still constitute a control; one person with both does not.

Enforced in the service, not by permission configuration: invariant 8 states it for approvals, and a
rule that depends on nobody granting two codes to one user is a convention, not a control.

## D5. Reversals go through the checker too, because a reversal IS a voucher

An earlier draft of this design put reversals outside the control, on the reasoning that their lines
are computed and their amount fixed, so a checker has nothing to judge.

That is wrong, and the codebase says why. `GL_JV_POST` explains its own scope:

> One code for both posting and reversing — **a reversal is a voucher whose lines were computed for
> you**, and splitting them would imply a difference in privilege that is not there.

Leave reversals immediate and that one code comes to mean two things at once: "submit something for
approval" and "write the ledger with nobody reviewing it" — and the second is the stronger of the
two. An unreviewed path standing beside a control is what makes the control decorative. Somebody who
wants to move a figure without a second pair of eyes reverses instead of submitting.

The bound on that power is real but not small: a reversal cannot choose its accounts or its amount,
but it can undo any entry in the company, including a large payment settlement, and dating it is the
caller's choice.

So a reversal is submitted as a voucher whose lines the system computed, and approved like any
other. `GL_JV_POST` keeps one meaning: submit something that will write the ledger. The reversal's
own rules are unchanged — keyed to the entry it reverses, at most once, dated the caller's choice
defaulting to today.

## D6. A pending voucher can be withdrawn by the person who submitted it

D3 has a consequence it did not follow through: a voucher dated in a month that closes between
submit and approval can never be approved. The period guard refuses it, correctly — and the checker
is then holding something they can neither accept nor make go away, in a queue that only grows.

That is the shape of dead end this work has closed elsewhere: a refusal that names an obstacle
nobody can clear.

So the submitter may withdraw their own pending voucher, which records `WITHDRAWN` and posts
nothing. The checker's other move — rejecting with a reason — already exists and is the right one
when the voucher is wrong rather than merely stale. Withdrawal is for the author's own second
thoughts, and it is deliberately not something the checker can do on their behalf: a checker who
wants it gone rejects it, on the record.

## D7. The entry's author is the person who prepared it

`journal_entry.created_by` is one column and maker-checker has two people.

The entry records the SUBMITTER. An entry is what its preparer wrote; the approval is a control
event about it, not authorship of it. Putting the approver there would say the checker wrote an
entry they only accepted.

Both names live on the voucher, and the entry's `source_id` IS the voucher's id — so the journal
answers "who wrote this" and one hop answers "who let it through". A second column on
`journal_entry` would put a control record in the ledger, which is not what the ledger is for.
