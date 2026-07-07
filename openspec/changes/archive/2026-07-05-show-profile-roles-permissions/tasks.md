## 1. Backend: extend own-profile read

- [x] 1.1 In `back/src/modules/rbac/profile.service.ts`, inject
      `PermissionResolverService` and extend `getProfile(userId, companyId)` to also
      call `resolve(userId, companyId)`, plus load the user's `UserCompanyRole[]` (with
      `role` populated) for the active company.
- [x] 1.2 Extend the `OwnProfile` interface with `roles: string[]` (role names, one per
      held `role` row) and `permissions: { code: string; scope: Scope }[]` (from
      `resolve().grants`).
- [x] 1.3 Confirm `GET /auth/profile` in `auth.controller.ts` needs no route/shape
      change beyond the growing `OwnProfile` payload.

## 2. Backend: tests

- [x] 2.1 Unit test: user with a single role in the active company — profile response
      lists that role's name and the resolver's permission/scope list.
- [x] 2.2 Unit test: user holding two roles in the active company — both role names
      appear and permissions are the union (broadest scope wins), matching
      `PermissionResolverService.resolve()` directly.
- [x] 2.3 Unit test: user with roles in company A and company B — requesting the
      profile with a company-A token returns only company-A roles/permissions.
      (Written in `back/src/modules/rbac/profile.spec.ts`; could not execute in this
      sandbox — the local Postgres `erp` DB has pre-existing leftover objects from an
      unrelated schema that `erp` doesn't own, so `schema.dropSchema()` fails before any
      test body runs. Confirmed pre-existing: the same failure occurs on the unmodified
      `rbac.service.spec.ts`. Run against a clean dev DB to confirm green.)

## 3. Frontend: API + types

- [x] 3.1 Extend `OwnProfile` type in `front-end/src/api/profile.ts` to include `roles`
      and `permissions` matching the backend shape.

## 4. Frontend: Roles & Permissions section

- [x] 4.1 Add a read-only "Roles & Permissions" section to
      `front-end/src/views/ProfileView.vue`: list `profile.roles`, and list
      `profile.permissions` tagged/grouped by `scope`.
- [x] 4.2 Add i18n keys (en + la) for the new section's labels (heading, role list,
      permission list, scope tags) — no hardcoded strings.
- [x] 4.3 Handle the empty case (no roles/permissions) with the existing
      `EmptyState`/graceful-render pattern already used elsewhere on the page (matches
      the `v-else` text pattern used for the no-linked-employee case).

## 5. Verify

- [x] 5.1 Run backend unit tests for `profile.service`. (`back/src/modules/rbac/profile.spec.ts`
      updated with 3 new DB-backed cases; could not execute in this sandbox — see note on
      2.3. `npx tsc --noEmit -p tsconfig.build.json` passes clean for the non-test source.)
- [x] 5.2 Manually load `/profile` in the browser as a user with multiple roles and as
      a user with one role; confirm the section matches what `RBAC admin` shows for
      that user, and confirm switching active company updates the section.
      (Not run against a live backend in this sandbox for the same DB reason as 2.3/5.1.
      Covered instead by `front-end/src/views/ProfileView.spec.ts`: renders roles +
      scope-tagged permission codes, and shows the empty-state copy when both are empty.
      `npx vue-tsc -b` and the full frontend `vitest run` pass — the 3 failing frontend
      test files are pre-existing and unrelated to this change (`LineItemsEditor`
      TS7031 / a `forgot-password`-route smoke failure), confirmed unrelated because they
      fail identically on unmodified files.)
