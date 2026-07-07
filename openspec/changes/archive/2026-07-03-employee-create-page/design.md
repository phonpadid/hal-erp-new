## Context

Employee creation currently lives in a modal `<Dialog>` inside
`front-end/src/views/admin/EmployeeAdminView.vue` (the `empDialog` state, `empModel`, `openEmp`,
and `submitEmp`). The same dialog is reused for both create and edit. Validation is done with a
manual `employeeCreateSchema.safeParse(...)` against the shared `@erp/shared` Zod schema, mapping
issues to per-field messages via a local `fieldErrors` helper. Departments are loaded into a
`ref`, `hireDate` binds a `Date` and is converted to `'YYYY-MM-DD'`, and `salary` is only sent
when the caller holds `EMP_SALARY_VIEW`.

The app already has a page-based admin flow to mirror: `EmployeeOnboardView.vue` at route
`employee-admin/:id/onboard` (guarded by `EMPLOYEE_MANAGE`), using `PageHeader.vue`, PrimeVue
components, and `useRouter`/`useRoute`. A set of undraw illustrations now exists under
`front-end/src/assets/illustrations/`.

This is a **frontend-only, presentation** change. No backend, DTO, DB, or API surface changes; no
`budget_txn` or `quota_usage` writes occur in this flow, so there is no ledger transaction
boundary or locking to specify.

## Goals / Non-Goals

**Goals:**
- Move the **create-employee** form out of the dialog and onto a dedicated, guarded page/route.
- Keep validation behaviour and payload identical by reusing the shared `employeeCreateSchema`
  and the existing create logic, relocated — not rewritten.
- Preserve `EMPLOYEE_MANAGE` gating (route guard) and `EMP_SALARY_VIEW` gating for the salary
  field, mirroring the server.
- Add a themed illustration for visual polish that works in light and dark mode.
- On success, return to the employee-admin list with the existing success feedback.

**Non-Goals:**
- Editing an employee stays in its current inline dialog (a possible later change).
- No change to the create API, the shared schema, permissions, or company-scoping rules.
- Not converting the form to the `@primevue/forms` `<Form>`/`zodResolver` pattern in this change
  — that would be a larger refactor and risk validation drift from the sibling edit dialog.

## Decisions

- **New route `employee-admin/new` (name `employee-create`), guarded by `EMPLOYEE_MANAGE`.**
  Placed as a sibling of the existing `employee-admin` and `employee-admin/:id/onboard` routes in
  `front-end/src/router/index.ts`, reusing the same `meta: { permission: 'EMPLOYEE_MANAGE' }`.
  Alternative considered: a query-param/state flag on the same route — rejected because a real
  route gives a shareable/back-button-friendly URL and matches the onboarding precedent.

- **New `EmployeeCreateView.vue` mirrors the dialog's create logic.** Reuse `empModel`,
  `toYmd`, `fieldErrors`, `employeeCreateSchema.safeParse`, and `useEmployeeAdminStore().create`
  verbatim (create-only branch). This guarantees the created payload and validation are identical
  to today. Alternative considered: rewrite with `@primevue/forms` — rejected for this change to
  avoid drift and scope creep (see Non-Goals).

- **Navigation replaces dialog open.** In `EmployeeAdminView.vue`, the "New Employee" action
  changes from `openEmp()` (opens dialog) to `router.push({ name: 'employee-create' })`. The
  create branch of `empDialog`/`openEmp`/`submitEmp` is removed; the edit branch and the
  link/onboard dialogs remain. Success returns via `router.push({ name: 'employee-admin' })` and
  the list reloads for the active company.

- **Illustration choice + styling.** Use a user/profile-themed asset already present, e.g.
  `undraw_online-profile_v9c1.svg` (candidates: `undraw_user-account_fvqa.svg`,
  `undraw_online-cv_4iq9.svg`). Import it as a static asset and constrain it with Tailwind utility
  classes; color/emphasis via PrimeUI theme tokens (no hardcoded hex) so both `.dark` and light
  render correctly. The illustration is decorative only (empty/short `alt`), never blocking.

- **Layout.** Two-column on wide screens (form left, illustration + short helper copy right),
  single column stacked on small screens, using the existing `PageHeader.vue` for the title and a
  back action. Department options are loaded on mount via the same source the admin screen uses.

## Risks / Trade-offs

- **[Behaviour drift between create page and edit dialog]** → Both keep using the same shared
  `employeeCreateSchema`/`employeeUpdateSchema`; the create logic is copied, not re-implemented,
  and covered by the existing schema spec test plus a new smoke test for the route.
- **[Dead code left in EmployeeAdminView]** → Explicitly remove the create-only dialog markup and
  the create branch of `submitEmp`/`openEmp`; keep edit/link/onboard paths intact.
- **[Illustration breaks bundle or dark mode]** → Use a local SVG asset (already in repo, no new
  dependency) and theme tokens; verify visually in both themes.
- **[Route reachable without permission]** → Route carries `meta.permission = 'EMPLOYEE_MANAGE'`,
  enforced by the existing router guard; the server still enforces on create regardless.

## Migration Plan

Pure additive/relocation frontend change, no data migration. Deploy is a frontend build. Rollback
is reverting the route + view + the `EmployeeAdminView` action change; the shared schema and API
are untouched, so no coordinated backend rollback is needed.

## Open Questions

- Final illustration selection (default `undraw_online-profile_v9c1.svg`) — cosmetic, can be
  swapped without affecting behaviour.
