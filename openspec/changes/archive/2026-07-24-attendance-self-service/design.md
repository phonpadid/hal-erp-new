## Context

The frontend is a mature Vue 3 + PrimeVue 4 application with 23 Pinia stores, ~40 views enumerated in a smoke suite, a shared Zod package that both sides genuinely import from, and two repo-wide guards that fail a build on an untranslated key or a literal string in a template. It has a settled shape: `PageHeader` → `PageToolbar` → `card` → `AppDataTable`, options-style stores exposing `loading`/`error`/`total`/`page`/`limit`, api modules exporting a plain object of arrow functions, and errors surfacing as toasts for writes and an inline `ErrorState` for reads.

Attendance has none of it. Seven backend slices, zero frontend files. Every proof so far has been a `vitest` run or a console line from a dev-database verification spec.

Two constraints pull against the settled shape:

- **The punch screen is used standing at a gate, on a phone.** `AppDataTable` fixes `scrollHeight: 400px` and forces `white-space: nowrap` to trigger horizontal scrolling; the layout's only breakpoint is `window.innerWidth > 991`. Nothing here was built for a thumb.
- **Nothing in this codebase has ever asked for a device permission.** There is no `useGeolocation`, no permission-denied state, no timeout handling. `navigator.geolocation` fails in ways no HTTP call does: the user can refuse, the browser can hang, and an insecure origin removes the API entirely.

## Goals / Non-Goals

**Goals:**

- An employee holding only the self-service codes can punch, see their own days, and raise leave and correction requests — end to end, in a browser.
- Coordinates reach the server as decimal strings, and a refused or unavailable location degrades to a punch without one rather than to a failure.
- Client and server validate against the same schema, not two copies of the same rules.
- The two permission gaps are closed, so "see my own attendance" stops implying "see everyone's".
- Everything that exists in the codebase already gets reused: `AppDataTable`, `EmptyState`, `ErrorState`, `useFeedback`, `formatAmount`, the `can` directive, `mountView`.

**Non-Goals:**

- HR operations and HR configuration screens. Two later slices, deliberately: they have a different audience, a different density, and none of the mobile constraints.
- Offline punching, background sync, PWA, service workers, push notifications.
- Native app packaging or device fingerprinting. `deviceId` stays whatever the client chooses to send.
- Changing `AppDataTable` or the layout shell for everyone. The mobile-first shell is local to the punch screen.

## Decisions

### 1. `ATTEND_DAY_SELF`, not a scope check on `ATTEND_DAY_READ`

`GET /attendance/days/me` and `GET /attendance/days` are both gated on `ATTEND_DAY_READ` today. Granting an employee the first grants them the second, and the second lists every employee in the company.

The capture slice already solved this exact problem and its permission spec says so out loud: `ATTEND_PUNCH_SELF` punches as yourself, `ATTEND_PUNCH_READ` sees other people's, `ATTEND_PUNCH_MANAGE` punches on their behalf, and a test asserts the self routes never require the stronger codes. The daily slice inherited none of that because it had no self-service caller to reveal the gap. Adding `ATTEND_DAY_SELF` makes the two capabilities consistent, and the existing permission-enumeration test extends to cover it for free.

*Alternative rejected:* keep one code and filter by scope. Scope answers "which rows", not "which power" — a caller with `ATTEND_DAY_READ` and COMPANY scope is *supposed* to see everyone, so scope cannot express "this person may only ever see themselves". Codes are the mechanism invariant 5 names, and this is what it is for.

**This is breaking.** A role granted `ATTEND_DAY_READ` purely so its holders could see their own days must be re-granted `ATTEND_DAY_SELF`. The seed does the re-grant for the demo, and the proposal marks it.

### 2. Correctable punches: a `/me` route beside the general one

`GET /time-corrections/correctable?employeeId=…` is gated on `ATTEND_PUNCH_READ`. An employee with only `ATTEND_PUNCH_SELF` cannot call it, so they cannot see which of their own punches to name — and would have to describe one by time, which is exactly what the correction slice built this endpoint to prevent ("a correction that says 'the 08:02 one' is a correction that can name the wrong row").

