## Why

`rbac` is the second capability in the build order and the authority behind every
permission-code check the platform already enforces. The scaffold ships the entities
(`app_user`, `permission`, `role`, `role_permission`, `user_company_role`, `employee`)
and an auth seam (`AuthService.issueToken`, `JwtStrategy`, `PermissionsGuard`) that
currently trusts hand-fed tokens. `multi-company` deliberately deferred two things to
this slice: real permission issuance, and filtering a user's company list by their
memberships. This change makes authorization real: authenticate once, resolve the
companies a user may enter, issue a company-context token carrying that company's
resolved permission codes **and their scopes**, and enforce OWN/DEPARTMENT/COMPANY/GROUP
data scope on top of company isolation.

## What Changes

- **`RbacModule`** registering the rbac entities, wiring auth + resolution services and
  an `AuthController`.
- **Credential authentication**: passwords stored hashed (bcrypt); `POST /auth/login`
  verifies the hash and rejects non-`ACTIVE` `app_user`s. No plaintext, ever.
- **Login & company selection**: login resolves accessible companies from
  `user_company_role` (active, non-expired only); auto-issues a context token for the
  `is_default` company when one exists, otherwise returns the company list for selection.
  `POST /auth/switch-company` re-resolves and re-issues a token for another company the
  user belongs to; `GET /auth/me` returns the current resolved context.
- **Permission resolution**: a `PermissionResolverService` aggregates
  role → `role_permission` → `permission` for the active company, dedupes codes, and on
  conflicting scopes keeps the **broadest** (GROUP > COMPANY > DEPARTMENT > OWN). The
  result is embedded in the token as `{ code, scope }[]` plus `departmentId`.
- **Extended company-context token**: the JWT payload grows from `{ sub, companyId,
  permissions: string[] }` to also carry `departmentId` and scoped grants, per the rbac
  spec's *Company Context Token* requirement. `PermissionsGuard`, `JwtStrategy`,
  `RequestContext`, and the middleware are updated to the richer shape.
- **Data-scope enforcement**: a `ScopeService` resolves a permission's scope and builds a
  row-level filter fragment (OWN → `created_by = user`; DEPARTMENT → user's department;
  COMPANY → no extra filter; GROUP → read-only cross-company), applied **after** the
  active-company filter. Consumed by later capabilities; self-tested here.
- **Time-bounded grants**: resolution honors `valid_from`/`valid_to`; expired
  assignments contribute nothing.
- **Resignation revoke**: `revokeCompanyAccess(userId, companyId)` expires that company's
  `user_company_role` rows only, never touching the shared `app_user` — the post-action
  hook HR documents will call.
- **Minimal admin surface** (guarded by `RBAC_MANAGE`) so roles/permissions/assignments
  can be set up and tested: create role, attach permission+scope to a role, assign a
  user a role in a company with optional validity window.
- **Resolves the multi-company deferral**: company listing is now filtered to the
  caller's memberships.

No schema change — the six rbac entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `rbac`: adds concrete, additive requirements the existing six implied but did not
  pin down — credential verification (hashed passwords, inactive-account rejection), the
  authentication API contract (`/auth/login`, `/auth/switch-company`, `/auth/me`), and
  permission aggregation rules (dedupe, broadest-scope-wins). The six existing
  requirements are unchanged.

## Impact

- **Affected capability**: `rbac` (unblocks every downstream slice's real authorization).
- **Invariants exercised**: 1 (company isolation — resolution + scope are per active
  company), 5 (permission codes, never role names), 8 is unaffected here.
- **Auth seam refactor**: `JwtPayload`, `JwtStrategy`, `PermissionsGuard`,
  `RequestContext`, `RequestContextMiddleware`, and `AuthService` change shape to carry
  scoped grants + `departmentId`. The existing `permissions.guard.spec.ts` is updated.
- **multi-company**: `CompanyService.list` (or a new resolver) gains membership filtering
  for the authenticated user — closing the documented deferral.
- **New dependency**: `bcryptjs` (+ `@types/bcryptjs`) — pure-JS hashing, no native build.
- **New permission code**: `RBAC_MANAGE` for the admin endpoints.
