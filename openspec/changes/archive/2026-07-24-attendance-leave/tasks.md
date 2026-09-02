## 1. Canonical Model

- [x] 1.1 Add `leave_request` to `erp_approval_system.dbml` under section 8, with notes on why the request is stored as a range with half-day ends rather than a day count, and why `total_days` counts working days only
- [x] 1.2 Add `control_policy` and `paid_limit_value` to the `quota` table in the DBML, with a note that the two ceilings are separate because the paid boundary can fall inside one request, and that `HARD_STOP` / null preserve existing behaviour exactly
- [x] 1.3 Add the `leave_half` enum (`FULL` / `AM` / `PM`) and the relationship lines for `leave_request.document_id` and `.quota_id`

## 2. Quota Changes (highest-risk group — shared by every quota in the system)

- [x] 2.1 Add `controlPolicy` (reusing `ControlPolicy`, default `HARD_STOP`) and `paidLimitValue` (nullable decimal carried as string) to the `Quota` entity, with `[OptionalProps]` so existing fixtures do not break
- [x] 2.2 Write the migration adding both columns; `control_policy` `not null default 'HARD_STOP'` with a check constraint, `paid_limit_value` nullable. Verify forward and back on a scratch database, then apply to the dev database
- [x] 2.3 Change `QuotaUsageService.reserve` so the over-quota branch consults `quota.controlPolicy`: `HARD_STOP` throws as today; `SOFT_WARNING` records the USE row and returns a warning carrying the quota and the overshoot amount
- [x] 2.4 Keep the pessimistic lock on the quota and entitlement rows unchanged for BOTH policies — a soft overshoot must still be measured against a serialized balance, not a stale one
- [x] 2.5 Add a derived paid/unpaid split to `QuotaBalanceService`: `paid = min(netUsage, paidLimitValue)`, `unpaid = max(0, netUsage − paidLimitValue)`, with null `paidLimitValue` meaning fully paid. Derived on read, never stored
- [x] 2.6 Collect the overshoot at submit and log it, matching how the equivalent budget warning is already handled; changing submit's return contract to carry either is out of scope for this slice (decided with the user)
- [x] 2.7 Verify every existing quota spec still passes unchanged — the defaults are supposed to make this change invisible to them, and if any fails, that is a regression not a test to update

## 3. Beneficiary Resolution (touches every requires_quota document type)

- [x] 3.1 Change `DocumentSubmitService` beneficiary resolution to prefer `document.related_employee_id` when set, falling back to the submitter's linked employee
- [x] 3.2 Validate that a `related_employee_id` belongs to the document's own company, rejecting the submit otherwise
- [x] 3.3 Confirm a client-supplied `employee_id` in the request body is still ignored in every path — this is the protection the requirement exists for and it must not be weakened
- [x] 3.4 Verify existing document-engine specs still pass: no current quota-reserving type sets `related_employee_id`, so behaviour should be unchanged for all of them

## 4. Leave Entity and Migration

- [x] 4.1 Add `LeaveHalf` (`FULL` / `AM` / `PM`) to `back/src/common/enums/index.ts`
- [x] 4.2 Add the `LeaveRequest` entity: document (unique, one per document), quota, `fromDate` / `toDate` (`columnType: 'date'`), `fromHalf` / `toHalf`, `totalDays` (decimal as string)
- [x] 4.3 Write the migration with the unique constraint on `document_id`, foreign keys, and a check that `to_date >= from_date`; verify forward and back on a scratch database
- [x] 4.4 Register the entity in `AttendanceModule` and confirm the test ORM picks it up

## 5. Working-Day Counting

- [x] 5.1 Create a pure `countLeaveDays(dates, resolvedShifts, holidays, fromHalf, toHalf)` returning the per-date contribution map and the total — no `EntityManager`, testable as fixtures like `computeDay`
- [x] 5.2 Contribute zero for company holidays and for weekdays the shift does not work
- [x] 5.3 Make a half day contribute half of THAT date's expected minutes, so a half day on a short Saturday is not half of a full weekday
- [x] 5.4 Derive the half applying to each date: `fromHalf` on the first, `toHalf` on the last, `FULL` between
- [x] 5.5 Reject a request whose total is zero — a request covering only non-working days has nothing to charge
- [x] 5.6 Unit-test all of the above as fixtures, including a range spanning a holiday, a weekend, a short Saturday, a single full day, and a single half day

## 6. Leave Service and Submit Integration

- [x] 6.1 Implement `LeaveRequestService.create` writing the `leave_request` row and computing `total_days` through `ShiftResolutionService.resolveRange` plus the holiday set
- [x] 6.2 Add `document_type.derives_quantity` (boolean, default false) — entity, migration, DBML — and make generic `DocumentSubmitService.submit` refuse such a document with an error naming the owning endpoint. document-engine reads its OWN column; it imports nothing from attendance
- [x] 6.3 Add the `leave_type` table keyed one-to-one on `quota`: `advance_notice_days` (default 0), `backdate_limit_days` (default 0), nullable `attachment_required_over_days`. Entity, migration, DBML. NOT columns on `quota` — that table is a general allowance also used for overtime and bookings
- [x] 6.4 Implement `POST /leave-requests/:documentId/submit` in the attendance module: re-count the working days and overwrite `total_days`, enforce advance notice and the backdate limit, enforce the attachment threshold against `document_attachment`, build `quotaReservations` from the re-counted quantity, then delegate to `DocumentSubmitService.submit`
- [x] 6.6 Mark the seeded leave document type `derives_quantity` true, so the generic path refuses it and the owning endpoint is the only way in
- [x] 6.5 Implement `leaveCoverageFor(employeeId, dateRange)` returning, per date, the approved leave half covering it — the input the daily projection needs

