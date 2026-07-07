## Context

The scaffold provides the six rbac entities and an auth seam that issues/validates a
JWT of shape `{ sub, companyId, permissions: string[] }`, with `PermissionsGuard`
authorizing on codes from `request.user`. `multi-company` is implemented and deferred
membership-filtered company listing and real permission issuance to this slice. The
rbac spec already requires single-login/multi-company, a company-context token carrying
`department_id` + scoped permissions, permission-code authorization, OWN/DEPARTMENT/
COMPANY/GROUP data scope, time-bounded grants, and per-company resignation.

No schema change — the entities already match the DBML.

## Goals / Non-Goals

**Goals**
- Real authentication (hashed passwords) and company resolution from
  `user_company_role`, honoring `valid_from`/`valid_to` and `is_default`.
- A company-context token carrying `companyId`, `departmentId`, and scoped grants
  `{ code, scope }[]`; switching company re-resolves and re-issues.
- Permission aggregation (union across roles, broadest-scope-wins, active-only).
- A `ScopeService` that turns a permission's scope into a row-level filter applied after
  the company filter; self-tested against a representative scoped entity.
- `revokeCompanyAccess` expiring one company's memberships only.
- Minimal admin endpoints (roles, role-permissions, assignments) so the above is usable
  and testable.
- Close the multi-company deferral: list only the caller's companies.

**Non-Goals**
- Refresh tokens / session revocation lists / password reset / lockout throttling.
- User self-registration or full user CRUD (assignment-focused admin only).
- Wiring scope filters into document/budget queries — those entities/endpoints land in
  later slices; here the `ScopeService` is provided and unit-tested.
- SSO/OAuth, MFA.

## Decisions

### D1 — Extend the JWT to scoped grants + departmentId
`JwtPayload` becomes:
```ts
interface JwtPayload {
  sub: string;
  companyId: string;
  departmentId: string;
  grants: { code: string; scope: 'OWN'|'DEPARTMENT'|'COMPANY'|'GROUP' }[];
}
```
This realizes the rbac spec's *Company Context Token* requirement, superseding the
scaffold's `permissions: string[]` seam. `JwtStrategy.validate` maps it to an `AuthUser`
exposing both `permissionCodes: string[]` (for the guard) and `grants` + `departmentId`
(for scope). `RequestContext`/middleware carry the same. `PermissionsGuard` keeps
checking codes (unchanged contract); its spec is updated to the new `AuthUser` shape.
*Alternative considered:* keep `permissions: string[]` and a parallel `scopes` map —
rejected as two sources that can drift; one `grants` array is the single truth.

### D2 — Login then (auto or explicit) company selection
`POST /auth/login` verifies the hash, loads active memberships, and returns
`{ user, companies[] }`. If exactly one membership is `is_default` (or there is a single
membership), it also returns `accessToken` for that company. Otherwise `accessToken` is
null and the client calls `POST /auth/switch-company { companyId }`. Switch is behind
`JwtAuthGuard` so the caller's `sub` is trusted from their current token; it verifies an
active membership in the target company before re-resolving and re-issuing. This matches
the spec's "enters the default automatically" and "switching re-issues" scenarios.

### D3 — Resolution: active membership + role → permission, broadest scope wins
`PermissionResolverService.resolve(userId, companyId)`:
1. Find `user_company_role` rows for (user, company) where `valid_from <= today` (or
   null) and `valid_to >= today` (or null).
2. If none → the user has no access to that company (login/switch rejects).
3. Pick the membership's `department_id` (the default membership's, else the first).
4. Load `role_permission` + `permission` for those roles; keep `permission.is_active`.
5. Union by code; on scope conflict keep the max of an explicit order
   `OWN(0) < DEPARTMENT(1) < COMPANY(2) < GROUP(3)`.
Returns `{ departmentId, grants }`. "today" is computed once per call (date-only,
compared against the `date` columns).

### D4 — ScopeService builds a row-level WHERE after the company filter
`ScopeService.scopeWhere(code, ctx)` returns a MikroORM filter fragment for the active
grant's scope, parameterized by the consuming entity's field names (passed in), so it is
reusable:
- `OWN` → `{ [ownerField]: ctx.userId }` (e.g. `created_by`)
- `DEPARTMENT` → `{ [deptField]: ctx.departmentId }`
- `COMPANY` → `{}` (company filter already applied)
- `GROUP` → `{}` **and** caller must use a group-read EM (read-only, company filter
  disabled) — `ScopeService` exposes `isGroup(code)` so the data layer can opt into
  `CompanyScopeService.forGroupRead()`.
The company filter (invariant 1) always runs first; scope narrows within it, except
GROUP which is the only read-across-companies path and is read-only. Self-tested against
a representative company-scoped entity with an owner + department column.

### D5 — Passwords hashed with bcryptjs
Use `bcryptjs` (pure JS — no native postinstall, consistent with the swc/esbuild
build-script constraints already in this repo). A small `PasswordService`
(`hash`/`verify`) centralizes cost factor. Seed/admin user creation hashes on write.

### D6 — Resignation = expire memberships, not the account
`revokeCompanyAccess(userId, companyId)` sets `valid_to` to the day **before** today on
that company's `user_company_role` rows (they have no `is_active` column). Resolution
keeps assignments where `valid_to >= today`, so setting it to yesterday excludes them
effective immediately, while the shared `app_user` and other companies are untouched.
(Using `today` would leave access valid through the rest of today; revocation is
intended to be immediate.) Exposed as a service method (HR's resignation post-action
calls it later) and an `RBAC_MANAGE` admin endpoint for now.

### D7 — Membership-filtered company listing (multi-company deferral)
Add `listForUser(userId)` resolving distinct active companies from
`user_company_role`. The `/auth/login` response uses it; `multi-company`'s company list
endpoint delegates to it for non-super users. Kept in rbac to avoid a cross-capability
import cycle: rbac depends on multi-company entities, not vice-versa.

## Risks / Trade-offs

- **Auth seam refactor touches platform-foundation code** (guard, strategy, context). →
  Mitigation: the `PermissionsGuard` *contract* (authorize by code) is unchanged; only
  the `AuthUser` shape grows. Update its unit spec in lockstep; full build + tests gate.
- **Scope not yet enforced on real queries** (no document endpoints). → Mitigation:
  `ScopeService` is delivered and unit-tested now so document/budget slices just call it;
  documented as a non-goal to avoid a false sense of coverage.
- **No lockout/throttling** → acceptable for this slice; note as future hardening. Login
  returns a generic error for both wrong-user and wrong-password (no user enumeration).
- **"today" vs timezone** for `valid_from/valid_to` (date columns) → compare date-only in
  UTC; acceptable until per-company timezone is modeled.

## Migration Plan

No DB migration. Steps: add `bcryptjs`; build `RbacModule` (services, controller, DTOs);
refactor the auth seam to the scoped-grant payload and update its spec; add the
membership-filtered company list to multi-company; register `RbacModule` in `AppModule`;
add tests; `pnpm build` + `pnpm test`. Rollback = revert the module + seam changes (no
data/schema impact). Existing tokens (old shape) become invalid — acceptable pre-release.

## Open Questions

- Should `/auth/login` for a user with multiple non-default memberships pick the first
  deterministically instead of returning no token? Default: return the list, no token
  (explicit selection), per the spec scenario.
- Is `RBAC_MANAGE` itself company-scoped or global? Default: treat as a normal
  per-company permission code resolved like any other; a true super-admin concept can
  come later if needed.
