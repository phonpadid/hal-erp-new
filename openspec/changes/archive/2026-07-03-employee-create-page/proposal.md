## Why

Creating an employee today happens in a cramped modal `<Dialog>` on the employee-admin
screen. A dialog limits room for the growing field set (`emp_code`, `full_name`, department,
`position`, `job_level`, `hire_date`, `status`, and the permission-gated `salary`), gives no
space for guidance, and feels inconsistent with the already-page-based onboarding flow. Moving
create to a dedicated, well-laid-out page with a friendly illustration makes the form easier to
scan and complete, and matches the existing `employee-onboard` page pattern.

## What Changes

- Replace the **create-employee** flow on the employee-admin screen: the "New Employee" action
  navigates to a **new dedicated page/route** instead of opening the create dialog.
- Add a new route `employee-admin/new` (name `employee-create`) guarded by `EMPLOYEE_MANAGE`,
  rendering a new `EmployeeCreateView.vue`.
- The new page reuses the same shared `employeeCreateSchema` (Zod) as the single source of
  truth, the existing create logic (relocated, not rewritten), and the existing create API —
  behaviour and validation are unchanged; only the presentation moves from dialog to page.
- Add a decorative **illustration** from `front-end/src/assets/illustrations/` (a user/profile
  themed undraw SVG) to the page for visual polish; theme-token styling so light/dark both work.
- On successful create, navigate back to the employee-admin list and surface the existing
  success feedback.
- **Edit** stays in its current dialog for now (out of scope); only create moves to a page.

## Capabilities

### New Capabilities
<!-- none — this reshapes an existing web capability -->

### Modified Capabilities
- `web-employee-admin`: the "Employee Registry Admin Screen" requirement changes so that
  **creating** an employee happens on a dedicated page reached from the admin screen, rather
  than in an inline dialog. Editing behaviour is unchanged.

## Impact

- **Frontend only.** No backend, DB, DTO, or API changes.
- Affected files: `front-end/src/router/index.ts` (new route),
  `front-end/src/views/admin/EmployeeAdminView.vue` (remove create dialog, change action to
  navigate), new `front-end/src/views/admin/EmployeeCreateView.vue`, and an illustration asset
  under `front-end/src/assets/illustrations/`.
- No core invariant is touched: company scope and permission-code gating remain enforced by the
  server; the client `EMPLOYEE_MANAGE` guard and active-company context are preserved. Money
  (`salary`) stays a decimal string via the shared schema.
- i18n: reuse existing `admin.employee.*` keys; add any page-title/subtitle keys as needed.
