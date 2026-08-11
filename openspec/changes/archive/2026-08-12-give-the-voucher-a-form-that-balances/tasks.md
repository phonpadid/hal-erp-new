## 1. The api client

- [x] 1.1 `front-end/src/api/journal.ts` — `postVoucher(dto)` and `reverse(id, dto)` beside the
      existing `list`. Types mirror `PostJournalVoucherDto` / `ReverseEntryDto`, money as decimal
      strings.
- [x] 1.2 `id` is required on `JournalVoucherInput` and minted by the VIEW, not by the api layer —
      the view owns when a new voucher begins (design D2).

## 2. The store

- [x] 2.1 `front-end/src/stores/journal.ts` — `postVoucher` and `reverse` returning a boolean, with
      the server's message left unaltered in `error`. Both go through one `write()` wrapper.
- [x] 2.2 A successful reversal reloads the journal. Posting a voucher does NOT: the form is its own
      route and navigates away on success, so refetching a list nobody is looking at is work for its
      own sake. (The task said "a successful reversal reloads"; the voucher half is the deliberate
      asymmetry, noted here rather than left to look like an oversight.)

## 3. The voucher form

- [x] 3.1 `front-end/src/views/accounting/JournalVoucherView.vue` (new) at `/journal/voucher`,
      route gated by `GL_JV_POST`.
- [x] 3.2 Entry date, memo, and a line editor: account code, debit, credit, optional line memo.
      Lines can be added; the remove control is disabled at two, which is the DTO's
      `ArrayMinSize(2)`.
- [x] 3.3 Running Σ debit and Σ credit through `sumAmounts` — decimal.js, never a JS number
      (design D1). Both shown.
- [x] 3.4 Submit disabled unless the totals are equal AND non-zero, with a separate message for
      each (design D1).
- [x] 3.5 A line carrying two non-zero sides is marked in its row and blocks the submit.
- [x] 3.6 `crypto.randomUUID()` minted when the form opens, sent with every submit, re-minted only
      after a SUCCESSFUL post (design D2).
- [x] 3.7 Account code is a text input, always available; the picker renders additionally when
      `COA_VIEW` is held (design D3).
- [x] 3.8 No client-side postability check — the resolver owns that rule and names the account in
      its refusal (design D3). The form does require a non-empty code, which is a "did you fill the
      field in" check, not an account rule.

## 4. The reversal

- [x] 4.1 `views/JournalView.vue` — a reverse control on every row for holders of `GL_JV_POST`, on
      all source types (design D4). A "new voucher" action in the header for the same code.
- [x] 4.2 A dialog with an optional date and memo, stating that the reversal is dated TODAY unless
      a date is given, and why. The date field starts EMPTY — empty means today, so the default is
      not silently overridden by a pre-filled value.
- [x] 4.3 The dialog states an entry can be reversed at most once. No client-side pre-check; the
      refusal is shown as returned, and the dialog stays open so the reason stays on screen.

## 5. The money defect on the same screen

- [x] 5.1 `JournalView.entryTotal` now sums through `sumAmounts` and formats through `fmtBase`
      (design D5).
      The formatting half was NOT in the plan and is not optional. `sumAmounts` returns a bare
      Decimal — `'100000'` for `100000.00` — so swapping it in for `.toFixed(2)` silently dropped
      the decimal places from every total on the screen. `fmtBase` restores them and uses the base
      currency's own `decimal_places` rather than assuming two, which the old code did.
- [x] 5.2 The same applies to the voucher form's running totals: compared as bare decimals,
      displayed through `fmtBase`.
- [x] 5.3 `JournalView.spec.ts` already existed and was overwritten while adding the reversal
      cases. Its case — `renders a journal entry with its source, memo, and balanced total` — is
      restored, and it is the case that catches 5.1's regression: it asserts `100,000.00`, which a
      bare Decimal does not produce. Confirmed by removing `fmtBase` again and watching it fail.

## 6. Route and i18n

- [x] 6.1 `router/routes.ts` — `/journal/voucher`, name `journal-voucher`,
      `meta.permission: 'GL_JV_POST'`, breadcrumb back to the journal.
- [x] 6.2 `gl.voucher` and `gl.reversal` in `en`, `la` and `zh`. No nav entry — reached from the
      journal.
- [x] 6.3 `i18n.parity.spec.ts` passes (85 tests).

## 7. Tests

- [x] 7.1 `JournalVoucherView.spec.ts` (new) — balanced enables the submit; unbalanced disables it.
- [x] 7.2 All-zero disables it, asserted separately.
- [x] 7.3 A line with both sides non-zero disables it and is marked.
- [x] 7.4 Two submits of the same form send the same `id`; a submit after a SUCCESSFUL post sends a
      different one. The first case mocks a FAILED post on purpose — that is the path where keeping
      the id matters.
- [x] 7.5 Adding and removing lines, with every remove control disabled at two.
- [x] 7.6 Route gating through `evaluateGuard`, both directions.
- [x] 7.7 `JournalView`: no reverse or voucher control with `GL_VIEW` alone; both present with
      `GL_JV_POST`; reverse offered on the non-`MANUAL_JV` row too.
- [x] 7.8 A refused reversal shows the server's message and leaves the dialog open. A further case
      asserts an empty date picker sends `entryDate: undefined` rather than today's date computed
      on the client — the server owns "today", in the company's timezone.
- [x] 7.9 `entryTotal` is pinned by a case the float implementation gets WRONG.
      The first attempt did not pin anything: it used `0.1 + 0.2`, where the old code produced
      `'0.30'` and `toContain('0.3')` matched it. Replaced with `92233720368547.75 + 0.01`, where
      the old code renders `92233720368547.77` — a cent too much, on ordinary two-decimal money.
- [x] 7.10 Voucher view added to `test/smoke/views.smoke.spec.ts`.
- [x] 7.11 Dialog content queried from `document.body`, with an `afterEach` that unmounts and clears.
- [x] 7.12 Negative check run for six behaviours, each by breaking the view and confirming the
      matching case goes red: `nonZero` removed, `balanced` removed, the two-sided check removed,
      the id re-minted on every submit, `entryTotal` reverted to floats, and reverse restricted to
      `MANUAL_JV`.

## 8. Checks

- [x] 8.1 `npm run test` — 85 files, 740 tests, all passing (was 84/721). `npm run typecheck` clean.
- [x] 8.2 `openspec validate --all` — 73 passed, 0 failed.
- [x] 8.3 `openspec/specs/**` untouched.
