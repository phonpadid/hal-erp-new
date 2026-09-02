## 1. Move the clock out of attendance

- [x] 1.1 Move `back/src/modules/attendance/company-clock.ts` to
      `back/src/common/time/company-clock.ts`. `localDateIn` and `localMidnightInstant` move
      **verbatim** — same signatures, same bodies, same comments including the note about why the
      formatter is cached. Any behaviour edit riding along makes the move unreviewable (design D2).
- [x] 1.2 Repoint the five importers. Do not leave a re-export at the old path: two import paths for
      one function is how the next reader concludes there are two functions (design D2).
- [x] 1.3 Run the attendance suite unchanged. Day boundaries there are load-bearing for shift dates,
      OT windows and period membership; green without edits is the check that the move was a move.

## 2. One seam for every entry date

- [x] 2.1 `back/src/modules/gl/gl-posting.service.ts` — add a private
      `entryDateFor(company: Company, instant: Date): string` that reads `company.timezone` and
      calls `localDateIn`. It takes the company, not a timezone string, so "the *posting company's*
      day" stays visible at each call site (design D1). It SHALL NOT fall back to UTC when the
      timezone is absent — the column is `not null`, so a missing value is a data fault worth
      surfacing, and papering over it is the behaviour being removed.
- [x] 2.2 Route all four derivations through it, keeping each path's instant and its fallback ladder
      exactly as they are:
      - line 175 payment settlement — `payment.paidAt ?? payment.createdAt ?? new Date()`
      - line 262 approval accrual — `document.approvedAt ?? new Date()`
      - line 353 claim settlement — `new Date()`
      - line 483 stock movement — `txn.createdAt ?? new Date()`
      Confirm the company is in hand on each path (`payment.company` is populated; the accrual and
      settlement paths load `document.company`; the stock path resolves `companyId` before building
      lines) and load it where only an id is held.
- [x] 2.3 Leave a comment at the helper naming what it is for beyond formatting: it is the single
      place a future accounting-period guard checks whether the resolved day is open.

## 3. Spec

The requirement text lives in this change's `specs/gl-journal/spec.md` delta, which `/opsx:archive`
syncs into `openspec/specs/`. Editing `openspec/specs/` here would apply the same text twice.

- [x] 3.1 `specs/gl-journal/spec.md` delta — ADDED `Entry Date Is The Posting Company's Own
      Calendar Day`, stated as a rule over any posting path rather than an enumeration of the four
      that exist, so a fifth path is covered by construction (design D3). Its scenarios use instants
      inside the UTC-offset window, not midday.
- [x] 3.2 Same delta — MODIFIED `Config-Driven System Account Roles`: `VAT_INPUT` and `WHT_PAYABLE`
      in the enumerated roles with a sentence each, matching how the inventory roles are described,
      plus the scenario for an unmapped `VAT_INPUT`. The MODIFIED requirement is restated in full,
      since archive replaces it wholesale. No code changes (design D4).

## 4. Tests

- [x] 4.1 `back/src/modules/gl/gl-posting.service.spec.ts` — a company at `Asia/Vientiane` settling a
      payment at 23:30 UTC on 31 July asserts `entry_date` `2026-08-01`. A midday instant would pass
      under either implementation and must not be the case that pins this (design D3). A second case
      pins the other side of the boundary (09:00 UTC stays `2026-07-31`), so the zone is shown to be
      applied rather than added. Both sit ABOVE the role-unmapping case, which deletes the company's
      `CASH_CLEARING` mapping and does not restore it; a comment now says so at that test.
- [x] 4.2 `back/src/modules/gl/approval-accrual.spec.ts` — an approval at 23:00 local on the last day
      of a month asserts the accrual stays in that month.

      **Spec delta corrected while writing this.** The scenario originally read `Asia/Bangkok` at
      23:00 local, which does **not** discriminate: at UTC+7 that instant is 16:00 UTC the same day,
      so the old derivation gives the same answer — exactly the trap design D3 warns about. It now
      names a zone west of UTC (`America/New_York`), where 23:00 local on 31 July is 03:00 UTC on
      1 August and the old code moved the figure into the next month. The test uses company B at
      `America/New_York`.
- [x] 4.3 `back/src/modules/gl/stock-posting.spec.ts` — a stock movement inside the offset window
      asserts the company's day. The `stock_txn` row is INSERTed with a chosen `createdAt` rather
      than taken through the `move` helper, because the ledger is append-only and its timestamp
      cannot be edited afterwards. Placed above that file's own role-unmapping case, likewise
      commented.
- [x] 4.4 A claim settlement asserts the same, covering the fourth path
      (`back/src/modules/document/settlement.spec.ts`). This path has no instant of its own — it is
      dated `new Date()` — so the test pins the clock with `vi.useFakeTimers({ toFake: ['Date'] })`,
      faking Date only so the database driver's timers keep running, and restores real timers in a
      `finally`.
- [x] 4.5 Two companies in different zones posting at one instant assert different `entry_date`
      values, pinning that the day is resolved per company and not per server. Lives in
      `approval-accrual.spec.ts`, which already builds two companies; it maps `CLAIM_PAYABLE` for
      company B so B can post, and therefore sits AFTER the case asserting only company A maps one.
- [x] 4.6 `back/src/modules/gl/financial-reports.service.spec.ts` — confirm the report suites stay
      green: they range over `entry_date` and must be unaffected by how it is produced.

      **Result:** `npx vitest run` — **1326 passed, 36 skipped, 0 failed** (129 files), up from 1320
      by the six cases added here. `nest build` clean. The attendance suite passes with only its four
      import lines changed, and `git diff` of the moved `company-clock.ts` is empty, which is the
      check that task 1.1's move was a move. `eslint` is not a gate on this repo — a file untouched
      by this change already reports 20 prettier complaints — and the production files this change
      edits report the same count before and after (`gl-posting.service.ts` 42→42).
