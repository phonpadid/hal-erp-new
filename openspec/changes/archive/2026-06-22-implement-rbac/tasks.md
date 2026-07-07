## 1. Dependencies & auth-seam refactor

- [x] 1.1 Add `bcryptjs` + `@types/bcryptjs` to `back/package.json`; install.
- [x] 1.2 Extend `JwtPayload` to `{ sub, companyId, departmentId, grants: { code, scope }[] }` (scope = OWN/DEPARTMENT/COMPANY/GROUP).
- [x] 1.3 Update `JwtStrategy.validate` to return an `AuthUser` exposing `userId`, `companyId`, `departmentId`, `grants`, and derived `permissionCodes: string[]`.
- [x] 1.4 Update `RequestContext`/`RequestContextStore` and `RequestContextMiddleware` to carry `departmentId` + `grants` (keep `permissions()` returning codes).
- [x] 1.5 Update `PermissionsGuard` to read `permissionCodes` from the new `AuthUser`; update `permissions.guard.spec.ts` to the new shape (codes contract unchanged).

## 2. Credentials & resolution services

- [x] 2.1 `PasswordService` (`hash`, `verify`) wrapping bcryptjs with a single cost factor.
- [x] 2.2 `PermissionResolverService.resolve(userId, companyId)`: select active (`valid_from`/`valid_to`) `user_company_role` rows; if none → no access; pick `departmentId`; union role→`role_permission`→`permission` (active only); dedupe codes with broadest-scope-wins (GROUP>COMPANY>DEPARTMENT>OWN). Returns `{ departmentId, grants }`.
- [x] 2.3 `MembershipService.listForUser(userId)`: distinct active companies from `user_company_role` (closes the multi-company deferral).

## 3. Authentication API

- [x] 3.1 `AuthService`: `login(username, password)` → verify hash + `status = ACTIVE`; resolve companies; issue context token for the `is_default`/sole company else none. `switchCompany(userId, companyId)` → verify active membership, resolve, re-issue. `me()` from context. Keep token signing via `JwtService`.
- [x] 3.2 `AuthController`: `POST /auth/login`, `POST /auth/switch-company` (`JwtAuthGuard`), `GET /auth/me` (`JwtAuthGuard`); login/switch DTOs validated (reuse a shared `loginSchema` where it fits).

## 4. Data-scope enforcement

- [x] 4.1 `ScopeService`: `scopeFor(code)` (highest granted scope for a code from context), `scopeWhere(code, { ownerField, deptField })` returning the row-level filter fragment (OWN→owner=user, DEPARTMENT→dept=departmentId, COMPANY/GROUP→`{}`), and `isGroup(code)` so callers can opt into `forGroupRead()`. Applied after the company filter.

## 5. Admin surface & resignation

- [x] 5.1 `RoleAdminService` + endpoints (guarded by `RBAC_MANAGE`): create role; attach a permission to a role with a scope; assign a user a role in a company with optional `valid_from`/`valid_to` and `is_default`.
- [x] 5.2 `revokeCompanyAccess(userId, companyId)`: set `valid_to = today` on that company's `user_company_role` rows only; expose as an `RBAC_MANAGE` endpoint. Add `RBAC_MANAGE` to the permission-code constants.

## 6. Module wiring

- [x] 6.1 `RbacModule` (forFeature the rbac entities; provide the services + `AuthController`; export `PermissionResolverService`, `ScopeService`, `MembershipService`); register in `AppModule`. Point `multi-company` company listing at `MembershipService` for the authenticated caller.

## 7. Tests

- [x] 7.1 Credentials: correct password + ACTIVE → authenticates; wrong password → rejected; non-ACTIVE status → rejected.
- [x] 7.2 Login/selection: default membership → token issued for it; no default → companies listed, no token; switch to a non-member company → rejected; switch to a member company → new token with that company's grants.
- [x] 7.3 Resolution: union across two roles; same code at DEPARTMENT + COMPANY → resolves to COMPANY once; inactive `permission` excluded; expired (`valid_to` past) assignment contributes nothing.
- [x] 7.4 Scope: `scopeWhere` yields owner filter for OWN, department filter for DEPARTMENT, empty for COMPANY; `isGroup` true only for GROUP.
- [x] 7.5 Resignation: revoke company A expires only A's memberships; user still resolves access to company B.
- [x] 7.6 Permission-code authz still holds: `PermissionsGuard` allows a present code, denies a missing one (updated spec).

## 8. Verify

- [x] 8.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 8.2 Run `openspec validate implement-rbac --strict`.
