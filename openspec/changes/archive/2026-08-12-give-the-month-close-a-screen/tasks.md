## 1. The api client

- [x] 1.1 `front-end/src/api/accountingPeriods.ts` (new) — `list()`, `declare(dto)`, `close(id)`,
      `reopen(id, reason)` against `/accounting-periods`. Types mirror `DeclarePeriodDto` and
      `ReopenPeriodDto`.
- [x] 1.2 `AccountingPeriodRow` types `status` as `'OPEN' | 'CLOSED'` — there is no DRAFT
      (design D4) — and `fiscalYear` as an id string, because `list()` does not populate it
      (design D5).

## 2. The store

- [x] 2.1 `front-end/src/stores/accountingPeriods.ts` (new) — `periods`, `loading`, `working`,
      `error`; writes return a boolean, so the view can distinguish a refusal from a success without
      reading the error string. The three writes share one `run()` wrapper rather than repeating the
      try/catch/reload three times.
- [x] 2.2 A refused close leaves `periods` untouched and puts the server's message in `error`
      verbatim (design D1). No client-side rewriting of refusal text.

## 3. The screen

- [x] 3.1 `front-end/src/views/accounting/AccountingPeriodsView.vue` (new) — list of code, start,
      end, status. Plain `DataTable`, no paging (design D5).
- [x] 3.2 `canClose` / `canReopen` from `auth.can('PERIOD_CLOSE' | 'PERIOD_REOPEN')`; close offered
      on OPEN rows, reopen on CLOSED rows.
- [x] 3.3 Close confirmation offers confirm and cancel only. **No "close anyway"** — the attendance
      screen's central affordance, and the one thing this screen must not copy (design D1). A
      negative check confirms the test catches such a button being added back.
- [x] 3.4 When the period being closed is the last in its fiscal year, the confirmation states that
      the year closes with it and that reopening will not undo it (design D3). Decided from the
      loaded periods sharing the row's `fiscalYear` id.
- [x] 3.5 A refusal is shown through `fb.error(store.error)`, the server's text unaltered. The close
      dialog deliberately stays OPEN on a refusal — closing it would take the reason off the screen
      along with it. (Not spelled out in the task; it follows from D1 and is commented in the view.)
- [x] 3.6 Reopen dialog requires a non-empty reason; confirm disabled until then.
- [x] 3.7 Declare dialog: fiscal year, code, start, end, from the existing `org` store. Without
      `FISCAL_YEAR_MANAGE` the dialog renders the explanation INSTEAD of the form body — no selector
      at all, rather than one that cannot be filled (design D2). The declare button needs
      `PERIOD_MANAGE`; the save button additionally needs the year list.
- [x] 3.8 No edit affordance — there is no update endpoint and no DRAFT status (design D4).

## 4. Route and nav

- [x] 4.1 `router/routes.ts` — `/accounting-periods`, name `accounting-periods`,
      `meta.permission: 'PERIOD_VIEW'`.
- [x] 4.2 `layouts/store/layout.store.ts` — one entry in the existing `accounting` section, between
      `journal` and `taxCodes`. No new section.

## 5. i18n

- [x] 5.1 Keys went into the existing `gl.ts` catalog as `gl.periods` — the general-ledger namespace
      already owns this area, so no new locale file was needed (the task allowed either). Nav label
      `nav.accountingPeriods` added alongside.
- [x] 5.2 The same keys in `la` and `zh`, in the accounting vocabulary those files already use.
- [x] 5.3 `i18n.parity.spec.ts` already enforces key completeness across the three catalogs and
      passes — no manual diff needed.

## 6. Tests

- [x] 6.1 `AccountingPeriodsView.spec.ts` (new) — periods listed.
- [x] 6.2 Permission gating: with `PERIOD_VIEW` only, no declare, close or reopen control renders.
      A second case asserts close appears on the two OPEN rows and reopen on the one CLOSED row —
      the controls follow status, not row count.
- [x] 6.3 A refused close shows the server's message and leaves the row OPEN.
- [x] 6.4 The confirmation names the year close for a year's final period, and does not for an
      ordinary one. Both asserted.
- [x] 6.5 Reopen confirm is disabled until a reason is entered.
- [x] 6.6 The declare dialog states the fiscal-year list is unavailable without
      `FISCAL_YEAR_MANAGE`, and renders no selector; a paired case asserts the selector IS there
      with both codes.
- [x] 6.7 Assertions are on data and `data-testid`. The one message that IS the requirement is
      resolved through `i18n.global.t(...)`.
      First draft queried dialog content through the wrapper and five cases failed on empty
      DOMWrapper: PrimeVue dialogs teleport to the body. Rewritten to query `document.body` with an
      `afterEach` that unmounts and clears it — the pattern `attendance-hr.spec.ts` already uses.
- [x] 6.8 Added to `test/smoke/views.smoke.spec.ts`.
- [x] 6.9 Negative check run for four of the assertions, each by breaking the view and confirming
      the matching case goes red: always-warn (year close), no `disabled` (reopen), always-render
      the selector (fiscal years), and a "close anyway" button added to the footer.

## 7. Checks

- [x] 7.1 `npm run test` — 84 files, 721 tests, all passing (was 83/709). `npm run typecheck` clean.
- [x] 7.2 `openspec validate --all` — 73 passed, 0 failed.
- [x] 7.3 `openspec/specs/**` untouched (`git status --porcelain openspec/specs/` empty).
