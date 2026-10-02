## Why

Nothing prepares a new fiscal year. Today, if nobody remembers to create fiscal year 2027 and
approve its budget plan before January 1, a requester can open and fill in a budget-consuming
document, and it only fails at submit, with an English "No fiscal year covers 2027-01-01". In the
meantime the budget picker keeps offering every ACTIVE 2026 budget beside the new ones, so
documents can quietly charge last year's pots. The person who finds out is a requester on the first
working day of the year, not the admin who could have fixed it a month earlier.

The year is also read in UTC. HAL runs at UTC+7, so between 00:00 and 07:00 local time on January 1
the system still numbers documents `…-2026-…` and checks them against 2026.

The user has decided the rule: when the year turns and the new year has no budget, a
budget-consuming document **cannot be created at all**. Documents that do not use budget go on
exactly as before. Admins are warned **30 days** before the year ends, and the warning covers
whether the budget is ready.

## What Changes

- **Creation guard (budget types only).**
  - Creating a document whose `document_type.requires_budget` is true SHALL be refused unless the
    active company has an `OPEN` fiscal year covering *today in the company's timezone*, and that
    year holds at least one `ACTIVE` budget.
  - Types with `requires_budget = false` are unaffected: leave, HR, budget plans, adjustments and
    transfers.
  - Successors the system creates from an already-approved predecessor are exempt. They carry
    reserves the predecessor already holds.
  - The refusal is an `explained(key)` error, translated into Lao.
- **Creatable types say why.** The creatable-types read marks a budget type as blocked, with the
  reason, so the front-end disables it at type selection rather than after the form is filled.
- **Budget picker is year-scoped.**
  - Selectable budgets are limited to the fiscal year covering today (company-local).
  - A budget already inherited from a predecessor stays selectable on that successor.
  - Submit also refuses a line whose budget belongs to another fiscal year (except inherited lines).
- **Company-local year.** Document numbering (`doc_running_number.year`, the prefix) and the
  submit `asOf` date use the company's `timezone` instead of UTC. The same applies to the numbering
  of budget adjustments, transfers and plans.
- **Year-end readiness.**
  - A new read reports, for the active company, how ready the next fiscal year is:
    - the next fiscal year exists and is `OPEN`;
    - it has `ACTIVE` budgets (count);
    - per-person quota entitlements exist for it (missing count);
    - a `BUDGET_RATE` dated in it exists (optional).
  - From 30 days before the current fiscal year's `end_date`, holders of `FISCAL_YEAR_MANAGE`,
    `BUDGET_MANAGE` or `QUOTA_MANAGE` are notified once a day, and see a banner linking to the
    readiness page, until every required item is ready.
- **Budget list reads one year at a time.** A year filter on the budget list opens on the current
  year; every year's plan reuses the same codes, so reading years together repeats each budget.
- **Fiscal year administration tightened.** Creating a fiscal year whose dates overlap another of
  the same company is refused. The existing fiscal-year "Close" button stays as it is, by the
  user's decision: admins close the year themselves.

## Capabilities

### New Capabilities
- `fiscal-year-readiness`: the readiness read, the 30-day admin notification, and the banner and
  page that tell admins what the next fiscal year still lacks.

### Modified Capabilities
- `document-engine`: creation of `requires_budget` documents is refused without an open, budgeted
  current fiscal year; creatable types expose that block; numbering uses the company-local year.
- `budget-control`: selectable budgets are scoped to the fiscal year covering today; submit refuses
  a line charging a budget of another fiscal year unless it was inherited.
- `multi-company`: fiscal years of one company cannot overlap.
- `web-documents`: type selection disables blocked budget types and shows the reason.
- `web-budgets`: the budget list gains a fiscal-year filter that opens on the current year.
- `web-org-admin`: the fiscal-years page hosts the readiness view and banner, and shows the overlap
  error.

## Impact

- **Backend:**
  - `document.service.ts` (create, numbering year, creatable types)
  - `document-submit.service.ts` (`asOf`, line-year check)
  - `budget.service.ts` (`listSelectable`)
  - `fiscal-year.service.ts` and controller (overlap, readiness)
  - `budget-adjustment` / `budget-transfer` / `budget-plan` services (numbering year)
  - the notifications scheduler (daily readiness sweep)
  - `common/time/company-clock.ts`, which is reused
- **Frontend:**
  - the document create wizard's type step
  - `FiscalYearsView.vue`
  - a new readiness panel and a shell banner
  - Lao, English and Chinese strings
- **Schema:** no new tables and nothing seeded.
- **Invariants:**
  - Company isolation (1): every read is scoped to the active company.
  - Append-only ledgers (2): untouched, because the guard runs before any `budget_txn` exists.
  - Reject/cancel auto-release (4): unchanged.
  - Configuration over code (7): the guard branches on `requires_budget`, never on a type code.
- **Operational:** before this ships, the HAL company's `timezone` must be confirmed. It defaults to
  `Asia/Bangkok`, which is also UTC+7, so the result is the same as `Asia/Vientiane`.
