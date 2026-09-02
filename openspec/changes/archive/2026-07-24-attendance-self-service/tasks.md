## 1. Backend: The Two Permission Gaps

- [x] 1.1 Add `ATTEND_DAY_SELF` to `back/src/modules/attendance/permissions.ts`, with a comment saying why it exists separately — seeing your own attendance must not require the power to see everyone's, the same split `ATTEND_PUNCH_SELF` already draws
- [x] 1.2 Re-gate `GET /attendance/days/me` on `ATTEND_DAY_SELF`, leaving `GET /attendance/days` on `ATTEND_DAY_READ`
- [x] 1.3 Confirm `listOwn` ignores any employee identifier in the query and resolves the employee from the account, and add a test that passing someone else's id changes nothing
- [x] 1.4 Re-gate `GET /time-corrections/correctable` to accept `ATTEND_PUNCH_SELF` OR `ATTEND_PUNCH_READ`, and enforce in the service that a SELF-only caller may only ask about their own employee record
- [x] 1.5 Extend `attendance-permissions.spec.ts` for both routes, including that `ATTEND_DAY_SELF` alone does not open the general list
- [x] 1.6 Grant the seeded employee role `ATTEND_PUNCH_SELF`, `ATTEND_DAY_SELF`, `DOC_CREATE`, `DOC_SUBMIT` and `DOC_VIEW`, so the demo has somebody who can actually punch
- [x] 1.7 Run the backend suite and confirm nothing that held `ATTEND_DAY_READ` regressed

## 2. Shared Schemas

- [x] 2.1 Add `punchSelfSchema` to `shared/src/index.ts`: optional source, optional latitude/longitude as decimal STRINGS with a both-or-neither refinement, optional deviceId and remark
- [x] 2.2 Add `leaveRequestCreateSchema`: documentId, quotaId, from/to dates, from/to halves, with the reversed-range rule
- [x] 2.3 Add `timeCorrectionCreateSchema`: kind, shiftDate, conditional targetEventId / requestedAt / requestedDirection matching the kind rules, and a required reason
- [x] 2.4 Export the inferred types alongside each schema, following the existing `<name>Schema` / `<Name>Input` convention
- [x] 2.5 Run `pnpm build` in `shared/` — the frontend reads the TS source through a Vite alias and the backend reads the CommonJS build, so they disagree until it is built
- [x] 2.6 Move `PunchSelfDto`, the leave create DTO and the correction create DTO to `ZodValidationPipe` against these schemas
- [x] 2.7 Run the backend suite and check which asserted error messages changed; if the swap proves invasive, fall back to documented duplication plus a parity test, as design decision 4 records

## 3. Geolocation Composable

- [x] 3.1 Create `front-end/src/composables/useGeolocation.ts` resolving `{ status, latitude?, longitude?, accuracy? }` where status is granted / denied / timeout / unavailable — and NEVER rejecting, because a refused permission must not stop a punch
- [x] 3.2 Convert coordinates with `toFixed(6)` to decimal strings inside the composable, so no JS number carrying a coordinate ever escapes it
- [x] 3.3 Detect an absent `navigator.geolocation` and report `unavailable` rather than `denied` — the two lead to different actions and collapsing them makes one unfixable
- [x] 3.4 Apply a timeout so a hanging permission prompt does not leave the punch button waiting forever
- [x] 3.5 Unit-test all four outcomes with a stubbed `navigator.geolocation`

## 4. API Layer

- [x] 4.1 Create `front-end/src/api/attendance.ts` exporting `attendanceSelfApi` as a plain object of arrow functions, matching the shape of `quotas.ts`
- [x] 4.2 Methods: `checkIn`, `checkOut`, `myEvents(date)`, `myDays(filters)` — each unwrapping `.then(r => r.data)`
- [x] 4.3 Add `leaveSelfApi`: `preview(params)`, `create(dto)`, `submit(documentId)`
- [x] 4.4 Add `correctionSelfApi`: `correctable(employeeId, shiftDate)`, `create(dto)`
- [x] 4.5 Declare the response interfaces in the api module, colocated above the object, as the other modules do
- [x] 4.6 Api tests mocking `./client` and asserting the exact params object, following `api/documents.spec.ts`

## 5. Store

- [x] 5.1 Create `front-end/src/stores/attendance.ts` as an OPTIONS-style store with a named state interface — every store in this codebase is options-style and the one setup-style store is the layout shell
- [x] 5.2 State: today's events, my days with the `total` / `page` / `limit` triple, `loading`, `error` as an empty string, and the location status
- [x] 5.3 `loadToday()` and `loadMyDays(page?, limit?)` following the load-action shape: set loading, clear error, try/catch through `messageOf`, finally clear loading
- [x] 5.4 `punch(direction)` obtains the location, posts, and REFRESHES today's events itself, returning `boolean` — the store owns the reload, the view owns the toast
- [x] 5.5 `requestLeave(values)` orchestrating create-document → attach → submit, returning `boolean` and reporting which step failed
- [x] 5.6 `requestCorrection(values)` orchestrating the same three steps
- [x] 5.7 `previewLeave(values)` for the charge preview, swallowing failures the way optional-context loads already do
- [x] 5.8 Store tests mocking the api module with `vi.mock`, driving a real Pinia, following `stores/quota.spec.ts`