**Corrected during implementation.** This decision originally said one route accepting either code, with the service deciding by whose id was in the query. That is not expressible: `PermissionsGuard` computes `required.every((code) => granted.has(code))`, so `@RequirePermissions(A, B)` means A **and** B. Making it work would have needed a new `@RequireAnyPermission` primitive — a new authorization shape, introduced to serve one route.

So instead: `GET /time-corrections/correctable/me?shiftDate=` gated on `ATTEND_PUNCH_SELF`, resolving the employee from the caller's account; and the existing `GET /time-corrections/correctable?employeeId=&shiftDate=` left on `ATTEND_PUNCH_READ`. Both call the same service method.

This is not a compromise — it is the pattern this module already uses twice. `attendance/events/me` sits beside `attendance/events`, and `attendance/days/me` beside `attendance/days`, each pair split on exactly this distinction. A third pair of the same shape is one an author of the other two would recognise; a new decorator would not be.

The duplicated line is a route handler that resolves the caller's employee and delegates. The original objection — "duplicates a query for the sake of a decorator" — was weighing that line against a decorator that turned out not to exist.

### 3. Location is best-effort, and its absence is recorded rather than hidden

`navigator.geolocation` has four outcomes the UI must distinguish: granted, refused, timed out, and unavailable (an insecure origin removes the API). A punch must still be possible in the last three — refusing to record attendance because a browser refused a permission would lose the observation, which is the opposite of what the capture slice decided when it stored punches for exempt employees to guard against data loss.

So: `useGeolocation` resolves to `{ status, latitude?, longitude?, accuracy? }` and never rejects. The punch screen shows the status plainly, sends the coordinates when it has them, and sends the punch without them otherwise. The server already handles this — `geofence_status` becomes `UNKNOWN` when there are no coordinates, and the geofence check is a `SOFT_WARNING` policy on the work location rather than a block.

The user is told which of the four happened. "Location unavailable" and "you denied location" lead to different actions, and collapsing them into one message makes the second one unfixable.

Coordinates are converted with `toFixed(6)` to **decimal strings** before they leave the composable, matching `decimal(9,6)` in the schema and the rule that a coordinate is no more a JS number than money is. A `Number` carrying `13.756331` is fine today and is a rounding argument waiting to happen.

### 4. Shared schemas, and three DTOs move to `ZodValidationPipe`

CLAUDE.md: *"One Zod schema per form, mirroring the backend DTO. Client and server validation must not drift — prefer a shared schema package as the single source of truth."*

The three payloads these forms post — a self punch, a leave request, a correction request — get schemas in `shared/src/index.ts`, and the corresponding backend DTOs move to the `ZodValidationPipe` that already exists and is already used by four other modules. Writing the frontend copy while leaving class-validator in place would create precisely the drift the rule forbids, and a "parity test" comparing two validation frameworks tests the test more than the code.

The interesting rule to express is the punch's both-or-neither coordinate pair, which is a `.refine` rather than a field rule — and having it in one place means the form can surface it as a field error instead of waiting for a 400.

*Risk accepted:* the swap changes error message shapes. Three DTOs, and the backend permission and capture specs assert on some messages. The fallback, if it proves invasive, is documented duplication plus a test asserting the two agree on required fields — recorded here so the decision is not re-litigated silently.

### 5. The punch screen departs from the desktop shell; nothing else does

Only `MyAttendanceView` is mobile-first: a large check-in/check-out control, the location status, and today's punches as a simple vertical list — no `AppDataTable`, whose fixed 400px scroll height and `nowrap` cells exist to make wide financial tables usable on a desktop and do the opposite on a phone.

The other three views are ordinary pages and use the existing shell exactly. Introducing a second layout language for screens that do not need one would double the surface every future change has to touch.

*Alternative rejected:* make `AppDataTable` responsive. It is used by ~40 views; changing its behaviour to suit one new screen is the highest-risk way to get the smallest benefit in this proposal.

### 6. Leave preview before submit, because the range is not the charge

