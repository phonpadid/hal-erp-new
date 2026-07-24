## 1. Canonical Model

- [x] 1.1 Add `overtime_claim` to `erp_approval_system.dbml` under section 8, with notes on why the claimed minutes are summed from `attendance_day` rather than stated, and why claim status is never written back onto a day
- [x] 1.2 Add the weekly-ceiling setting to `company` in the DBML, noting that the statutory figure differs between the jurisdictions this platform serves and so cannot be a constant
- [x] 1.3 Add the relationship lines for `overtime_claim.company_id`, `.document_id`, `.employee_id`

## 2. Entity and Migration

- [x] 2.1 Add the `OvertimeClaim` entity: company, document (one-to-one, unique), employee, `fromDate`/`toDate` (`columnType: 'date'`), and the three summed minute columns
- [x] 2.2 Index `(company, employee, fromDate)` — the overlap check's query — and declare `[OptionalProps]` for the defaulted columns
- [x] 2.3 Add `company.overtimeWeeklyLimitMinutes` (default 2160, i.e. 36 hours) with a comment that it is configuration because Lao and Thai law differ
- [x] 2.4 Write the migration: the table, its unique `document_id`, the index, foreign keys, a `to_date >= from_date` check, and the `company` column. Verify forward and back on a scratch database, then apply to dev
- [x] 2.5 Run `schema:update --dump` and confirm no drift beyond hand-written check constraints
- [x] 2.6 Register the entity in `AttendanceModule` and confirm the test ORM picks it up

## 3. Claimable Hours

- [x] 3.1 Implement `claimableFor(employeeId, from, to)` on the attendance day service: sum `ot_normal_minutes`, `holiday_work_minutes` and `ot_holiday_minutes` across the range, kept SEPARATE — never totalled, because the kinds are compensated differently and a total cannot be un-split
- [x] 3.2 Implement `isClaimed(employeeId, dateRange)` by relating days to `overtime_claim`, and add NOTHING to `attendance_day` — the projection must stay reproducible from the ledger and configuration alone
- [x] 3.3 Reject a claim whose summed minutes are zero across all three kinds

## 4. Overlap Guard

- [x] 4.1 Implement the overlap check: reject a claim whose range meets an existing claim for that employee whose document is not REJECTED or CANCELLED
- [x] 4.2 Include SUBMITTED and IN_APPROVAL claims in the guard — a claim in flight must block, or two approvers decide about the same hours independently
- [x] 4.3 Take the employee row under `LockMode.PESSIMISTIC_WRITE` inside the write transaction, the same pattern the previous three slices needed for read-then-write
- [x] 4.4 Write the concurrency test FIRST and make it fail without the lock, as the earlier slices' overlap tests did

## 5. Weekly Ceiling

- [x] 5.1 Implement an ISO-week helper that returns the Monday-to-Sunday range containing a date, and unit-test it across a year boundary where ISO week 1 begins in the previous December
- [x] 5.2 Implement the ceiling check: for each ISO week the claim touches, sum all three overtime columns across that week's `attendance_day` rows for the employee and compare against the company setting
- [x] 5.3 Count RECORDED attendance, not claimed hours — leaving hours unclaimed must not evade the limit
- [x] 5.4 Check EVERY week a claim touches, not just the first; a claim crossing a boundary must satisfy both
- [x] 5.5 Make the refusal name the week and the recorded total, since a modest claim can be refused because of hours elsewhere in the same week and that is otherwise baffling

## 6. Submit Endpoint

- [x] 6.1 Seed/configure the overtime document type with `derives_quantity` true, so generic submit refuses it — reusing the seam leave established rather than inventing another
- [x] 6.2 Implement `POST /overtime-claims/:documentId/submit`: re-sum the days, enforce the ceiling, reserve any configured `OT_HOURS` quota from the summed hours, then delegate with `{ quantityAlreadyDerived: true }`
- [x] 6.3 Make the claim work when NO `OT_HOURS` quota exists — the statutory ceiling is what binds, and an OT quota is a company's optional own budget
- [x] 6.4 Confirm nothing in this slice registers an approval listener: approving overtime changes no day, unlike leave

## 7. Permissions, DTOs, Controller

- [x] 7.1 Add `OT_CLAIM_MANAGE` to the attendance permission codes, for certifying on another's behalf and configuring the ceiling
- [x] 7.2 Create the claim DTOs (create with employee + range; a preview that returns the claimable hours without committing)
- [x] 7.3 Create `overtime-claim.controller.ts`: create, preview, submit, read by document — each gated by the code for what it actually does, with `ParseUUIDPipe` on UUID params
- [x] 7.4 Extend `attendance-permissions.spec.ts` to enumerate the new routes, so one added without a decorator fails

## 8. Tests

- [x] 8.1 Summation tests: three kinds summed separately; a mixed range keeps them apart; a zero-overtime range is rejected
- [x] 8.2 Derivation tests: recomputing a claimed day leaves the claim untouched and writes no reference onto the day
- [x] 8.3 Overlap tests: approved blocks; pending blocks; rejected releases; adjacent non-overlapping ranges both succeed
- [x] 8.4 Concurrency test: two concurrent claims over the same day store at most one, and it fails without the pessimistic lock
- [x] 8.5 ISO-week unit tests including the year boundary where week 1 starts in December
- [x] 8.6 Ceiling tests: under passes; over refuses with nothing reserved; unclaimed hours still count; a claim crossing a week boundary is checked against both; the message names the week
- [x] 8.7 Submit tests: generic submit refuses the type; the reserved quantity is the summed one; a company with no OT quota can still claim
- [x] 8.8 Permission tests for every new route
- [ ] 8.9 Run the full backend suite as a SINGLE run (concurrent vitest runs share the test database and produce false failures) and diff typecheck errors against committed `HEAD`

## 9. Seed and Verification

- [x] 9.1 Seed an overtime document type with `derives_quantity` true and `requires_quota` false, and set the demo company's weekly ceiling
- [ ] 9.2 Verify against the dev database that a claim over a day with recorded overtime sums the right minutes by kind, and that the generic submit endpoint refuses the document
- [x] 9.3 Confirm the DBML, the migration and the entity agree on every column of `overtime_claim`
- [x] 9.4 Confirm no `attendance_day` column was added and no claim reference was written onto one
- [ ] 9.5 Re-run `openspec validate attendance-ot`