## 7. Daily Projection Integration

- [x] 7.1 Extend `computeDay` to accept the date's approved leave coverage, inserting the `LEAVE` branch between `EXEMPT` and `ABSENT` exactly where the comment reserves it
- [x] 7.2 Make a FULL leave day resolve to `LEAVE` with nothing expected
- [x] 7.3 Make a half day NOT change the status: halve `expected_minutes` and move the expected start (for `AM` leave) or expected end (for `PM` leave), so the worked half is judged normally
- [x] 7.4 Load leave coverage once per recompute range in `AttendanceDayService`, alongside the holiday set, rather than per day
- [x] 7.5 Confirm unapproved leave has no effect — only an approved document counts

## 8. Recompute On Approval

- [x] 8.1 Trigger recomputation of the covered dates when a leave document reaches approval, AFTER the approval transaction commits
- [x] 8.2 Do not roll the approval back when recomputation fails; report the failure on the approval response instead
- [x] 8.3 Implement the stale-leave read: approved leave whose covered `attendance_day` has `computed_at` earlier than the document's `approved_at`, or no row at all — using no new stored state
- [x] 8.4 Add `LEAVE_MANAGE` to the attendance permission codes and gate `leave_type` administration (CRUD) with it; the stale read stays gated by the existing `ATTEND_DAY_READ`

## 9. Tests

- [x] 9.1 Quota policy tests: `HARD_STOP` rejects as before; `SOFT_WARNING` records and warns with the correct overshoot; a quota with no explicit policy still blocks
- [x] 9.2 Concurrency test on a `SOFT_WARNING` quota: two concurrent reservations both succeed and the second's warning reflects the balance after the first, proving the lock is still doing its job under the new policy
- [x] 9.3 Concurrency test on a `HARD_STOP` quota: unchanged, exactly one of two racing last-unit reservations wins
- [x] 9.4 Paid split tests: usage below, exactly at, and above `paid_limit_value`; the 28-plus-5 case splitting 2 paid and 3 unpaid; null meaning fully paid; zero meaning nothing paid
- [x] 9.5 Beneficiary tests: `related_employee_id` wins; submitter is used without one; a body-supplied `employee_id` is still ignored; a cross-company related employee is rejected
- [x] 9.6 Working-day tests through the real service: a holiday inside the range, a weekend, a short Saturday half day, a zero-total request rejected
- [x] 9.7 Leave range tests: reversed range rejected; one request per document enforced; the middle of a range resolving to `FULL`
- [x] 9.8 Day status tests: full leave beats `ABSENT`; leave on a holiday stays `HOLIDAY`; unapproved leave leaves `ABSENT`; PM leave still records a late morning arrival; AM leave makes a 13:00 arrival on time
- [x] 9.9 Recompute-on-approval tests: approving refreshes the covered days to `LEAVE`; a recompute failure leaves the approval standing; a draft changes nothing
- [x] 9.10 Stale-read tests: a day computed before approval is listed; recomputing removes it; unapproved leave is never listed
- [x] 9.11 Permission tests for every new route, in the shape of `attendance-permissions.spec.ts`
- [x] 9.13 Derived-quantity tests: generic submit refuses a leave document; the error names the owning endpoint; an ordinary type is unaffected; a type predating the flag still submits
- [x] 9.14 Leave-submit tests: the charged quantity is the RE-COUNTED one, not the caller's; a holiday declared between create and submit reduces the charge; advance-notice and backdate-limit violations are refused with nothing reserved; the attachment threshold is enforced
- [x] 9.12 Run the full backend suite and diff typecheck errors against committed `HEAD`; report any delta rather than assuming none. Pay particular attention to the quota and document-engine specs — those are the shipped capabilities this slice modifies

## 10. Seed and Verification

- [x] 10.1 Seed an `ANNUAL_LEAVE` quota (`HARD_STOP`, fully paid) and a `SICK_LEAVE` quota (`SOFT_WARNING`, `paid_limit_value` 30) so the two policies are visible side by side in the dev data
- [x] 10.2 Seed a leave document type with `requires_quota` and a workflow, plus an entitlement for the seeded employee
- [x] 10.3 Verify against the dev database that a leave spanning the seeded Saturday half-day charges the right fraction, and that approving it flips the covered `attendance_day` rows from `ABSENT` to `LEAVE`
- [x] 10.4 Confirm the DBML, the migration, and the entities agree on every column of `leave_request` and the two new `quota` columns
- [x] 10.5 Re-run `openspec validate attendance-leave`
