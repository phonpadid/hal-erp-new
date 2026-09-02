# Age what we owe

## Why

`GET /journal/open-payables` returns a flat list of unpaid vendor accruals with a due date each.
That answers "what do we owe"; it does not answer the question finance actually asks at month end,
which is "how much of it is late, and by how long".

Ageing is the standard breakdown — not yet due, 1–30, 31–60, 61–90, over 90 — and it is what a
payment run is planned from and what an auditor asks for. Computing it by hand from a flat list is
the work the list was supposed to remove.

It has to be computed on the **server**. The bucket a payable falls into depends on today, and the
open-payables screen already refuses to mark rows overdue for exactly that reason: `due_date` is a
company-day and the browser's today is not the company's, so a client-side bucket would put a
payable in "1–30" for a viewer in one timezone and "not yet due" for another. The company's
timezone is on the company row, and the server is the only party that can read it.

## What Changes

- `JournalService.openPayables` gains an `agedAt` — resolved in the company's timezone — and stamps
  each row with `daysOverdue` and its `bucket`.
- A `GET /journal/open-payables/ageing` read returning the bucket totals and their count, so the
  summary is one request rather than a client-side reduction over a page.
- The open-payables screen shows the buckets above the list and the bucket on each row.

## What This Change Does NOT Do

- No change to what counts as an open payable. The set is the same derived set: an approval accrual
  that credited `ACCOUNTS_PAYABLE` with no payment against it.
- No ageing by invoice date. The bucket is measured from the **due date**, which is what "overdue"
  means; the invoice date is when the clock started, not when the debt became late.
- No vendor-level rollup. That is a report, and the flat list plus its buckets is what a payment run
  needs.

## Impact

- Affected specs: `gl-journal`, `web-accounting`
- Affected code: `back/src/modules/gl/journal.service.ts`, its controller,
  `front-end/src/api/journal.ts`, the store, `OpenPayablesView.vue`, i18n
- No migration. No new permission — ageing is the same read under `GL_VIEW`.
