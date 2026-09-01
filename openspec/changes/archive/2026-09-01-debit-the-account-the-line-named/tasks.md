## 1. Entity and migration

- [x] 1.1 Add nullable `account?: Account` (`fieldName: 'account_id'`) to `DocumentLine`, documenting
  that it is stamped at submit and never re-derived, and that a null means "post the old way".
- [x] 1.2 Add `account_id uuid` with its FK and index to `document_line` in
  `erp_approval_system.dbml`, matching the entity.
- [x] 1.3 Hand-write the migration — one `add column`, one FK, one index, no backfill. Do NOT ship
  `migration:create`'s output: it diffs entities against the database and proposes dropping
  `stock_txn_qty_positive`, `budget_txn`'s index and a dozen attendance check constraints.

## 2. Stamp the account at submit

- [x] 2.1 Extract the resolution chain from `DocumentService.resolveLineGlAndBudget` into something
  submit can call for the account as well as the code — item's `item_company.default_gl_account`,
  else `documentType.defaultGlAccount`, else `budget.glAccount`.
- [x] 2.2 In `DocumentSubmitService.submit`, resolve each positive line's code through
  `AccountService.resolvePostable` and stamp `line.account`, in the same pass that writes
  `budgetBaseLineAmount`, before `reserveLines` is built.
- [x] 2.3 Leave `document_line.gl_account` exactly as it is — a display value, resolved at draft
  time, free to be empty.
- [x] 2.4 Tests: item's GL wins; type default outranks the budget on an item-less line; budget is
  the last resort; an inactive/non-postable/foreign code is refused; the stamp does not move when
  the item's default GL is edited afterwards.

## 3. Refuse the line, not the budget

- [x] 3.1 Replace the `!l.budget.account` refusal with one that fires when a positive line resolves
  no account, naming the line and the item / document type / budget as the three places to set one.
- [x] 3.2 Keep it before `reserveLines` and outside the write transaction, so a refusal leaves the
  document `DRAFT` with no `budget_txn`.
- [x] 3.3 Delete the now-wrong tests from `gl-account-autofill.spec.ts` (the per-budget refusal) and
  replace them with the per-line ones; keep the fixture's `withoutAccount` budget, which is now a
  budget that passes when its type names a default.
- [x] 3.4 Tests: refused when nothing names an account; accepted when only the type names one;
  accepted when only the item does; zero-amount line raises nothing; a refused submit reserved
  nothing and left `doc_no` unchanged.

## 4. Apportion the ACTUAL across lines

- [x] 4.1 Write the apportionment as its own pure function — `(actual, lines) => Map<accountId,
  amount>` — pro rata by `budgetBaseLineAmount`, rounded to the currency scale, residue to the
  largest line. Unit-test it on its own before wiring it in.
- [x] 4.2 Property-check it: for random line sets and amounts, the shares always sum to the input
  exactly, and the result does not depend on line order.
- [x] 4.3 Handle the zero-basis case: no line carries a basis → the whole amount goes to the
  budget's own account.

## 5. Post from the line's account

- [x] 5.1 Rewrite the settlement expense side (`gl-posting.service.ts:576`) to build `perAccount`
  from the apportionment keyed by `line.account ?? line.budget.account`.
- [x] 5.2 Do the same for the accrual path (`:719`), which carries the identical loop.
- [x] 5.3 Move `accountByLineOf` to read the line's stamped account with the budget as fallback, and
  replace its docblock: the objection it records — re-deriving mutable config at payment — is
  answered by stamping an FK at submit, and the new text should say so rather than be deleted.
- [x] 5.4 Key `stockPortionByAccount` by the same line account, so the GRNI split and the expense
  apportionment agree by construction.
- [x] 5.5 Fail, not skip, when a line has neither account — keeping the existing message and the
  `blocked_by_budget_id` cause.
- [x] 5.6 Tests: one budget → two accounts; two budgets → one account; partial settlement pro rata;
  rounding residue; unstamped lines post to the budget's account; a mixed stamped/unstamped
  document; the stock split still clears GRNI and never exceeds what was cut.

## 6. Stop overstating it on the budget screens

- [x] 6.1 Drop `namesNoAccount` from `BudgetService.list` and from the budgets API type.
- [x] 6.2 Remove the list tag and its two i18n keys in all three locales.
- [x] 6.3 Rewrite `budgets.form.glAccountHint` in all three locales to place the account in the
  chain rather than warn about a refusal that no longer happens.
- [x] 6.4 Delete `budget-list-marks-unpostable.spec.ts` and the hint assertion added to
  `budget-plan-screens.spec.ts`; replace with one asserting the hint no longer claims the budget
  cannot be charged.

