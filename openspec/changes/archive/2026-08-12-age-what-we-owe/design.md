# Design

## D1. Today is resolved once, in the company's timezone, on the server

`localDateIn(new Date(), company.timezone)` gives the company's calendar day, which is the same
function `createEntry` uses to date an entry. `daysOverdue` is then a difference between two
`YYYY-MM-DD` strings — no instants, no offsets, no arithmetic that can drift by a timezone.

The alternative that this rejects is the client computing it. The open-payables screen states the
reason already: a due date is a company-day, the browser's today is not the company's, and an
overdue flag computed in the browser fires early or late by an offset for viewers in some zones and
not others. The same defect the posting engine was corrected for.

Resolved **once per request** rather than per row, so a request that spans midnight in the company's
zone cannot put two payables of the same due date in different buckets.

## D2. The buckets are named by the boundary they end at, and are computed from the due date

`NOT_DUE`, `D1_30`, `D31_60`, `D61_90`, `D90_PLUS`.

Measured from `due_date`, because "overdue" means past the date payment was due. Ageing from the
invoice date is a different report — how long the debt has existed — and would put a payable on
60-day terms into "31–60" the day it was raised, which reads as late when nothing is late.

`daysOverdue` is reported alongside the bucket rather than only the bucket, so the screen can sort
by lateness and a reader can see 91 rather than inferring it from a band.

## D3. The bucket totals come from the server too, not from a reduction over the page

The list is paged on the client because the endpoint returns every row at once — but the totals must
be right regardless of how the list is later paged or filtered, and a reduction computed on whatever
subset the client happens to hold is a number that changes meaning when the page does.

So a second read returns the five totals and their counts. It shares the derivation with the list —
the same query, the same `agedAt` — so the two cannot disagree.

## D4. Money stays a decimal string all the way through

The bucket totals are summed with `Money.add`, as every total in this service is. A bucket summary
is exactly the kind of figure somebody copies into a cash-flow plan, and the entry total defect
fixed earlier in this work started the same way — arithmetic that looked harmless on small numbers.
