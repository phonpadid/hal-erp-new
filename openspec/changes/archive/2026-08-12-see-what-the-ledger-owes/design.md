# Design

## D1. Re-queue is offered on FAILED rows only

`JournalService.requeue` refuses anything that is not FAILED:

> POSTED and SKIPPED are answers, not stalls. Re-queuing one would ask the engine to redo work it
> has already concluded … for SKIPPED it would reopen a question already settled.

The undelivered list shows PENDING and FAILED. PENDING is not stalled either — it is queued and
waiting for the next sweep — so of the two statuses on this screen, exactly one can be re-queued.

The control is therefore rendered per row on status, not per screen on permission. A button that is
present on every row and errors on half of them teaches the operator to distrust the screen; its
absence on a PENDING row says the right thing, which is "wait".

`GL_POST_RETRY` gates it — a separate code from `GL_VIEW` because re-queuing writes, and separate
from the chart-of-accounts codes because the people who watch for undelivered postings are not
necessarily the people who edit accounts.

## D2. `attempts` is shown against the bound that stopped it

A FAILED row carries `attempts` and `lastError`. `attempts` alone is a number without a scale;
`MAX_ATTEMPTS = 5` in the sweeper is what makes it mean "this stopped being retried". The screen
shows `attempts / 5`.

The constant is duplicated on the client, which is a real cost. The alternative — an endpoint that
reports the sweeper's bound — is a backend change for one integer, and the number appearing wrong
after a future change to `MAX_ATTEMPTS` is a display defect, not a correctness one. Recorded rather
than hidden: the client constant carries a comment naming its source.

## D3. No overdue marking, because the client does not know the company's day

`dueDate` comes from the server as a company-day string. Marking a row overdue means comparing it to
today — and the browser's today is not the company's. This session already corrected the posting
engine for exactly that: entry dates resolved in UTC landed in the wrong month for seven hours a
day at every cut-off.

A payables list that calls an invoice overdue seven hours early, for viewers in some timezones and
not others, is the same defect wearing a different coat. The list orders by due date, which needs no
"today" at all, and leaves the judgement to the reader who knows what day it is where the company
is. If overdue marking is wanted later, the server should say which rows are overdue.

## D4. The payables list pages on the client

`openPayables` returns every row in one response: `{ items, total: items.length, page: 1, limit:
items.length }`. The pagination parameters are accepted and ignored.

So a lazy, server-paged `DataTable` would be a lie — page 2 would refetch page 1. The table pages
and sorts client-side over the full set it already has. This is stated because the neighbouring
journal screen does the opposite, and the difference is in the endpoint, not in a preference.

## D5. The blocked close links to the postings that block it

The periods screen's refusal names the owed postings. Making it a route the operator can follow is
what turns the message from a wall into a next step.

The link is rendered only when the viewer holds `GL_VIEW`, since the undelivered route is gated by
it and `PERIOD_CLOSE` does not imply it. A period-closer without `GL_VIEW` still gets the refusal
and its named postings — the same information, minus a shortcut they could not use.

This is a change to a screen shipped in the previous change rather than to a new one. It belongs
here because the destination only exists here.

## D6. The eight adopted screens are described, not redesigned

The requirements for the chart of accounts, the journal, tax codes, the VAT summary and the four
financial statements state what those screens do today: their route, their permission code, and the
behaviour a reader would need to know before changing them. Nothing about them changes.

Writing a specification for existing code invites two failures. Describing what the code *should*
do turns the spec into a proposal nobody agreed to; describing every detail turns it into a copy of
the source that goes stale on the next edit. The requirements here stay at the level that survives
refactoring: what the screen is for, who may see it, and the properties that would be bugs if lost.

Anything found wrong while writing them is reported in this change's notes, not fixed in it.