## 7. Say it properly in the document UI

- [x] 7.1 Update the refusal wording to name the line and the three sources, with the permission
  that can set each where the requester cannot.
- [x] 7.2 i18n with en/la parity; no hardcoded strings or colours. NOTE: no new UI strings — the
  refusal is the server's sentence rendered by the existing refusal banner, as it was before this
  change. The i18n work was on the budget form/list keys in task 6.
- [x] 7.3 Update `refused-for-an-unmapped-budget.spec.ts` to the new message, keeping its two
  assertions: the reason persists, and no missing-field prompt appears beside it.

## 8. Verify

- [x] 8.1 Backend and frontend suites green.
- [x] 8.2 Re-read `budget-ledger-reconciliation` against a budget now posting to two accounts — it
  reconciles on per-document totals, which still hold, but confirm rather than assume.
  DONE, and it does NOT hold: a budget on `5200` sending 600 to `5210` leaves 600 unexplained on
  `5210` and reports 600 on `5200` as capitalised into stock. The decomposition is per (account,
  document), not per document. Fixed in section 9.
- [x] 8.3 In the browser against the dev stack: set `default_gl_account` on `RECADMIN`, submit a
  document charging the account-less `1.101`, and confirm it now submits.
  DONE, on `erp_verify_8_3` — a clone of `hal_erp`, so no customer row was written; `hal_erp` still
  has no `document_line.account_id` at all. `default_gl_account = 606.0001` was set on `RECADMIN`
  through the UI, and `RECADMIN-HAL-2026-0003` charging the account-less `1.101` then submitted:
  HTTP 200, `IN_APPROVAL`, RESERVE 5,000, line stamped `606.0001` from the type's default with the
  budget still naming none. Before this change that submit was refused — which is the whole point of
  the change, and the half only real data could show.
  NOT verified here: that the settlement debits `606.0001`. The workflow needs four named approvers
  in sequence, invariant 8 forbids the creator approving, and driving it would have meant
  authenticating as four people. Covered instead by 5.6, which exercises the apportionment far more
  thoroughly than one click could — one budget to two accounts, two budgets to one, partial
  settlement pro rata, the rounding residue, stamped and unstamped lines on one document, and the
  GRNI split. Re-open this if the posting is ever reworked; a single manual settlement is a weaker
  witness than those, not a stronger one.

- [x] 8.4 Say plainly in the change summary that the expense side moves: from the first settlement
  after deployment, a budget's spending may debit several accounts, so month-on-month comparisons
  are no longer like for like.

## 9. Make the reconciliation survive a budget with two accounts

Found by 8.2. `reporting` joins the change's modified capabilities; the spec delta is in
`specs/reporting/spec.md`.

- [x] 9.1 Split each budget's `ACTUAL` across the accounts it actually reached, reusing
  `apportion()` on the charging document's lines — same function, same stamped
  `budget_base_line_amount`, same fallback to the budget's account for an unstamped line — so the
  report and the posting cannot disagree about where the money went. Do NOT re-derive the account
  from the item or the document type; both are configuration and may have moved since submit.
- [x] 9.2 Report the gap as two signed figures per account: what this account's budgets spent
  elsewhere, and what other accounts' budgets spent here. Signed apart for the reason the crossings
  are — sending out and receiving in are different facts that net to nothing when added.
- [x] 9.3 Subtract the other-account share BEFORE the capitalisation inference, which reads
  `consumedOnAccount > debited` and cannot otherwise tell an expense account from GRNI. This is the
  half that reports ordinary expense as inventory, so it is the half that matters.
- [x] 9.4 Keep the budget side grouped by the budget's own account — `appropriated` and `committed`
  are facts about a budget, not about where its spending landed. Where it went is a cause, not a
  regrouping.
- [x] 9.5 Give an account that received spending but carries no budget of its own a row, so the
  movement is not invisible. Today `keyInfo` is built only from budgets.
- [x] 9.6 Surface both figures in `BudgetLedgerReconciliationView.vue` beside the other causes, with
  en/la/zh parity and no hardcoded colours.
- [x] 9.7 Tests: the 8.2 fixture (one budget → two accounts) reaching zero on both rows; spending
  sent elsewhere is not called capitalisation; a genuine stock capitalisation on a line-stamped
  account still is; a document carrying both causes splits between them; an unstamped document reads
  exactly as before; spending reaching an account no budget names is still reported. The suite's
  existing every-row-reaches-zero assertion must pass with the fixture in place.
- [x] 9.8 Backend and frontend suites green.
