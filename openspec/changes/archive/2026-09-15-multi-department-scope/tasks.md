## 1. Token carries the department set (rbac)

- [x] 1.1 `PermissionResolverService.resolve` returns `departmentIds` — the de-duplicated
      `department.id` over the same validity-filtered `user_company_role` rows it already loads —
      alongside the existing `departmentId` (`back/src/modules/rbac/permission-resolver.service.ts`)
- [x] 1.2 Add `departmentIds: string[]` to `JwtPayload` and thread it through `AuthService`
      token issue, `RbacAuthService` (login + switch), and the service-account resolution used by
      `ApiKeyService.authenticate` (`back/src/auth/jwt-payload.interface.ts`, `auth.service.ts`,
      `back/src/modules/rbac/rbac-auth.service.ts`)
- [x] 1.3 `RequestContext` gains `departmentIds`; the request-context middleware, `JwtStrategy`
      and `JwtOrApiKeyGuard` populate it. When the claim is absent (token issued before this
      change) fall back to `[departmentId]` (`back/src/common/context/request-context*.ts`,
      `back/src/auth/jwt.strategy.ts`, `back/src/auth/jwt-or-api-key.guard.ts`)
- [x] 1.4 `GET /auth/me` returns `departmentIds` (`back/src/modules/rbac/auth.controller.ts`)
- [x] 1.5 Unit tests in `back/src/modules/rbac/rbac-unit.spec.ts` (or a new
      `permission-resolver.spec.ts`): two assignments → home is the default's department and the
      set has both; an expired assignment contributes neither codes nor a department; one
      assignment → set of one; assignments in another company are excluded

## 2. DEPARTMENT scope reads the set (rbac + document-engine)

- [x] 2.1 `ScopeService.scopeWhere` DEPARTMENT case returns
      `{ [deptField]: { $in: RequestContext.departmentIds() } }`
      (`back/src/modules/rbac/scope.service.ts`)
- [x] 2.2 `DocumentService.visibleWhere` fail-safe: treat a missing or empty `$in` list as
      `MATCHES_NOTHING`, keeping the existing undefined/empty-string check for OWN
      (`back/src/modules/document/document.service.ts`)
- [x] 2.3 Confirm `BudgetService.listSelectable` and `DocumentService.createDraft` /
      `listCreatableTypes` / `formForType` still read the home `departmentId` — no change, add a
      one-line comment at `listSelectable` saying why it is not switched to `scopeWhere`
- [x] 2.4 Extend `back/src/modules/document/document-visibility.spec.ts`: a DEPARTMENT reader
      assigned to X (default) and Y lists documents of X and Y and not Z; a Y document is
      readable by id and a Z document answers not-found; the list and `get` agree; a context with
      an empty set lists nothing and gets not-found
- [x] 2.5 Test in the same file: a second assignment in another company adds nothing to the
      active company's set (company isolation, invariant 1)
- [x] 2.6 `ScopeService` unit test for the `$in` shape and the empty-set case

## 3. Frontend keeps both

- [x] 3.1 Auth store: add `departmentIds: string[]` next to `departmentId`, filled from
      `/auth/me`; default `[]` on logout (`front-end/src/stores/auth.ts`)
- [x] 3.2 Extend `front-end/src/stores/auth.spec.ts` for the new field

## 4. Verify

- [x] 4.1 `pnpm --filter back test` and `pnpm --filter front-end test` green
- [x] 4.2 Against the dev stack: log in as Thipkhounheuane (two HAL assignments, DOC_VIEW at
      DEPARTMENT), open `GET /documents/80aca113-bf10-4869-bf65-0909051a81f3` → 200; log in as a
      single-department user and confirm their list is unchanged
- [x] 4.3 Archive AFTER `document-visibility-by-scope` (design D5)
