# Tasks — Offer only the doors you can open

## 1. The question, answered where the router and the store already are

- [x] 1.1 `CreateDocumentView` resolves each routed type's destination and reads the permission that
      route declares (`router.resolve({ name }).meta.permission`), then asks `auth.can(code)`. Read
      from the route, never copied onto the type (D2) — a copy drifts from the guard that enforces
      it.
- [x] 1.2 A route that cannot be resolved counts as reachable (D4). Getting this backwards turns a
      misconfiguration into a lockout, and the wizard already keeps such a type in its own steps.
- [x] 1.3 A type with no `authoring_route` is untouched — no second screen, no second permission.

## 2. The answer, rendered where the cards already are

- [x] 2.1 `DocumentTypePicker` takes a per-card unreachable/reason input beside its existing
      whole-picker `disabled` (edit mode). The picker learns nothing about permissions or routing.
- [x] 2.2 An unreachable card renders disabled and names the permission code it needs.
- [x] 2.3 `select()` refuses an unreachable card, so no path — click, Enter, Space — can choose it.
- [x] 2.4 Keyboard: arrows still move onto an unreachable card and it exposes `aria-disabled`
      (D5 — skipping it would hide the very explanation the card exists to give).
- [x] 2.5 i18n for the disabled reason, three locales. Theme tokens only, no hardcoded colours.

## 3. Tests

- [x] 3.1 A routed type whose permission the user lacks renders disabled, names the code, and cannot
      be selected by click or by keyboard.
- [x] 3.2 The same type with the permission held is selectable and still navigates.
- [x] 3.3 An unresolvable `authoring_route` leaves the card enabled.
- [x] 3.4 A type with no `authoring_route` is enabled regardless of permissions.
- [x] 3.5 The disabled card is focusable and reports `aria-disabled` — the reason must be reachable
      by keyboard and screen reader.
- [x] 3.6 Each new test must fail with its feature removed. Check it.

## 5. The pickers the wizard cannot fill

- [x] 5.1 `GET /warehouses/selectable` — `DOC_CREATE`, `{id, code, name}`, active + company-scoped.
      Declared before `:id` so the literal path is not captured as a param.
- [x] 5.2 `GET /employees/selectable` — `DOC_CREATE`, `{id, empCode, fullName}`, ACTIVE +
      company-scoped. The controller gates at class level; the guard reads
      `getAllAndOverride([handler, class])`, so the handler decorator replaces it (D7).
- [x] 5.3 The wizard reads both instead of the administration lists. Two faults found doing it:
      `EmployeeService` has no `scope` (copied the shape from `WarehouseService` without checking
      its dependencies — the build caught it), and `Employee` is company-filtered so a bare
      `em.fork().find()` throws "No arguments provided for filter 'company'" — needs `FILTER_OFF`
      beside the explicit company clause, as the rest of that file already does.
- [x] 5.4 The administration reads keep `INV_VIEW` / `EMPLOYEE_MANAGE` untouched.

## 6. Tests for the pickers

- [x] 6.1 A caller holding `DOC_CREATE` but not `INV_VIEW` passes the warehouse selection read;
      the same caller is still refused `GET /warehouses`. Runs the real `PermissionsGuard` over the
      real controller rather than asserting the decorator alone.
- [x] 6.2 The same for employees, which is the case D7 actually rests on: the class-level
      `EMPLOYEE_MANAGE` must be *replaced* by the handler's `DOC_CREATE`, not added to it.
- [x] 6.3 Both reads are company-scoped and exclude inactive rows — a resigned employee and another
      company's active one are both absent, and the payload carries selection fields only.
- [x] 6.4 Mutation-checked, six mutations:

      | mutation | result |
      | --- | --- |
      | warehouse read: drop `isActive` | caught |
      | warehouse read: bypass the company filter | caught |
      | employee read: drop `status: 'ACTIVE'` | caught |
      | warehouse handler: `DOC_CREATE` → `INV_VIEW` | caught |
      | employee handler: remove `@RequirePermissions` | caught (2 tests) |
      | guard: `getAllAndOverride` → `getAllAndMerge` | caught |

      One deliberate survivor: dropping the explicit `company: companyId` from the warehouse read
      changes nothing, because `CompanyScopeService.forActiveCompany()` already binds the filter.
      That is the redundancy the service's own class comment calls "belt-and-braces on top of it,
      not a substitute" — so the surviving mutation is the documented design, not a hole. The test
      that matters (bypassing the filter itself) does fail.

## 4. Verification

- [x] 4.1 back 1580 passed / 2 failed — both the known date-dependent ones (attendance correction;
      the journal-voucher delegation built from a UTC date), neither touched here. `tsc -p
      tsconfig.build.json --noEmit` clean (used instead of `nest build`, which wipes `dist/` under
      the running `start:dev` watcher — that mistake took the API down earlier in this work).
      Front-end 830 passed, `vue-tsc -b` clean.
- [x] 4.2 Manual walkthrough, signed in as `requester` (not `admin` — that substitution is what hid
      both halves of this defect in the first place):

      - The type picker shows **Journal Voucher** disabled naming `GL_JV_POST`, and all four budget
        types disabled naming `BUDGET_VIEW`. **Leave Request** stays enabled, as its route needs
        only `DOC_CREATE`. That is exactly the six-row table in the proposal.
      - Clicking the disabled **Budget Plan** card does nothing: no selection, no navigation to
        `budgets`, no bounce to the dashboard. That silent bounce was the reported defect.
      - `GET /warehouses/selectable` and `GET /employees/selectable` both answer **200** for this
        user; no 403 anywhere in the wizard's load. The warehouse picker offers MAIN and SITE, the
        employee picker offers EMP-REQ — both were empty dropdowns before.
      - Carried a promotion through to **PROMOTE-HAL-2026-0003, In approval**, raised by
        `requester` end to end through the employee picker that used to 403.
      - A goods issue reached submit and was refused `Insufficient stock — need 4.0000, available
        0.0000`. That refusal is correct: `stock_balance` is empty in this database, so no goods
        issue can submit until stock is received. The warehouse id did reach the server, which is
        the point this task had to prove. Left as a draft (ISSUE-HAL-2026-0004) rather than
        fabricating a stock row behind the ledger's back.
