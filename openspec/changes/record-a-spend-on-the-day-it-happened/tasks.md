## 1. Schema

- [x] 1.1 Add `records_past_events` to the `DocumentType` entity — boolean, default `false`.
- [x] 1.2 Add the stated day to the `Document` entity as `moneyMovedOn` — `columnType: 'date'`,
      nullable, named for what it holds.
- [x] 1.3 Migration `Migration20260903000000`, hand-written and recorded in the DBML.
      `migration:create` diffed the entities against the database and proposed dropping every check
      constraint in the schema, the `(budget_id, txn_date)` index on `budget_txn`, and renaming four
      unique constraints — pre-existing drift between hand-written SQL and entity metadata, none of
      it this change's business. Kept the two `add column` statements and discarded the rest.
- [x] 1.4 Applied and verified inert: 14 existing types all read `records_past_events` false, the
      `budget_txn` index survived, and all 9 check constraints on the sampled tables are intact.

## 2. Permission

- [x] 2.1 `DOC_BACKDATE` declared in `DocumentPermissions`, which `allPermissionCodes()` already
      folds into the catalogue.
- [x] 2.2 `permissions:sync` run and verified. It inserted 13 rows, only one of them this
      change's: `PERIOD_*` (4), `GL_JV_APPROVE`, `GL_JV_POST`, `GL_POST_RETRY`, `BANK_ACCOUNT_*` (2),
      `VAT_FILE`, `WHT_CERTIFY`, `WHT_REMIT` were declared in code and missing from this database,
      so every endpoint behind them answered 403 for everyone. Pre-existing; reported, not caused.

## 3. Write path

- [x] 3.1 `moneyMovedOn` accepted on create and refused when the type's `records_past_events` is
      false. There is no general update DTO — edits go through `SetPayee`/`SetSelections`/
      `SetVendorInvoice` — so the day is stated at create, which is where the spec needs it.
- [x] 3.2 A day before today from a caller without `DOC_BACKDATE` is refused naming the permission.
- [x] 3.3 The three guards in `assertDayIsAllowed`, run after the budgets are known and before any
      lock is taken: inside the fiscal year of every budget charged, not in the future, and — through
      the existing `PeriodGuardService.assertOpen`, the same guard the GL asks — not inside a closed
      accounting period.
- [x] 3.4 `companyDayFor` became `ledgerDayFor` and returns the document's stated day where it has
      one. One edit: all six call sites already went through it.
- [x] 3.5 Settlement and release inherit that day from the same helper, so a document's rows cannot
      straddle two quarters. The two movement call sites keep their explicit `effectiveDate`, which
      still wins.
- [x] 3.6 Balance check left on today's balance, with the reason written where the next reader will
      look for it.
- [x] 3.7 `AccountingModule` wired into `document-engine`; `boot-check` confirms every provider
      resolves. It also caught three document types I had configured earlier today with no
      `authoring_route` — they would have appeared in the generic wizard and spent a document number
      on drafts that can never be submitted. Fixed: `BUDGET_PLAN` → `budget-new`, the two adjustment
      types → `budgets`.

## 4. Screens

- [x] 4.1 `recordsPastEvents` toggle on the document-type form, in the behaviour step beside
      `postAction` rather than inside the `FLAGS` group — a `requires_*` flag decides what the
      REQUESTER must supply, and this one decides what the DOCUMENT may carry.
- [x] 4.2 The day field on the create form, shown only for a type that records past events. `min` is
      today for a user without `DOC_BACKDATE` and `max` is today for everyone, so the picker does not
      offer what the server will refuse.
- [x] 4.3 Document detail shows the stated day, labelled apart from "created" and "submitted"
      because it is stated by a person rather than stamped by the system.
- [x] 4.4 Three locales, with the customer's own wording: `ວັນທີ່ເງິນອອກຈິງ` / Day the money moved /
      资金实际支出日. Two test guards caught real mistakes here — the `la` catalog forbids showing a bare
      English acronym to a user, so the hint names the right in words instead of printing
      `DOC_BACKDATE`, and the label-binding guard counts controls, so its 10 became 11.

## 5. Tests

Three files touched: `budget/backdated-ledger-day.spec.ts` for what the ledger does with a day,
`document/stating-the-day-money-moved.spec.ts` for who may state one, and the existing
`document/budget-rate-control.spec.ts` for what submit does with it — extended rather than copied,
because it already builds the submit harness the last three cases need.

- [x] 5.1 A stated day dates `RESERVE`.
- [x] 5.2 Settlement writes `ACTUAL` and `RELEASE` on the same day; a release on reject does too.
- [x] 5.3 A type with the flag false refuses a day at create.
- [x] 5.4 A user without `DOC_BACKDATE` is refused a past day, allowed the type with no day, and
      allowed TODAY — the boundary matters, or an ordinary user is locked out of a type configured
      for them.
- [x] 5.5 Each guard on its own: the future guard refuses even a `DOC_BACKDATE` holder; a day
      outside the budget's fiscal year is refused naming the year; a day inside a closed accounting
      period is refused. The last one supplies `PeriodGuardService` to the harness — the service
      takes it optionally, so without that the test would have proved only its absence.
- [x] 5.6 The stated day dates the ledger while `submitted_at` keeps the real clock.
- [x] 5.7 A stated day does not change the balance: a backdated reserve leaves what the same reserve
      leaves undated.
- [x] 5.8 Two backdated submissions racing for the same budget: one wins, exactly as undated ones
      do. Added beside the test it mirrors in `budget-control-point-concurrency.spec.ts`.
- [x] 5.9 Nothing changed for an ordinary type — the full suite passes: 2,080 tests, up from 2,065
      by the 15 added here, none altered.

## 6. Rollout

- [x] 6.1 `permissions:sync` run; `DOC_BACKDATE` granted to `BUDGET_OFFICE` at COMPANY scope and to
      nobody else. `STAFF` may raise these documents but not re-date them — deciding which quarter a
      spend falls in is the act the design says to grant narrowly.
- [x] 6.2 Type `SPEND_HIST` (`ບັນທຶກລາຍຈ່າຍຍ້ອນຫຼັງ`) created with `records_past_events`,
      `requires_budget` and `post_action` `CUT_BUDGET`, form template v1 published, and mapped for
      all 20 departments. `CUT_BUDGET` is what makes a submit reserve against the budget it charges,
      which is what the quarterly read counts as consumption.
- [ ] 6.3 Enter one month of one budget by hand end to end and read the quarterly report against the
      workbook. **Blocked, deliberately**: the company holds no budgets yet — the staff are entering
      the plan themselves — and inventing one to demonstrate with would put test data in a database
      the customer has just restored. Do this against the first real budget they enter, before
      letting anyone key the other eleven months.
