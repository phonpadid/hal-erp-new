## 1. Tree building

- [x] 1.1 Add a computed/helper in `OrgAdminView.vue` that maps the flat `org.departments` list into a PrimeVue `TreeNode[]`, nesting each department under its `parentDeptId`, treating null/absent/unresolved parents as roots, and sorting siblings by `deptCode`.
- [x] 1.2 Add a helper that, given a department id, returns the set of its descendant ids (used to exclude self + descendants from parent selection).

## 2. Departments tab — TreeTable

- [x] 2.1 Replace the flat `AppDataTable` in the departments `TabPanel` with a PrimeVue `TreeTable` bound to the tree nodes, keeping the existing columns (deptCode, name, costCenter, active `Tag`) and the per-row edit `Button` gated by `DEPARTMENT_MANAGE`.
- [x] 2.2 Preserve the empty-state and refresh/loading behavior for the departments tab. (Empty-state + loading preserved; search now filters the tree client-side keeping ancestors. Server pagination dropped for departments — trees render the full company list, consistent with the existing limit-100 load.)

## 3. Department dialog — parent picker

- [x] 3.1 Replace the parent `Select` with a PrimeVue `TreeSelect` whose options are the department tree, excluding the edited department and its descendants; keep `parentDeptId` as the submitted value and `showClear` for "no parent". (Parent moved out of the `<Form>` to a `deptParentSel` ref since TreeSelect's `{id:true}` model doesn't map to a uuid FormField; merged into the payload on submit — clears to `null` on edit, omitted on create. Also fixed a latent bug: the edit dialog never re-populated the parent.)
- [x] 3.2 Add any new i18n strings (e.g. parent placeholder/label) to the locale files used by `$t`. (No new strings — existing `admin.org.fields.parent` / `parentPlaceholder` reused.)

## 4. Verify

- [ ] 4.1 Create a multi-level department set (ฝ่าย → แผนก → หน่วยงาน) and confirm it renders nested, roots at top level, siblings ordered by code.
- [ ] 4.2 Edit a mid-tree department and confirm its own subtree is not offered as a parent; confirm the server still rejects a cycle if forced (client guard is UX only).
- [ ] 4.3 Confirm permission gating (view vs `DEPARTMENT_MANAGE`), active-company scoping, and the other tabs (companies, fiscal years, holidays) are unchanged.
