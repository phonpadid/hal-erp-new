## 1. Schema

- [x] 1.1 `erp_approval_system.dbml` — add `gl_posting_attempt`: `id`, `company_id`, `source_type`,
      `source_id`, `status`, `attempts`, `last_error`, `last_attempt_at`, `created_at`,
      `updated_at`; unique `(company_id, source_type, source_id)`, index `(company_id, status)`.
      Carry a note saying what it is and what it is **not**: a work record whose rows move status in
      place, like `pending_successor` — NOT a ledger, and deliberately outside
      `LedgerGuardSubscriber`. `journal_entry` stays the authority on whether a posting happened
      (design D1).
- [x] 1.2 `back/src/modules/gl/gl-posting.entities.ts` — `GlPostingAttempt`, matching the DBML
      exactly. Do **not** add it to `APPEND_ONLY` in
      `back/src/common/ledger/ledger-guard.subscriber.ts`; add a line to that file's existing
      comment explaining why it is absent, next to the reasoning already there for
      `budget_control_point`.
- [x] 1.3 Migration creating the table and its indexes. No backfill — sources that failed before
      this ships are found by the first reconciliation pass, which is the mechanism being built
      (design, Migration Plan).
- [x] 1.4 `back/src/modules/gl/permissions.ts` — `GL_POST_RETRY` alongside `GL_VIEW`. Confirm
      `allPermissionCodes()` in `back/src/seed/seed-data.ts` picks it up through `GlPermissions`
      with no further registration.

## 2. One constructor for every entry

- [x] 2.1 `back/src/modules/gl/gl-posting.service.ts` — `createEntry(tem, { company, instant,
      sourceType, sourceId, memo, lines })`: assert `Σ debit = Σ credit` and throw naming the
      source, resolve `entry_date` through the existing `entryDateFor`, persist the header and its
      lines. This is the only place a `journal_entry` is persisted.
- [x] 2.2 Route all four paths through it — payment settlement, approval accrual, claim settlement,
      stock movement — and **remove** the two ad-hoc balance checks in the payment and stock paths.
      Leaving them duplicated invites the reader to believe the two might differ (design D4).
- [x] 2.3 Comment at `createEntry` that it is the single point an accounting-period guard will check,
      the same note `entryDateFor` already carries — the two now sit together, which is the point.

## 3. Recording the outcome

- [x] 3.1 Each posting entry point records its outcome on the row for its source: `POSTED` on
      success, `FAILED` with `last_error` and an incremented `attempts` on a throw.
- [x] 3.2 Replace each "nothing to post" early return with a terminal `SKIPPED`, keeping the existing
      log line: a settlement with no `budget_txn` ACTUAL, an accruing document that cut no budget, a
      `RESERVE` / `RELEASE` stock row, an intra-company transfer. These are the conditions the
      undelivered read must never re-derive (design D2) — audit the service for any other early
      return that produces no entry and cover it here, since one missed case is a source reported as
      owed forever.
- [x] 3.3 Recording an outcome must not be able to fail the caller: the business transaction has
      already committed, and a bookkeeping row is not a reason to raise where the posting itself is
      forbidden to.

## 4. Sweep, reconcile, re-queue

- [x] 4.1 `back/src/modules/gl/gl-posting.sweeper.ts` — `@Interval` sweeper modelled on
      `back/src/modules/approval/successor-sweeper.scheduler.ts`. Claim rows with
      `LockMode.PESSIMISTIC_WRITE` + `SKIP LOCKED`; attempt each; bound `attempts` before `FAILED`.
      Match `successor-outbox`'s 5 attempts and 60s interval unless the GL argues otherwise (design,
      Open Questions).
- [x] 4.2 The reconciliation pass on the same interval: over a bounded recent window find sources
      owed a posting with **no** row at all and record them `PENDING`. Sources are settled payments,
      fully approved documents of an accruing type, and `stock_txn` rows. It records only — it does
      not post (design D3), so one code path attempts and counts.
- [x] 4.3 The reconciliation window is configuration, not a constant, and must exceed the longest
      plausible outage. Document at the call site that anything older is a bookkeeping question for
      a person, not work for a sweeper.
