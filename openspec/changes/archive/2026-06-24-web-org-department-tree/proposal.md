## Why

The backend already models departments as an unlimited-depth tree (`department.parent_dept_id`,
with cycle detection and cross-company reparent guards), and the department form already lets a
user pick a parent. But the Organization admin screen renders departments as a **flat** `DataTable`
with no parent column, so the ฝ่าย → แผนก → หน่วยงาน hierarchy is invisible. Users cannot see or
reason about the org structure they are editing. This change closes that frontend-only gap so the
UI reflects the tree the data model already supports.

## What Changes

- Replace the flat departments `DataTable` in `OrgAdminView.vue` with a PrimeVue `TreeTable` that
  renders departments nested under their parent (root = departments with no `parentDeptId`),
  preserving the existing code / name / cost-center / active columns and the per-row edit action.
- Replace the parent `Select` in the department dialog with a `TreeSelect` so a parent is chosen
  from the hierarchy; exclude the department being edited and its descendants from the options to
  keep the client guard aligned with the server's cycle rejection.
- Build the tree client-side from the existing flat department list (the API already returns
  `parentDeptId`); no backend, DTO, or schema changes.
- No change to permission gating, company scoping, or any other tab (companies, fiscal years,
  holidays remain as-is).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-org-admin`: the **Department Management** requirement gains behavior for displaying
  departments as a hierarchy and selecting a parent from that hierarchy (presentation-level only;
  no new server behavior).

## Impact

- **Capability touched:** organization administration (frontend of `multi-company`); no backend
  capability behavior changes.
- **Code:** `front-end/src/views/admin/OrgAdminView.vue` (departments tab + dialog), possibly a
  small tree-building helper; i18n strings for any new labels. No changes to `back/`, the DBML,
  `@erp/shared` schemas, or the API client.
- **Invariants:** none at risk — company isolation, append-only ledgers, and permission-code
  gating are untouched; the descendant-exclusion in `TreeSelect` only mirrors the server's existing
  cycle guard as a UX aid (the server remains authoritative).
