# See what the ledger owes

## Why

Two endpoints with no client, and eight screens with no spec.

**The dead end this closes.** The periods screen refuses a close with
`Period '2026-08' still owes 3 posting(s): PAYMENT PV-0012, …`. The operator can read which
postings, and can do nothing about them: `GET /journal/undelivered` and
`POST /journal/undelivered/:id/requeue` have no client. The refusal names an obstacle the app
gives no way to clear — the month cannot close until someone runs curl.

`requeue` exists precisely because the attempt bound would otherwise make a failed posting
unpostable forever: an operator maps the account that was missing, and has no way to finish.

**What the company owes.** `GET /journal/open-payables` derives the unpaid vendor accruals from the
journal, with a due date from each vendor's payment terms. It is the breakdown of the balance
sheet's accounts-payable figure and cannot disagree with it, because it is read from the same
entries. Nothing shows it.

**The eight unspec'd screens.** The chart of accounts, the journal, tax codes, the VAT summary, and
the four financial statements all exist and none is described by any capability. They are also all
absent from the smoke registry — every one of the eight, not the six an earlier survey counted.

## What Changes

**Undelivered postings** — `views/accounting/UndeliveredPostingsView.vue` at `/journal/undelivered`,
`GL_VIEW`. Source type, document number, status, attempts, last error and last attempt. A re-queue
control on **FAILED rows only**, gated by `GL_POST_RETRY` — the server refuses to re-queue anything
else, and offering a control that always fails is worse than offering none. See design D1.

**Open payables** — `views/accounting/OpenPayablesView.vue` at `/open-payables`, `GL_VIEW`. Vendor,
document, amount, invoice date, due date, ordered by due date.

**The dead end** — the periods screen links to the undelivered list when the viewer holds `GL_VIEW`,
so a blocked close leads somewhere.

**Adoption** — requirements describing the eight existing accounting screens as they are, and all
eight added to the smoke registry.

## What This Change Does NOT Do

- No aging buckets on the payables list. That is a report, and the endpoint returns flat rows.
- No overdue marking. The client does not know the company's timezone, and computing "today" in the
  browser is the bug the posting engine was corrected for. See design D3.
- No behaviour change to any of the eight adopted screens — the requirements describe what is
  there. Anything that looks wrong while writing them gets reported, not quietly fixed.
- No backend change.

## Impact

- Affected specs: `web-accounting`
- Affected code: `api/journal.ts`, `stores/journal.ts`, two new views,
  `views/accounting/AccountingPeriodsView.vue`, `router/routes.ts`,
  `layouts/store/layout.store.ts`, `i18n/locales/{en,la,zh}/`, `test/smoke/views.smoke.spec.ts`
- Third and last of the changes bringing the accounting screens under `web-accounting`.
