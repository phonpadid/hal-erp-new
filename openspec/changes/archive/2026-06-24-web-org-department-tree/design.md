## Context

Departments are an unlimited-depth tree in the data model (`department.parent_dept_id`,
`erp_approval_system.dbml`). The backend `DepartmentService` already resolves parents within the
active company, rejects cross-company parents, and rejects reparenting that would create a cycle.
The department API returns the flat list including `parentDeptId`, and the dialog already submits an
optional `parentDeptId`. The only gap is presentation: `OrgAdminView.vue` renders departments in a
flat `AppDataTable`, so the hierarchy is invisible and the parent picker is an unstructured `Select`.
This is a frontend-only change; no service, DTO, migration, or `@erp/shared` schema is touched.

## Goals / Non-Goals

**Goals:**
- Show departments as a hierarchy (ฝ่าย → แผนก → หน่วยงาน) in the departments tab.
- Let a user pick a parent from that hierarchy, with the edited node and its descendants excluded.
- Keep all existing columns, the per-row edit action, permission gating, and company scoping intact.

**Non-Goals:**
- No backend changes; the server's cycle/cross-company guards remain the authority.
- No drag-and-drop reparenting, no lazy/async tree loading, no pagination redesign.
- No changes to companies, fiscal-year, or holiday tabs.

## Decisions

- **PrimeVue `TreeTable` over a flat `DataTable`.** It is the PrimeVue primitive for hierarchical
  tabular data, keeps the existing column set, and supports expand/collapse. Alternative considered:
  keep `DataTable` and add a "Parent" text column — rejected because it shows relationships but not
  structure, which is the actual requirement.
- **Build the `TreeNode[]` client-side from the existing flat list.** The API already returns every
  department with `parentDeptId`; grouping children by parent in a computed property avoids any new
  endpoint. Roots are departments whose `parentDeptId` is null/absent. Alternative: a new tree
  endpoint — rejected as unnecessary for the typical department count.
- **`TreeSelect` for the parent field, excluding self + descendants.** Mirrors the server's existing
  cycle rejection as a UX aid so the user cannot pick an invalid parent. The exclusion is computed
  from the same client tree. The server remains authoritative (client guard is UX only).
  - *Implementation note:* `TreeSelect`'s single-selection model is a `{ [id]: true }` map, which
    doesn't fit a `@primevue/forms` `FormField` whose value must be the `parentDeptId` uuid string.
    So the parent is held in a local `deptParentSel` ref outside the `<Form>` and merged into the
    submit payload — set to the selected id, `null` on edit to clear, omitted on create. This also
    fixed a latent bug where editing a department never re-populated its existing parent.
- **Departments tab is no longer server-paginated.** A tree must render its full set to be coherent,
  and the dept list already loaded a single page of up to 100 rows; the `TreeTable` now renders that
  whole list, and the search box filters the tree client-side (keeping ancestors of matches).
- **Stable ordering.** Sort siblings by `deptCode` so the tree render is deterministic across loads.

## Risks / Trade-offs

- **Orphaned/cross-company parent reference in data** → A node whose `parentDeptId` is not in the
  current company's list would be dropped from the tree. Mitigation: treat any node whose parent is
  not found as a root so it is never hidden; the active-company scoping already prevents
  cross-company parents from being returned.
- **Large department counts render the whole tree at once** → Acceptable for realistic org sizes;
  if it ever matters, `TreeTable` lazy mode is a later optimization, not in scope here.

## Migration Plan

Pure frontend swap of one tab's table component and one form field. No data migration. Rollback is
reverting `OrgAdminView.vue` (and any helper). No flow writes `budget_txn` or `quota_usage`, so no
transaction-boundary or locking considerations apply.

## Open Questions

- Should inactive departments still appear (greyed) in the tree, or be filtered? Default: keep them
  shown with the existing active/inactive `Tag`, matching today's behavior.
