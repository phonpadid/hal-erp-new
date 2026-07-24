## 1. Canonical Model

- [x] 1.1 Add `time_correction` to `erp_approval_system.dbml` under section 8, with notes on why a correction requests a change to the LEDGER rather than setting a value on the derived day, and why a removal is a supersession rather than a delete
- [x] 1.2 Add the `correction_kind` enum (`ADD` / `CHANGE` / `REMOVE`) to the DBML enum block
- [x] 1.3 Add `company.correction_window_days` with a note that it is per-company policy, measured from the shift day being corrected, and that its real purpose arrives with period close
- [x] 1.4 Add the relationship lines for `time_correction.company_id`, `.document_id`, `.employee_id`, `.target_event_id`

## 2. Entity and Migration

- [x] 2.1 Add `CorrectionKind` to `back/src/common/enums/index.ts`
- [x] 2.2 Add the `TimeCorrection` entity: company, document (one-to-one unique), employee, `shiftDate` (`columnType: 'date'`), kind, nullable `targetEvent`, nullable `requestedAt` (`timestamptz`), nullable `requestedDirection`, `reason`
- [x] 2.3 Add `company.correctionWindowDays` (default 30) and add it to `Company`'s `[OptionalProps]`
- [x] 2.4 Write the migration: the table, unique `document_id`, foreign keys, a check constraint tying `kind` to which columns must be present (CHANGE/REMOVE need a target; ADD/CHANGE need a requested instant), and the company column. Verify forward and back on a scratch database, then apply to dev
- [x] 2.5 Run `schema:update --dump` and confirm no drift beyond hand-written check constraints
- [x] 2.6 Register the entity in `AttendanceModule` and confirm the test ORM picks it up
- [x] 2.7 Confirm the migration adds NO column to `attendance_event` — `corrects_event_id` has existed since the capture slice and this slice finally writes it

## 3. Supersession In The Daily Computation

- [x] 3.1 Extend `computeDay`'s punch input so each punch carries whether it is superseded, and exclude superseded punches from the first/last selection BEFORE anything else is derived from them
- [x] 3.2 Exclude a corrective punch that voids without replacing (a `REMOVE`'s row), so neither it nor its target contributes
- [x] 3.3 Compute supersession as "named by any other event", so a chain A→B→C drops both A and B without walking the chain in order
- [x] 3.4 Load the superseded set once per recompute range in `AttendanceDayService`, alongside the holiday set and leave coverage — not per day
- [x] 3.5 Verify by test that a day with no superseded events computes byte-identically to before, since nothing has ever written `corrects_event_id` and every existing day must be unaffected

## 4. Correction Service

- [x] 4.1 Implement `TimeCorrectionService.create`: validate kind against the columns it requires, validate the target belongs to the same employee, enforce the correction window, and store the row
- [x] 4.2 Reject a `CHANGE`/`REMOVE` with no target and an `ADD` with one
- [x] 4.3 Reject a target `attendance_event` belonging to a different employee, and one belonging to a different company
- [x] 4.4 Enforce `company.correctionWindowDays` measured from `shiftDate`, not from the day the request is raised
- [x] 4.5 Implement `findForDocument` and a read of a day's correctable punches, so a requester can pick a target rather than describe it by time

## 5. Approval Writes The Event

- [x] 5.1 Add a listener on `approval.outcome` that, for a document carrying a `time_correction`, inserts the corrective `attendance_event`
- [x] 5.2 Stamp the inserted event `source` MANUAL with `recorded_by` set to the APPROVING user, not the requester — the accountable party for a hand-entered punch is whoever authorised it
- [x] 5.3 Set `corrects_event_id` for `CHANGE` and `REMOVE`; leave it null for `ADD`
- [x] 5.4 Stamp `local_date` from the company clock using the corrective event's own instant, as every other insert path does
- [x] 5.5 Recompute the correction's `shift_date` after the approval has committed, and do NOT roll the approval back when that fails — the same rule leave established
- [x] 5.6 Confirm a draft or in-approval correction inserts nothing

## 6. Permissions, DTOs, Controller

- [x] 6.1 Add `ATTEND_CORRECTION_MANAGE` to the attendance permission codes
- [x] 6.2 Create the correction DTOs (create with kind, shift date, optional target, optional requested instant and direction, reason) with cross-field validation matching the kind rules
- [x] 6.3 Create `time-correction.controller.ts`: create, read by document, list a day's correctable punches, and configure the window — each gated by the code for what it does, with `ParseUUIDPipe` on UUID params
- [x] 6.4 Extend `attendance-permissions.spec.ts` to enumerate the new routes

## 7. Tests

- [x] 7.1 Request-shape tests: ADD/CHANGE/REMOVE each accept their own columns and reject the others'; a cross-employee target is rejected; one correction per document
- [x] 7.2 Window tests: a recent shift day is accepted; an old one is rejected; the window is measured from the shift day
- [x] 7.3 Supersession unit tests on `computeDay`: a superseded punch is skipped; a void drops both rows; a chain A→B→C leaves only C; an uncorrected day is unchanged
- [x] 7.4 Approval tests: a draft inserts nothing; approval inserts a MANUAL event with the approver in `recorded_by` and the target in `corrects_event_id`; the original remains readable; nothing is ever updated or deleted
- [x] 7.5 The headline case: an `INCOMPLETE` day gains its missing check-out through an approved ADD and recomputes to a complete day with worked minutes
- [x] 7.6 Recompute-failure test: the approval and its corrective event stand when the projection throws
- [x] 7.7 Two corrections targeting the same event both supersede it harmlessly, and the day still resolves to one answer
- [x] 7.8 Permission tests for every new route
- [x] 7.9 Run the full backend suite as a SINGLE run — do not start a second vitest process while one is live, because they share the test database and produce false failures — and diff typecheck errors against committed `HEAD`

## 8. Seed and Verification

- [x] 8.1 Seed a correction document type and set the demo company's correction window
- [x] 8.2 Verify against the dev database that approving a correction inserts a MANUAL event naming its target, and that the affected day recomputes
- [x] 8.3 Confirm the DBML, the migration and the entity agree on every column of `time_correction`
- [x] 8.4 Confirm the ledger only ever gained rows: no `attendance_event` was updated or deleted by any path in this slice
- [x] 8.5 Re-run `openspec validate attendance-correction`
