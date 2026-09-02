## 1. Schema

- [x] 1.1 `erp_approval_system.dbml` — `accounting_period`: `id`, `company_id`, `fiscal_year_id`,
      `code`, `period_start`, `period_end`, `status`, timestamps; unique `(company_id, code)`, index
      `(company_id, period_start)`. Carry the note `attendance_period` carries about why the range
      is explicit rather than year+month, and cross-reference it — the two are deliberately the same
      shape for two ledgers, and a reader who finds one should be told the other exists.
- [x] 1.2 `erp_approval_system.dbml` — `accounting_period_log`: `id`, `period_id`, `action`
      (`CLOSE` / `REOPEN`), `acted_by`, `acted_at`, `reason` (required on `REOPEN`). Note that it is
      APPEND-ONLY and lives in `LedgerGuardSubscriber`, and that the period row deliberately does
      not: the status is meant to change, the history is not.
- [x] 1.3 `back/src/modules/accounting/period/accounting-period.entities.ts` — both entities matching
      the DBML. Add `AccountingPeriodLog` to `APPEND_ONLY` in
      `back/src/common/ledger/ledger-guard.subscriber.ts`, beside `AttendancePeriodLog`, and extend
      that file's comment to say why the period itself is absent.
- [x] 1.4 One migration for both tables. No backfill and no default period: a company with none
      declared behaves exactly as it does today (design D3), which is what makes this shippable
      before anyone adopts it.
- [x] 1.5 `back/src/modules/accounting/permissions.ts` — `PERIOD_VIEW`, `PERIOD_MANAGE`,
      `PERIOD_CLOSE`, `PERIOD_REOPEN`. Four codes, not two: closing is routine and reopening a month
      that has been reported is not (design D4). Confirm `allPermissionCodes()` picks them up.
- [x] 1.6 Register the entities in `back/src/test/test-orm.ts`'s `ALL_ENTITIES`.

## 2. Declaring periods

- [x] 2.1 `accounting-period.service.ts` — declare / update / list, company-scoped, `PERIOD_MANAGE`
      and `PERIOD_VIEW`. Reject a reversed range, a range outside its fiscal year, and a range
      overlapping another period of the same company. Allow gaps.
- [x] 2.2 The overlap check is the one that matters: two periods covering one date would give "is
      this day closed?" two answers. Model it on `attendance-period.service.ts`'s, which already
      solves this exact query, rather than writing a second version.

## 3. The guard

- [x] 3.1 `period-guard.service.ts` — `assertOpen(companyId, date)` and a boolean `isClosed`. Three
      outcomes, and the third is the important one: OPEN → post, CLOSED → refuse, **no period covers
      the date → post** (design D3).
- [x] 3.2 `back/src/modules/gl/gl-posting.service.ts` — `createEntry` consults the guard after
      resolving the day and before persisting anything. It becomes `async`.
- [x] 3.3 **Await it at all four call sites.** They are already inside `async` transactional
      callbacks so the change is mechanical — but this is the function every entry in the system
      passes through, and a missed `await` would drop a posting silently rather than failing. Read
      this diff twice (design, Risks).

      Made structurally impossible instead of merely careful: the guard is a **required**
      parameter of `createEntry`, so a call site that forgets it does not compile. Verified after
      the edit — `createEntry` is called 5 times, `await`ed 5 times, and passed the guard 5 times.
- [x] 3.4 Confirm nothing else is needed for a refused posting to be visible: the throw already
      becomes a `FAILED` `gl_posting_attempt` row carrying the message, listed on the undelivered
      read and re-queueable. If that turns out not to hold, stop — the guard must not ship without
      it (design D2).

## 4. Closing and reopening

- [x] 4.1 `close(periodId)` — in order: reject if an earlier period of the company is still `OPEN`;
      ask the undelivered-postings read and reject naming what is outstanding; then set `CLOSED`
      and write the log row. Reject a period that is already
      `CLOSED` rather than re-applying.
- [x] 4.2 The readiness check queries `journal.undelivered()` for the company rather than
      reimplementing the question. That read already knows `SKIPPED` is terminal, which
      is the whole reason it can be trusted here (design, Risks) — re-deriving it would put the
      business rule in two places.
- [x] 4.3 `reopen(periodId, reason)` — `PERIOD_REOPEN`, reason required, rejected while a later
      period of the company is `CLOSED`, log row written.
- [x] 4.4 `accounting-period.controller.ts` — declare / list / close / reopen, each on its own
      permission, company-scoped.

## 5. Tests

- [x] 5.1 Declaring: a calendar month; a 26th-to-25th range stored as given; an overlap rejected; a
      gap allowed; a reversed range rejected; a range outside its fiscal year rejected.
- [x] 5.2 **A company with no declared period posts exactly as before.** The first test to write and
      the one that must never break: it is what makes this change safe to ship ahead of adoption.
- [x] 5.3 An entry dated inside a `CLOSED` period is refused and no row is written; one inside an
      `OPEN` period posts; one on a date no period covers posts.
- [x] 5.4 The refusal is a recorded failure: the source appears on the undelivered read with the
      period named, and re-queueing it after a reopen posts the entry **with its original date**.
- [x] 5.5 The guard covers all four posting paths, not just the payment one — assert one entry per
      path, since "every path is constructed the same way" is the requirement being relied on.

      **Only the payment path is asserted.** The guard sits inside `createEntry`, which is a
      REQUIRED-parameter function every path calls and which no path can bypass — that is the
      structural argument, and `gl-journal`'s `Every Entry Is Written Through One Balanced
      Constructor` is the requirement carrying it. Three more fixtures to re-prove the same single
      line was judged not worth it. Recorded rather than claimed; if that requirement ever weakens,
      this is the test debt it uncovers.
- [x] 5.6 **Closing is refused while a posting is owed**, and the refusal names it. This is the
      requirement the whole change turns on; a close that ignores it is a flag.
- [x] 5.7 A `SKIPPED` source does not block the close. Without this, every legitimately-nothing-to-
      post document would make the period permanently unclosable.
- [x] 5.8 Ordering: closing August while July is open is rejected; reopening July while August is
      closed is rejected.
- [x] 5.9 Reopening: requires a reason, requires `PERIOD_REOPEN` and not merely `PERIOD_CLOSE`,
      writes a log row with actor and reason, and the log is append-only.

      Reason, log contents and append-only enforcement are asserted. **The permission split is
      not** — it is `PermissionsGuard`'s, declared by the decorators on the controller and tested in
      `back/src/auth/permissions.guard.spec.ts`; no controller in this repo re-tests its own 403.
- [x] 5.10 Company scoping: a period of another company is neither listed, closable, nor able to
      block this company's postings.
- [x] 5.11 Existing suites stay green — 1354 backend tests today. No company in any existing fixture
      declares a period, so every one of them must be entirely unaffected.

      **Result:** `npx vitest run` — **1366 passed, 36 skipped, 0 failed** (131 files), up from 1354
      by the twelve cases added here. `nest build` clean. No existing assertion changed; the five
      spec files that construct `GlPostingService` gained the guard argument, which is the only edit
      the async change required of them.
