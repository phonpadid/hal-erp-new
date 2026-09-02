# Give the voucher a form that balances

## Why

`POST /journal/vouchers` and `POST /journal/:id/reverse` exist and have no client. The backend
comment on their permission code is not decoration:

> `GL_JV_POST` — the largest privilege in the system: it is the only way a person writes the ledger
> directly, and it is guarded by this code rather than by an approval route. Grant it to very few
> people until that route exists.

Depreciation, accruals, prepaid amortisation, payroll, opening balances carried in from a previous
system, and the correction of a wrong automatic posting — all of it currently needs curl. And
because corrections are reversing entries rather than edits (invariant 2), having no reversal
control means the ledger's only correction mechanism is unreachable from the app.

This is the second of three changes bringing the accounting screens under `web-accounting`.

## What Changes

**The voucher form** — its own route, not a dialog: a multi-line balancing form does not fit in one.

- `front-end/src/views/accounting/JournalVoucherView.vue` (new) at `/journal/voucher`, gated by
  `GL_JV_POST`.
- Date, memo, and at least two lines of account code, debit, credit and an optional line memo.
- Running Σ debit and Σ credit through the existing `sumAmounts` (decimal.js), with the submit
  refused until the two are equal and non-zero.
- Each line must carry exactly one non-zero side — the server's rule, mirrored so the operator sees
  it while typing rather than after posting.
- A client-generated `id` on every submit, so a double-click or a retry over a slow connection
  resolves to the same entry instead of posting the ledger twice. See design D2.

**The reversal** — a control on the journal rows, where the entry to reverse is.

- Reverse control on `JournalView.vue` rows under `GL_JV_POST`, with a dialog taking the optional
  date and memo.
- The dialog states that a reversal is dated **today** by default and not the original's date, and
  that an entry can be reversed at most once.

**Adjacent, and inside this change's scope because this change is the one that needs it**

- `JournalView.entryTotal` computes money as a JS number
  (`Math.round(Number(l.debit) * 100)`), against the money rule. The voucher form needs exactly
  this arithmetic done correctly, and `sumAmounts` already exists; the existing function moves onto
  it rather than a second, correct implementation living next to an incorrect one.

Plus: api client, store actions, route, i18n in three locales, tests, smoke registry.

## What This Change Does NOT Do

- No approval route for `GL_JV_POST`. The backend records its absence as the reason the code is the
  guard; adding one is a workflow change, not a screen.
- No undelivered-postings or open-payables screens — B3.
- No backend change.

## Impact

- Affected specs: `web-accounting`
- Affected code: `api/journal.ts`, `stores/journal.ts`, `views/JournalView.vue`,
  `views/accounting/JournalVoucherView.vue` (new), `router/routes.ts`,
  `i18n/locales/{en,la,zh}/gl.ts`, `test/smoke/views.smoke.spec.ts`
- Known limitation carried by this change: the account picker needs `COA_VIEW`, which `GL_JV_POST`
  does not imply. Unlike the fiscal-year case in the periods screen, this one degrades rather than
  blocks — see design D3.
