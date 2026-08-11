## 1. The api client

- [x] 1.1 `front-end/src/api/journal.ts` — `undelivered(page, limit)`, `requeue(id)`,
      `openPayables()`.
      NOT done: the `from`/`to` parameters. The endpoint accepts them, but they bound
      `last_attempt_at` — useful to a period close asking about a stretch of time, and meaningless
      as a UI filter on a list whose whole content is "outstanding right now". Adding a date filter
      nobody on this screen would set is worse than leaving it to a later change with a reason.
- [x] 1.2 `UndeliveredPosting` types `status` as `'PENDING' | 'FAILED'` — the only two the endpoint
      returns — plus `sourceType`, `sourceDocNo`, `attempts`, `lastError`, `lastAttemptAt`.
- [x] 1.3 `OpenPayable` mirrors the server interface: `documentId`, `documentNo`, `vendorId`,
      `vendorName`, `amount`, `invoiceDate`, `dueDate`. `amount` is a decimal string.
- [x] 1.4 `openPayables()` takes no paging arguments — the endpoint accepts and ignores them
      (design D4). Not passing them is how the client says so.

## 2. The store

- [x] 2.1 `front-end/src/stores/journal.ts` — `undelivered` + its paging, `payables`, and
      `loadUndelivered` / `loadPayables` / `requeue`.
- [x] 2.2 `requeue` returns a boolean and reloads the undelivered list on success, through the
      existing `write()` wrapper.

## 3. Undelivered postings screen

- [x] 3.1 `front-end/src/views/accounting/UndeliveredPostingsView.vue` (new) at
      `/journal/undelivered`, route gated by `GL_VIEW`.
- [x] 3.2 Columns: source type, source document number where known, status, attempts, last attempt,
      last error. Server-side paging, like the journal — this endpoint does honour it.
- [x] 3.3 `attempts` shown against `MAX_ATTEMPTS` (5), with a client-side constant that names the
      backend constant it mirrors (design D2).
- [x] 3.4 Re-queue offered per row on `status === 'FAILED'` AND `GL_POST_RETRY`; never on PENDING
      (design D1).
- [x] 3.5 A refusal shows the server's message unaltered.

## 4. Open payables screen

- [x] 4.1 `front-end/src/views/accounting/OpenPayablesView.vue` (new) at `/open-payables`, route
      gated by `GL_VIEW`.
- [x] 4.2 Vendor, document number, amount, invoice date, due date; ordered by due date through the
      table's `sortField`/`sortOrder`.
      A `computed` that sorted the rows as well was written first and then removed: with the table
      already sorting, it was a second mechanism doing the same job, and the ordering test passed
      with it deleted — which is how it was caught. See 8.8.
- [x] 4.3 Client-side paging and sorting, NOT lazy server paging (design D4).
- [x] 4.4 Amounts through `fmtBase`; no JS number anywhere near them.
- [x] 4.5 No overdue marking and no client-computed "today" (design D3).

## 5. The dead end

- [x] 5.1 `views/accounting/AccountingPeriodsView.vue` — when a close is refused, offer a link to
      the undelivered postings, only when the viewer holds `GL_VIEW` (design D5).
- [x] 5.2 The refusal message itself is unchanged; the link is an addition beside it.

## 6. Routes, nav and i18n

- [x] 6.1 `router/routes.ts` — `/journal/undelivered` (`journal-undelivered`, `GL_VIEW`) and
      `/open-payables` (`open-payables`, `GL_VIEW`), both with a breadcrumb.
- [x] 6.2 `layouts/store/layout.store.ts` — an `openPayables` entry in the existing `accounting`
      section. The undelivered list gets NO nav entry: it is reached from the journal and from a
      blocked close, and a sidebar item for a queue that is empty on a healthy system is noise.
- [x] 6.3 A link to the undelivered list in the journal screen header. No `v-if` on `GL_VIEW`: the
      journal route is itself gated by `GL_VIEW`, so anyone reading that header already holds it,
      and a check that is always true reads as though it might not be.
- [x] 6.4 Keys in `en`, `la` and `zh`; `i18n.parity.spec.ts` passes.

## 7. Adoption of the eight existing screens

- [x] 7.1 The spec delta describes the chart of accounts, journal, tax codes, VAT summary, trial
      balance, income statement, balance sheet and account ledger AS THEY ARE (design D6).
- [x] 7.2 Verified against `router/routes.ts`, all eight, and all eight match what the delta states:
      `accounts` COA_VIEW · `journal` GL_VIEW · `tax-codes` TAX_VIEW · `tax-summary` TAX_VIEW ·
      `reports/trial-balance`, `reports/income-statement`, `reports/balance-sheet`,
      `reports/ledger/:accountId` GL_VIEW.
- [x] 7.3 All eight added to `test/smoke/views.smoke.spec.ts`, plus the two new screens. Registry
      coverage 50 → 62 views.
- [x] 7.4 Nothing further found wrong. Stated precisely: the eight were read at the level needed to
      describe their route, permission and behaviour — not audited line by line. The one real defect
      noticed in this area, `JournalView.entryTotal` computing money through a JS number, was fixed
      in the previous change because that change put the correct arithmetic on the same screen.

## 8. Tests

- [x] 8.1 `UndeliveredPostingsView.spec.ts` (new) — re-queue offered on a FAILED row with
      `GL_POST_RETRY`; absent on a PENDING row; absent without the code. Three cases, because one
      would not distinguish the status rule from the permission rule.
- [x] 8.2 Attempts rendered against the maximum.
- [x] 8.3 A refused re-queue shows the server's message.
- [x] 8.4 `OpenPayablesView.spec.ts` (new) — rows rendered, ordered by due date, amounts formatted.
- [x] 8.5 The payables table is not lazy — asserted on the component's props, so a later switch to
      server paging against an endpoint that ignores it fails here.
- [x] 8.6 `AccountingPeriodsView.spec.ts` — the link appears with `GL_VIEW` and not without it.
- [x] 8.7 Assert on `data-testid` and data, not locale strings; dialogs are teleported to
      `document.body`.
- [x] 8.8 Negative check run for six behaviours: re-queue ignoring status, the bare attempt count,
      the payables table made lazy, the link rendered without the `GL_VIEW` check, and the due-date
      ordering.
      The ordering check did NOT fail on the first attempt — deleting the `computed` sort left the
      test green, because the table's `sortField` was doing the work. That is what identified the
      duplicate mechanism in 4.2. After removing the redundant sort, the test fails when
      `sortField` is removed, which is the mechanism it should have been pinning all along.
- [x] 8.9 `AccountingPeriodsView.spec.ts`'s `ALL` list holds the period codes only, so the link case
      passes `[...ALL, 'GL_VIEW']` explicitly. The first run failed on this — the code was right and
      the test was not.

## 9. Checks

- [x] 9.1 `npm run test` — 87 files, 765 tests, all passing (was 85/740). `npm run typecheck` clean.
- [x] 9.2 `openspec validate --all` passes.
- [x] 9.3 Do NOT edit `openspec/specs/**` by hand — `/opsx:archive` syncs the delta.
