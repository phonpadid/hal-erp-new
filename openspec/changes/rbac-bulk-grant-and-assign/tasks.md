## 1. Shared schemas

- [x] 1.1 Add `bulkAttachPermissionsBaseSchema` / `bulkAttachPermissionsSchema` to
      `shared/src/index.ts`: `{ roleId: uuid, grants: [{ permissionCode, scope }], detach: [code] }`,
      reusing `SCOPES`; keep the base a plain `ZodObject` so the Vue resolver can `.omit()`
      the `roleId` context field
- [x] 1.2 Add `bulkAssignRolesBaseSchema` / `bulkAssignRolesSchema`:
      `{ userId, departmentId, roleIds: uuid[] (min 1), isDefault?, validFrom?, validTo? }`,
      applying the existing `validWindow` refinement only on the full schema
- [x] 1.3 Cap both with a max array length matching the backend `@ArrayMaxSize` (200)
- [x] 1.4 `pnpm --filter @erp/shared build` so back and front pick up the new types

## 2. Backend service

No entity or migration work: `role_permission` and `user_company_role` are unchanged.

- [x] 2.1 In `role-admin.service.ts`, extract the active-company validation the bulk paths need
      into reusable helpers: resolve a `role` / `department` and assert `company_id` matches
      `RequestContext.companyId()`
- [x] 2.2 Refactor `assignUserRole` onto those helpers — it currently writes without verifying
      the role and department belong to the active company (company isolation invariant)
- [x] 2.3 Implement `attachPermissionsBulk(roleId, grants, detach)`: validate every item first
      (known `permission.code`, valid `scope`, role in active company), reject the whole batch
      on any error, then apply inside one `em.transactional(...)`
- [x] 2.4 In that transaction, re-read the role's current `role_permission` rows and derive
      outcomes: insert new grants, UPDATE `scope` on a held grant whose scope changed, skip a
      held grant with an identical scope, skip a detach of a code not held
- [x] 2.5 Implement `assignUserRolesBulk(userId, departmentId, roleIds, isDefault, validFrom,
      validTo)`: validate all roles + department against the active company and the window, reject
      a batch marking more than one default, then insert one `user_company_role` per role inside
      one `em.transactional(...)`, skipping roles the user already holds in that company
- [x] 2.6 Return `{ applied, skipped: [{ item, reason }] }` from both

## 3. Backend DTOs and endpoints

- [x] 3.1 Add `BulkAttachPermissionsDto` and `BulkAssignRolesDto` under
      `back/src/modules/rbac/dto/`, mirroring the shared schemas, with `@ValidateNested`,
      `@ArrayMaxSize(200)`, and `@IsUUID` on id fields
- [x] 3.2 Add `POST /rbac/role-permissions/bulk` and `POST /rbac/assignments/bulk` to
      `rbac-admin.controller.ts` under the same `RBAC_MANAGE` guard as the existing writes
- [x] 3.3 Confirm the single-item `attachPermission` still throws `ConflictException` on a
      duplicate — the strict single / forgiving batch split is deliberate

## 4. Backend tests

- [x] 4.1 `rbac-admin.spec.ts`: bulk grant creates one row per code with the submitted scope
- [x] 4.2 A batch mixing grants and detaches applies both and leaves untouched grants alone
- [x] 4.3 Re-granting a held code with the same scope is skipped; with a different scope it
      UPDATEs in place and inserts no second `(role_id, permission_id)` row
- [x] 4.4 A batch containing one unknown permission code writes nothing (atomicity)
- [x] 4.5 A batch naming a role or department from another company is rejected and writes
      nothing (company isolation)
- [x] 4.6 Bulk assign creates one `user_company_role` per role sharing department and window;
      an already-held role is skipped, not fatal
- [x] 4.7 A batch with its shared default flag set lands `is_default = true` on exactly one
      created assignment
- [x] 4.8 A batch whose `valid_to` precedes `valid_from` is rejected and writes nothing

## 5. Frontend API and store

- [x] 5.1 Add `attachPermissionsBulk` and `assignBulk` to `front-end/src/api/rbac.ts`, typed
      with the shared schema types and the `{ applied, skipped }` response
- [x] 5.2 Add matching actions to `stores/rbacAdmin.ts` via `run()` so each batch triggers
      exactly one `reloadMutable()`
- [x] 5.3 Expose the `skipped` list to callers so the view can report partial outcomes

## 6. Manage-permissions surface

- [x] 6.1 In `RbacAdminView.vue`, replace `permissionGroups` (catalog minus held) with a staged
      model over the **full** catalog: `{ code, module, checked, scope, heldScope }`, seeded from
      the open role's grants and reset whenever the dialog opens
- [x] 6.2 Render rows as checkbox + code/name + a per-row scope `Select` shown when checked,
      keeping the existing module grouping, collapse-by-default, text filter, and fixed-height
      scroll region
- [x] 6.3 Add a "set scope for all checked" control above the list
- [x] 6.4 Compute the diff (grants to add, scopes to change, codes to detach) and show a running
      staged-change summary
- [x] 6.5 Wire commit to `attachPermissionsBulk`; require `fb.confirm` whenever the diff contains
      any detach, stating the counts
- [x] 6.6 Remove the single-item add form and per-chip `detachPermission` call path from this
      dialog once the diff editor covers both
- [x] 6.7 Report the result: success with applied counts, and a warning (not a success) when
      every item was skipped

## 7. Assign-role surface

- [x] 7.1 Restructure the assign dialog: department, `isDefault`, and the acting window stay
      single-valued at the top; the role `Select` becomes a checkbox list of the company's roles
- [x] 7.2 Show roles the user already holds in the active company as held and non-selectable
      (`user_company_role` is unique on `(user_id, company_id, role_id)`)
- [x] 7.3 Block submit with a validation message when no role is checked
- [x] 7.4 Keep the existing window validation via the shared refinement, and keep merging the
      non-`FormField` context values (`userId`, window) explicitly in the submit handler — the
      documented `@primevue/forms` blank-payload trap
- [x] 7.5 Wire commit to `assignBulk` and report applied/skipped counts

## 8. i18n and polish

- [x] 8.1 Add en/la keys for the new chrome: staged-change summary, bulk scope control,
      detach confirmation, already-held marker, no-role-selected error, partial-skip notice
- [x] 8.2 Verify both dialogs in light and dark mode using PrimeUI theme tokens only — no
      hardcoded colors
- [x] 8.3 Update `stores/rbacAdmin.spec.ts` for the bulk actions and the one-reload-per-batch
      behaviour

## 9. Verification

- [x] 9.1 `pnpm --filter back test` and `pnpm --filter front-end test` green
- [x] 9.2 Manually confirm on `http://localhost:5173/new/rbac-admin` that granting many
      permissions issues **one** POST and **one** roles reload (network tab), not one per item
- [x] 9.3 Check the local "Hal Logistic" dataset for any pre-existing cross-company
      `user_company_role` row that the newly strict validation would now refuse (see design
      Risks) before considering the change done
