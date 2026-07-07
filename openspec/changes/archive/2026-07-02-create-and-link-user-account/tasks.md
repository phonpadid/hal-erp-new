## 1. Shared schema

- [x] 1.1 Add `createUserAccountSchema = z.object({ username: z.string().min(1).max(255), email: z.string().email().max(255) })` and its `CreateUserAccountInput` type to `shared/src/index.ts`, near the employee schemas.

## 2. Backend — create-and-link

- [x] 2.1 Add `CreateUserAccountDto` (username, email; class-validator) to `back/src/modules/rbac/employee.dto.ts`, mirroring the shared schema.
- [x] 2.2 Add `createAccount(id, dto)` to `employee.service.ts`: in a single `em.transactional`, load the employee in the active company, reject if it already has a linked account, read `USER_PASSWORD` from config and throw `BadRequestException` if unset/empty, hash it with `PasswordService`, create `AppUser { username, email, passwordHash, status: 'ACTIVE' }`, set `employee.user`, flush, and return the `EmployeeView`.
- [x] 2.3 Catch the `app_user` username/email unique-violation and translate it to a `BadRequestException` (400), so the DB constraint is authoritative.
- [x] 2.4 Inject `PasswordService` (and `ConfigService`/config source) into `EmployeeService`; ensure `PasswordService` is available in the module providers.
- [x] 2.5 Add `POST :id/create-account` to `employee.controller.ts` guarded by `EMPLOYEE_MANAGE` (same guard as `link`), delegating to `createAccount`.

## 3. Frontend

- [x] 3.1 Add `createAccount(employeeId, { username, email })` to `front-end/src/api/employees.ts` and a corresponding action to `stores/employeeAdmin.ts`.
- [x] 3.2 In `EmployeeAdminView.vue` link dialog, add a mode toggle ("link existing" vs "create new account"); the create mode shows username + email inputs (no password), validates with `createUserAccountSchema`, and calls the new store action.
- [x] 3.3 Add i18n keys (create-account label, username/email field labels, mode toggle) to `front-end/src/i18n/locales/la/admin.ts` and `en/admin.ts`.

## 4. Config & docs

- [x] 4.1 Add `USER_PASSWORD` to `.env.example` and document it (onboarding initial password) in BOOTSTRAP.md.

## 5. Tests

- [x] 5.1 Backend unit test: create-and-link succeeds, stores a hash (not plaintext) of `USER_PASSWORD`, and the created user authenticates with `USER_PASSWORD`.
- [x] 5.2 Backend unit test: rejects when the employee already has an account, when username/email collide, and when `USER_PASSWORD` is unset.
- [x] 5.3 Concurrency test: two concurrent create-account calls for distinct employees with the same username — exactly one succeeds, the other gets a 400 (unique constraint authoritative).
- [x] 5.4 Frontend: schema validation + i18n parity for the new keys.
