## 1. Shared schemas

- [x] 1.1 In `@erp/shared`: `createRoleSchema` (code, name, description?), `attachPermissionSchema` (roleId, permissionCode, scope ∈ OWN/DEPARTMENT/COMPANY/GROUP), `assignRoleSchema` (userId, roleId, departmentId, isDefault?, validFrom?, validTo?); export a `SCOPES` const and inferred types. `pnpm --filter @erp/shared build`.

## 2. Backend: reads (rbac)

- [x] 2.1 `RoleAdminService.listRoles()`: active-company roles with grants → `[{ id, code, name, isActive, permissions: [{ code, name, scope }] }]`.
- [x] 2.2 `RoleAdminService.listPermissions()`: active catalog → `[{ code, name, module }]`.
- [x] 2.3 `RoleAdminService.listUsers()`: users + active-company assignments → `[{ id, username, email, status, assignments: [{ id, roleId, roleCode, departmentId, departmentName, isDefault, validFrom, validTo }] }]`.
- [x] 2.4 `RbacAdminController` GETs: `/rbac/roles`, `/rbac/permissions`, `/rbac/users` (inherit class `RBAC_MANAGE`).

## 3. Backend: fine-grained removes (rbac)

- [x] 3.1 `RoleAdminService.detachPermission(roleId, permissionCode)`: verify role in active company, `nativeDelete(RolePermission, { role, permission })`.
- [x] 3.2 `RoleAdminService.removeAssignment(assignmentId)`: load UCR, verify `company === active`, remove; reject cross-company (NotFound).
- [x] 3.3 Controller: `DELETE /rbac/role-permissions` (body roleId + permissionCode) and `DELETE /rbac/assignments/:id`.

## 4. Backend test

- [x] 4.1 DB-backed (reuse `seedDatabase`): `listRoles` returns Admin/Approver/Requester with grants; `listPermissions` returns the catalog; `listUsers` returns the 3 demo users with active-company assignments and excludes a second company's assignment; `detachPermission` removes one grant; `removeAssignment` removes one UCR; a cross-company assignment id is rejected.

## 5. Frontend data layer

- [x] 5.1 `api/rbac.ts`: `roles()`, `permissions()`, `users()`, `createRole`, `attachPermission`, `detachPermission`, `assign`, `removeAssignment`, `revokeAccess`.
- [x] 5.2 `stores/rbacAdmin.ts` (Pinia): `roles`, `permissions`, `users`, `loading`, `error`; `loadAll()`; mutation wrappers that refresh after success; capture errors.

## 6. View & shell

- [x] 6.1 `views/admin/RbacAdminView.vue`: PrimeVue `Tabs` (Roles / Users). Roles tab — role table + grants (chips with detach) + "New role" and "Add grant" dialogs. Users tab — user table + assignment chips + "Assign role" dialog + per-assignment remove + "Revoke all access". All gated by `can('RBAC_MANAGE')`.
- [x] 6.2 Dialogs use `<Form :resolver="zodResolver(schema)">` + `<FormField>` + `<Message>` with the shared schemas; department `Select` from `GET /departments`; scope/role/permission `Select`s.
- [x] 6.3 Routing + nav: route `rbac-admin` (`meta.permission='RBAC_MANAGE'`); an "Access" nav item gated by `can('RBAC_MANAGE')`.

## 7. Frontend tests

- [x] 7.1 rbac store (mock `api`): `loadAll` populates roles/permissions/users; `createRole`/`attachPermission`/`assign`/`detachPermission`/`removeAssignment` call the right endpoint and refresh; error captured.
- [x] 7.2 Shared schemas: valid role/grant/assignment accepted; missing required and a bad scope rejected.

## 8. Verify

- [x] 8.1 `pnpm --filter @erp/shared build`, `pnpm --filter back build` + `pnpm --filter back test`, `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 8.2 Run `openspec validate web-rbac-admin --type change --strict`.