## 6. Views

- [x] 6.1 `views/attendance/MyAttendanceView.vue` — the punch screen. Mobile-first: no `AppDataTable`, the primary control reachable without scrolling, today's punches as a vertical list
- [x] 6.2 Show which way the employee is currently facing, derived from the last punch of the day
- [x] 6.3 Show the location status in words, distinguishing all four outcomes, and punch regardless
- [x] 6.4 `views/attendance/MyDaysView.vue` — the ordinary desktop shell: `PageHeader`, `card`, `AppDataTable`, `EmptyState` in the `#empty` slot, `ErrorState` for a failed load
- [x] 6.5 Show late minutes and late occurrences as two columns, and overtime by kind — never a single total, for the reason the projection has kept them apart since the daily slice
- [x] 6.6 Offer no control on my days that writes to a day
- [x] 6.7 `views/attendance/RequestLeaveView.vue` using `<Form :resolver="zodResolver(leaveRequestCreateSchema)">` with `<FormField v-slot="$f">`, no `v-model` on the inputs
- [x] 6.8 Preview the charged days whenever the dates or halves change, shown beside the submit button
- [x] 6.9 `views/attendance/RequestCorrectionView.vue` where CHANGE and REMOVE list the day's correctable punches and require selecting one, and ADD asks for a time and offers no target
- [x] 6.10 Feedback: `fb.success` / `fb.error` toasts for writes, inline `ErrorState` for failed reads — the rule the feedback composable states in its own docblock
- [x] 6.11 Gate controls with `auth.can(...)` computeds, remembering the client gate is UX only

## 7. Routing, Navigation, i18n

- [x] 7.1 Add the four lazy component consts and routes to `router/routes.ts` with `meta.permission` — the singular field holding ONE code
- [x] 7.2 Gate the punch screen on `ATTEND_PUNCH_SELF`, my days on `ATTEND_DAY_SELF`, and both request forms on `DOC_CREATE`
- [x] 7.3 Add breadcrumbs referencing the nav key, following the existing `{ nav: '<key>' }` shape
- [x] 7.4 Add a `NAV` entry in `layouts/store/layout.store.ts` with its icon, `to`, `permission` and section
- [x] 7.5 Create `i18n/locales/en/attendance.ts` nested by screen then by role, following the `quota.ts` key style
- [x] 7.6 Create the `la` and `zh` catalogues with the SAME key set — `la` is the default locale, and the parity spec fails on a key missing from any locale
- [x] 7.7 Register the namespace in all three `locales/*/index.ts`
- [x] 7.8 Add `nav.attendance*` keys in all three locales

## 8. Tests

- [x] 8.1 Guard test: a user without `ATTEND_PUNCH_SELF` is redirected away from the punch screen
- [x] 8.2 Guard test: `ATTEND_PUNCH_SELF` alone reaches the punch screen and not my days
- [x] 8.3 Punch-screen component test via `mountView` with `permissions: ['ATTEND_PUNCH_SELF']`: pressing check in calls the store action once, and the view fires no second read of its own
- [x] 8.4 Punch-screen test for each location outcome, including that a denied permission still punches and says so
- [x] 8.5 My-days test: the two lateness figures are both rendered, and no control writes to a day
- [x] 8.6 Leave-form test: the preview refreshes when the dates change, and the charge is shown before submit
- [x] 8.7 Leave-form validation test against the shared schema alone, following `views/budgets/budget-forms.spec.ts`
- [x] 8.8 Correction-form test: CHANGE requires selecting a punch, ADD offers none, REMOVE asks for no time
- [x] 8.9 Dialog-in-jsdom handling where a form lives in a dialog: query `document.querySelector`, dispatch raw `input`/`blur`, dispatch `submit` on the form, clean `document.body.innerHTML` in `afterEach`
- [x] 8.10 Add all four views to `test/smoke/views.smoke.spec.ts`
- [x] 8.11 Assert visible text against the `la` catalogue, since `la` is the default locale
- [x] 8.12 Run `pnpm ci` in `front-end/` — `vue-tsc -b && vitest run` — and confirm the i18n parity and no-literal-text guards both pass
- [x] 8.13 Run the full backend suite as a SINGLE run — do not start a second vitest process while one is live, because they share the test database and produce false failures

## 9. Verification

- [x] 9.1 Against the dev database, log in as the seeded employee and confirm the punch screen loads with only the self-service codes
- [x] 9.2 Record a real check-in and check-out from the browser and confirm the rows land in `attendance_event` with the coordinates as decimals
- [x] 9.3 Recompute that day and confirm my days reports it, so the whole loop from a button to the projection is visible in the dev data
- [x] 9.4 Raise a leave request through the form and confirm the previewed charge equals what `leave_request.total_days` records
- [x] 9.5 Raise a correction through the form by SELECTING a punch, and confirm `time_correction.target_event_id` names the row that was picked
- [x] 9.6 Confirm a user holding `ATTEND_DAY_SELF` alone is refused by `GET /attendance/days`
- [x] 9.7 Re-run `openspec validate` for the change and for every spec it touches
