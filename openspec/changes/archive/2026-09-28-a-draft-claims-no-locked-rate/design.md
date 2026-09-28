## Context

Two stored columns carry the answer a submit computed: `document.exchange_rate` and
`document.base_total_amount`. `DocumentSubmitService` writes both, and `DocumentRateService` restates
them for a submitted document under its own rules. Nothing else writes them, by design — invariant 6.

`exchange_rate` is initialised to `'1'` at create, so it is never null. That is what defeats the
detail view's condition: `isForeignCurrency` asks only whether the document's currency differs from
the company base, and the tiles then read two columns that are non-null whether or not any submit has
ever computed them.

For most of this screen's life the gap was invisible. A document's currency was fixed at creation, so
either the stamp matched the currency or there was no foreign currency to mismatch. `draft-currency-
correctable` made the currency editable while `DRAFT`, and the two can now disagree.

Who actually sees it matters for how this is fixed. A document in `IN_APPROVAL` cannot have its
currency changed, so an approver always sees a stamp that matches. The contradiction is visible only
on a `DRAFT` — to its author, and to anyone whose scope lets them open it. The author is the person
who just made the correction and is looking at the screen to see whether it took; showing them
`42,000 LAK` and `1.00` invites the conclusion that it did not, on a document that has already been
returned four times for a wrong amount.

## Goals / Non-Goals

**Goals:**

- A draft states nothing about a locked rate, because it has none.
- What a submitted document shows is unchanged.
- No stored value is written, cleared or recomputed.

**Non-Goals:**

- Clearing `exchange_rate` / `base_total_amount` when a draft's currency changes. Considered and
  rejected below.
- An advisory live conversion on the detail screen.
- Giving the list the document's own currency. That needs the server read to carry one.

## Decisions

**Hide, rather than clear the stored values.**

The tempting server-side fix is to null `base_total_amount` and reset `exchange_rate` when a draft's
currency changes, so the screen has nothing to show. Rejected for three reasons.

It puts a write against invariant 6's columns on a path whose whole argument for being safe was that
it touches neither. The invariant permits it — a draft has reserved nothing, and the values describe
a superseded submission — but the permission is subtle, and the next person to read that code has to
re-derive it. A display bug is not worth spending that.

It does not actually fix the display. `exchange_rate` is non-nullable with a default of `1`, so
"clearing" it means writing `1` — exactly the value being complained about. Only `base_total_amount`
would become `—`, leaving a tile reading `1.00` beside a THB document.

And it would be incomplete anyway: a draft returned after a submit has stale figures whenever a LINE
changed too, with no currency involved. The honest statement is about drafts, not about currency
changes, and the honest place to make it is where the claim is rendered.

**Gate on status, not on "has this ever been submitted".**

A document that was submitted and returned genuinely has a stamped rate in the database, so a
condition like "show it if a submit ever happened" would keep showing the superseded one. The return
is what makes the figures wrong: it withdrew the submission they describe. `status === 'DRAFT'` is
exactly the set of documents whose figures are either absent or withdrawn, and it is the same
condition the edit controls already use (`canEdit`, `canSubmit`, `selectionsLocked`).

**The list shows its existing empty state.**

The base-total column already renders `common.none` for a row whose `baseTotalAmount` is null, so a
draft takes the path the column was already built to handle. No new visual, no new string.

This does leave a draft row with no money on it. Accepted: the column is labelled base-currency total
and a draft has none. Inventing a substitute figure in a column that says it is something else would
repeat the mistake being fixed.

## Risks / Trade-offs

**A draft's list row shows no amount at all.** → It showed a wrong one before. The author sees the
live figure on the wizard, and the row regains its amount the moment the document is submitted, which
is also the moment the figure becomes true.

**Someone may read the hidden tiles as "the rate was lost".** → It is not stored differently; only the
claim is withheld while it does not hold. A submitted document shows exactly what it showed before.

**The underlying staleness remains** for a returned draft whose lines changed — `grand_total` and
`sub_total` are stamped at submit too, and the detail's own-currency total reads from the document
rather than from the lines. Out of scope here and not currency-specific; worth its own look, because
this change removes the loudest symptom without removing the cause.

## Migration Plan

None. Client only; no schema, no data, no endpoint. Rollback is reverting the two conditions.

## Budget and quota sequencing

None. This change writes nothing, reads no ledger and takes no lock. It alters which stored values a
screen renders, on a document that by definition has not reserved budget: submit is the first writer
of `budget_txn`, and a document in `DRAFT` has not reached it.

## Open Questions

None.
