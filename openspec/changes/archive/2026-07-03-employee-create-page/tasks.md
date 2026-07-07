## 1. Route

- [x] 1.1 Add route `employee-admin/new` (name `employee-create`, `meta: { permission: 'EMPLOYEE_MANAGE' }`) as a sibling of `employee-admin` in `front-end/src/router/index.ts`, importing the new `EmployeeCreateView.vue`.

## 2. Create page

- [x] 2.1 Create `front-end/src/views/admin/EmployeeCreateView.vue` with `<script setup lang="ts">`, using `PageHeader.vue` (title + back), `useRouter`, `useI18n`, `useFeedback`, `useAuthStore`, and `useEmployeeAdminStore`.
- [x] 2.2 Port the create form state and helpers from `EmployeeAdminView.vue`: `empModel` fields (`empCode`, `fullName`, `departmentId`, `position`, `jobLevel`, `hireDate`, `salary`, `status`), `toYmd`, `fieldErrors`, `empErr`, and `statusOptions` from `EMPLOYEE_STATUSES`.
- [x] 2.3 Load department options on mount (same source the admin screen uses) and bind them to the department `Select`.
- [x] 2.4 Gate the `salary` input behind `auth.can('EMP_SALARY_VIEW')`; only include `salary` in the payload when allowed (mirror existing behaviour).
- [x] 2.5 Implement submit: `employeeCreateSchema.safeParse({ ...base, empCode })`; on failure set `empErr`; on success call `useEmployeeAdminStore().create`, then `router.push({ name: 'employee-admin' })` and `fb.success(t('feedback.created'))`; on store error `fb.error(employees.error)`.
- [x] 2.6 Add a Cancel/back action that returns to `employee-admin` without creating.
- [x] 2.7 Lay out two columns on wide screens (form left; illustration + short helper copy right), stacked on small screens; use PrimeVue components and Tailwind/PrimeUI tokens (no hardcoded hex).

## 3. Illustration

- [x] 3.1 Import a user/profile illustration from `front-end/src/assets/illustrations/` (default `undraw_online-profile_v9c1.svg`) as a static asset; render it decoratively (`max-w`/responsive, empty/short `alt`).
- [x] 3.2 Verify the illustration and page render correctly in both light and dark mode.

## 4. Wire up the admin screen

- [x] 4.1 In `EmployeeAdminView.vue`, change the "New Employee" action to `router.push({ name: 'employee-create' })` instead of opening the create dialog.
- [x] 4.2 Remove the create-only path: the create branch of `openEmp`/`submitEmp` and the create-mode dialog markup, keeping the **edit** dialog and the link/onboard dialogs intact.
- [x] 4.3 Confirm no now-unused imports/refs remain (lint clean).

## 5. i18n

- [x] 5.1 Reuse existing `admin.employee.*` keys; add any new page title/subtitle/helper keys to `front-end/src/i18n/locales/en` and `front-end/src/i18n/locales/la`.

## 6. Tests & verification

- [x] 6.1 Add/extend a smoke test so the `employee-create` route mounts under an `EMPLOYEE_MANAGE` user (see `front-end/src/test/smoke/views.smoke.spec.ts`).
- [x] 6.2 Confirm the existing `employeeAccount.schema` test still passes (shared schema unchanged).
- [x] 6.3 Manually verify end-to-end: open page from admin screen → create an employee → returns to list with the new employee visible and success feedback; cancel creates nothing; route is blocked without `EMPLOYEE_MANAGE`.
