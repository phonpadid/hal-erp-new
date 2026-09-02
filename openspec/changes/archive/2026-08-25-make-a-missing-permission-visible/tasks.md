## 1. Prove the gap before closing it

- [x] 1.1 Add a DB-backed spec asserting `missingPermissionCodes` over a catalog seeded short by
      one code returns exactly that code — the behaviour everything below leans on. Confirm it
      fails if the comparison is inverted.
- [x] 1.2 Record the measured drift on this installation in the change notes: 75 declared, 63
      present, the 12 absent codes. It is the evidence the report is worth emitting.

## 2. The application reports a short catalog at startup

- [x] 2.1 Add a startup check that reads `permission`, calls `declaredPermissionCodes()` and
      `missingPermissionCodes()` from `back/src/seed/seed-data.ts`, and logs each absent code
      through the Nest `Logger`. Read-only: no `em.transactional()`, no lock, no write.
- [x] 2.2 Wire it into the boot path so it runs once per process start, after the ORM is available
      and before the app listens.
- [x] 2.3 Test: a catalog short of one code logs that code and the application still starts.
- [x] 2.4 Test: a complete catalog emits no report.
- [x] 2.5 Test: startup leaves the `permission` table byte-for-byte unchanged.
- [x] 2.6 Test: the startup report and `permissions:check` name the same set for the same database,
      asserted by calling both against one fixture rather than by comparing two literals.
- [x] 2.7 Confirm the check cannot take the boot down: a failure reading `permission` is logged and
      swallowed, not thrown. A diagnostic that prevents startup is worse than the thing it reports.

## 3. The catalog read says what it cannot offer

- [x] 3.1 Add `GET /rbac/permissions/missing` to `rbac-admin.controller.ts` with
      `@RequirePermissions(P.RBAC_MANAGE)`, returning the declared codes with no row.
- [x] 3.2 Leave `GET /rbac/permissions` untouched — the paginated catalog listing is correct as it
      stands, and absent codes belong to the catalog rather than to a page of it.
- [x] 3.3 Test: with a short catalog the read returns exactly the absent codes.
- [x] 3.4 Test: with a complete catalog it returns none.
- [x] 3.5 Test: a caller without `RBAC_MANAGE` is refused.

## 4. The RBAC screen states it where the fix is

- [x] 4.1 Call the new read from the RBAC admin screen and, when it returns codes, show a notice
      naming them and saying they cannot be granted until the catalog is reconciled.
- [x] 4.2 Do not add a control that runs the reconcile — see design decision 5.
- [x] 4.3 Add the notice's text to the `la`, `en` and `zh` catalogs; keep them key-complete and
      clear of the script and acronym guards.
- [x] 4.4 Test: the notice appears when the read returns codes and is absent when it returns none.

## 5. A refused navigation says what it wanted

- [x] 5.1 Add a `forbidden` route and view that names the permission code the navigation required.
- [x] 5.2 Change `evaluateGuard` (`front-end/src/router/index.ts:32`) to resolve a permission
      failure to that route, carrying the code, instead of returning `'home'`.
- [x] 5.3 Add a catch-all not-found route, so a refusal and an address matching no route stop
      resolving to the same place.
- [x] 5.4 Add the view's text to all three catalogs.
- [x] 5.5 Test: a signed-in user without a route's permission lands on the refusal with the code
      named.
- [x] 5.6 Test: an address matching no route renders the not-found view, not the refusal.
- [x] 5.7 Test: an unauthenticated user still goes to Login, and the company-selection redirect is
      unchanged — the guard's other branches are not touched.
- [x] 5.8 Test: the refusal survives a direct navigation to the address, not only an in-app one.

## 6. Verify

- [x] 6.1 Backend suite green, `nest build` clean.
- [x] 6.2 Frontend suite green with no unhandled rejection, `vue-tsc -b` clean.
- [x] 6.3 Against this installation, open `/new/accounting-periods` as `admin` and confirm the
      refusal names `PERIOD_VIEW`, where the page previously redirected home in silence. Record it
      in the change notes with a screenshot.
- [x] 6.4 Confirm the RBAC screen names all 12 absent codes, and that the startup log named the
      same 12.
- [x] 6.5 Leave the catalog short. Closing it is the customer's act; note in the change notes that
      `permissions:sync` plus a grant decision is what remains, and that neither was performed.
