## Context

The "Link account" dialog in `EmployeeAdminView.vue` has two modes: **existing** (link to an
account that already exists) and **create** (create-and-link a new account). The **existing** mode
renders a free-text `InputText` bound to `linkModel.userId` whose placeholder is literally
`app_user UUID` and whose help text tells the admin to paste a UUID
(`EmployeeAdminView.vue:300-306`, i18n keys `admin.employee.fields.userId*`). Submit posts that id to
`POST /employees/:id/link`, which sets `employee.user_id` (`employee.service.ts:169 link()`).

No admin knows a raw `app_user` UUID, so this mode is unusable in practice. There is already a
user-listing read — `RoleAdminService.listUsers` behind `GET /rbac/users`
(`rbac-admin.controller.ts:45`) — but it is guarded by `RBAC_MANAGE`, returns per-company role
assignments, and does not indicate whether a user is linked to an employee. `Employee.user` is a
`@OneToOne(() => AppUser, { owner: true, nullable: true })` (`rbac.entities.ts:119`), so the
DB enforces one account ↔ at most one employee globally.

## Goals / Non-Goals

**Goals:**
- Let an `EMPLOYEE_MANAGE` admin link an existing account by **selecting it from a searchable list**
  of unlinked accounts, never by typing an id.
- Keep the link write path (`POST /employees/:id/link` with a `userId`) unchanged.

**Non-Goals:**
- No standalone user-management page (tracked separately).
- No change to create-and-link mode, unlink, or the `POST /employees/:id/link` contract.
- Not reusing/altering `GET /rbac/users` or its `RBAC_MANAGE` guard.

## Decisions

**1. New read endpoint under the employees controller, not `/rbac/users`.**
Add `GET /employees/linkable-accounts` guarded by `EMPLOYEE_MANAGE` (same guard as `link` /
`create-account`). Reusing `/rbac/users` would force employee admins to also hold `RBAC_MANAGE`,
return assignment data the dialog doesn't need, and still lack the linked/unlinked filter. A
dedicated read keeps the permission surface correct and the payload minimal.

**2. "Unlinked" = referenced by no employee.**
`listLinkableAccounts(search?)` selects `app_user` rows whose `id` is not among
`SELECT user_id FROM employee WHERE user_id IS NOT NULL`. Because `Employee.user` is a unique
one-to-one, an account linked to an employee in *any* company is excluded — this is correct
(the same account cannot be linked twice) and does not leak cross-company data because the result
carries only `id`, `username`, `email`. Implement with a MikroORM `qb`/`$nin` subquery on
`Employee.user`, ordered by `username`, capped (e.g. `limit` ~50) with an optional
case-insensitive `search` (`$ilike`) over `username`/`email`.

**3. Return shape `{ id, username, email }`.**
Add a shared `LinkableAccount` type (`shared/src/index.ts`). No password, status, or assignments.
The list is not paginated in the UI (a searchable capped list is enough); the endpoint still accepts
`search` to keep large tenants responsive.

**4. Frontend: PrimeVue `Select` (with filter) instead of `InputText`.**
In existing mode, fetch linkable accounts on dialog open and bind the chosen account's `id` to the
still-existing `linkModel.userId` (so `employeeLinkSchema`/`submitLink` are unchanged). Option label
shows `username — email`. Show an empty state when there are no unlinked accounts. Remove the
`userIdPlaceholder`/`userIdHelp` "paste UUID" strings and add picker label/placeholder/empty i18n
keys in `la` and `en`.

**5. Company isolation.** `app_user` is global (no `company_id`); the endpoint filters by link-state
only and returns identity fields only, so no company data crosses. The employee being linked is
still loaded in the active company by the unchanged `link()` path.

## Risks / Trade-offs

- **Account enumeration:** the read exposes existence of unlinked usernames/emails to any
  `EMPLOYEE_MANAGE` admin. Acceptable — these admins already create accounts and observe uniqueness
  collisions; the payload excludes assignments, status, and company. Mitigated by requiring a
  search term only if a stricter posture is later desired.
- **Removing the UUID paste path** is effectively breaking for anyone scripting against the raw
  input, but it is a UI affordance only; the underlying `POST /employees/:id/link` id contract is
  unchanged, so power users can still link by id via the API.
- **Unpaginated picker** could grow for tenants with many unlinked accounts; the `search` filter and
  a result cap bound the payload, and unlinked accounts are expected to be few.