`GET /leave-requests/preview` exists because leave charges **working days**: Monday to Friday across a public holiday costs four days, not five, and a range landing entirely on days nobody works costs nothing. The form calls preview whenever the dates or halves change and shows the figure next to the submit button.

Without it the employee learns the charge after the document is created and submitted — at which point the quota is already reserved, and undoing it means withdrawing a document. Showing the number first is not a nicety; it is the difference between choosing and discovering.

### 7. The store owns the reload; the view owns the toast

The established division, asserted by an existing test (*"the view must not fire a second one itself"*): a write action refreshes what it invalidated and returns `boolean`; the view decides whether to toast and close.

For attendance that means `punch()` refreshes today's events itself, and `MyAttendanceView` only reports the outcome. It matters more here than elsewhere because a punch is a button somebody presses twice when they are unsure it worked — the dedupe window on the server absorbs the second press, and the view must show the first one landing.

### 8. Documents first, then details, then submit

Leave and correction are both documents. The flow is: create a document of the right type → attach the leave or correction row → submit through the capability's own endpoint (leave and overtime carry `derives_quantity`, so the generic submit refuses them).

The store orchestrates all three steps and returns `boolean`; the view sees one action. Exposing the intermediate document id to the user would leak a mechanism they have no use for, and leaving a created-but-undetailed document behind on a failure is the kind of debris that makes a demo database confusing. On a failure after the document exists, the store reports the step that failed rather than pretending nothing happened.

## Risks / Trade-offs

**Geolocation is untestable in jsdom.** → `useGeolocation` is a thin, pure-ish wrapper whose only impure act is one `navigator.geolocation.getCurrentPosition` call; tests stub `navigator.geolocation` with a fake resolving each of the four outcomes. The screen consumes a plain object, so its tests never touch the browser API.

**`no-literal-text.spec.ts` and `i18n.parity.spec.ts` fail the build on any slip.** → Every string in all three locales (`en`, `la`, `zh`) is written as part of the view task, not afterwards. `la` is the default locale, so component tests asserting visible text compare against the `la` catalog, as the existing view specs do.

**PrimeVue `Dialog` teleports to `document.body` in jsdom.** → The existing view specs already encode the workaround: query `document.querySelector('.p-dialog input')`, dispatch raw `input`/`blur`, dispatch `submit` on the `<form>` (a click does not drive `@primevue/forms` in jsdom), and clean up `document.body.innerHTML` in `afterEach`. Followed, not rediscovered.

**Moving three DTOs to Zod could break backend tests.** → Contained to three payloads, and the full backend suite runs before anything is committed. Fallback recorded in decision 4.

**`ATTEND_DAY_SELF` is breaking for existing grants.** → The seed re-grants it, the change is called out in the proposal, and the permission spec enumerates it so nothing regresses quietly. Anyone whose role held `ATTEND_DAY_READ` keeps working — they simply also keep the wider power they already had.

**A punch with no coordinates looks like a punch someone hid from.** → It is recorded as `geofence_status: UNKNOWN`, which is what it is, and the screen tells the user their location was not attached. The honest failure is visible; a fabricated coordinate would not be.

## Migration Plan

No database change, no migration, no new table. The backend edits are three permission decisions and three DTO validators.

`shared/` must be rebuilt (`pnpm build`) after the schemas are added, or the backend will not see them — the frontend reads the TypeScript source through a Vite alias and the backend reads the CommonJS build, so the two can disagree until it is built. That asymmetry has bitten before and is worth stating rather than remembering.

Rollback is removing the frontend files and reverting the three backend gates; nothing persistent is created by this slice.

## Open Questions

- **Should the punch screen show the geofence verdict before punching?** It would let someone standing outside the fence know before pressing. It also needs the work-location list and a distance calculation on the client, duplicating `geo.ts`. Left out: the server already records the verdict, and a client that computes its own would eventually disagree with it.
- **Should "my days" be a calendar rather than a table?** A calendar reads better for a month of attendance and is a much larger component. Started as a table, which the existing shell gives for free; revisit once somebody has used it.