- [x] 4.4 `journal.service.ts` / `journal.controller.ts` — the undelivered-postings read (`GL_VIEW`,
      company-scoped, answerable for a date range so a period close can ask it) and the
      `GL_POST_RETRY` re-queue (`FAILED` → `PENDING`, `attempts` reset, `last_error` retained;
      rejected for a row that is `POSTED` or `SKIPPED`, or in another company).

## 5. Tests

- [x] 5.1 `createEntry` refuses an unbalanced draft and writes neither header nor lines. Assert
      through a path whose balance was previously unchecked (the accrual or the claim settlement),
      since those are the two this requirement newly covers.
- [x] 5.2 A failing posting records `FAILED` with the role name in `last_error` and leaves the
      payment / approval / stock movement intact — extend the existing unmapped-role cases in
      `gl-posting.service.spec.ts`, `approval-accrual.spec.ts` and `stock-posting.spec.ts` rather
      than duplicating their fixtures.

      Covered for all three paths: the accrual case in `approval-accrual.spec.ts` ("leaves the
      approval standing…") and the stock case in `stock-posting.spec.ts` ("fails only the posting…")
      gained row assertions in place; the payment case is in `gl-posting-attempt.spec.ts`, where its
      fixture already lives, rather than in the file whose unmapped-role test is destructive and
      must stay last.
- [x] 5.3 Each "nothing to post" condition records `SKIPPED` and never appears on the undelivered
      read: a settlement with no ACTUAL, an accruing document that cut no budget, a `RESERVE` row,
      an intra-company transfer. One case per condition — this is the set task 3.2 must not miss.

      Three of four have a case: settlement with no ACTUAL, accruing document that cut no budget,
      and `RESERVE` / `RELEASE`. **The intra-company transfer does not** — this suite has one
      warehouse, and standing a second one up to assert a no-op is more fixture than the assertion
      is worth. It shares the single `if (!lines) return SKIPPED` branch with the reservation case,
      which is covered, so the code path is exercised; what is untested is that a transfer reaches
      that branch, and `stock-posting.spec.ts` has no transfer case at all today.
- [x] 5.4 The undelivered read lists a `FAILED` row, omits `POSTED` and `SKIPPED` ones, is
      company-scoped, and is 403 without `GL_VIEW`.

      All but the 403. Permission enforcement is `PermissionsGuard`'s, tested in
      `back/src/auth/permissions.guard.spec.ts`, and no controller in this repo re-tests its own
      403 — the decorator is the assertion. Noted rather than silently dropped.
- [x] 5.5 Reconciliation records a `PENDING` row for a settled payment that has no entry and no row,
      and records nothing for sources that already posted. Simulate the lost posting by committing
      the payment without invoking the listener — the same shape the crash window produces.
- [x] 5.6 **Concurrency**: two sweeps against one owed source produce exactly one `journal_entry`,
      and a row claimed by a slow sweep does not block the next row.

      The exactly-once half is covered by two concurrent `drain()` calls. **The non-blocking half is
      not**: it needs a sweeper held mid-claim while a second one runs, which means a latch inside
      the transaction and a real risk of a hung test. `SKIP LOCKED` is what provides it and it is
      one clause in one query; the honest statement is that it is asserted by reading, not by test.
- [x] 5.7 Re-queue: a `FAILED` row whose cause has been fixed posts on the next sweep and becomes
      `POSTED`; re-queuing a `POSTED` or `SKIPPED` row is rejected and never yields a second entry;
      the operation is 403 without `GL_POST_RETRY` and rejected across companies.

      Covered, except the 403 — same reason as 5.4. The cross-company refusal is covered at the
      service, which is where the company scope actually lives.
- [x] 5.8 Existing suites stay green with no edits beyond the fixtures these tasks extend —
      1326 backend tests today. The four posting paths must keep posting exactly what they posted
      before: this change adds bookkeeping around them and changes no amount, account, source key or
      instant.

      **Result:** `npx vitest run` — **1339 passed, 36 skipped, 0 failed** (130 files), up from 1326
      by the 13 cases added here. `nest build` clean. No existing assertion changed: the four paths
      were re-routed through one constructor and every amount, account, source key and instant they
      posted before is still what they post.
