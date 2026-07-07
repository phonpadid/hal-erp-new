## 1. Shared validation schema

- [x] 1.1 Define one change-password Zod schema (min length + strength policy, `confirm === new`, `new !== current`) in the shared schema package, aligned with the strength policy used by `password-reset`'s set-new-password
- [x] 1.2 Export a matching type so the backend DTO and the web form both consume the same source of truth

## 2. Backend — user-profile capability

- [x] 2.1 Add a profile-response DTO exposing `app_user` fields `username`, `email`, `email_verified_at`, `status` plus optional linked-employee `full_name`, `position`, department name; never expose `password_hash`
- [x] 2.2 Add a change-password DTO (current password + new password) validated with class-validator mirroring the shared Zod schema
- [x] 2.3 Implement a profile service method that resolves the current user from the JWT and loads their linked `employee` (and department) scoped to the active `company_id` only, returning null employee fields when none exists
- [x] 2.4 Implement a change-password service method: verify current password against `app_user.password_hash` using the same hashing primitive as login, reject on mismatch with a generic error, reject when new equals current, and on success overwrite `app_user.password_hash` with the new hash — no email, no `password_reset_token`
- [x] 2.5 Add the authenticated controller endpoints (read-own-profile GET, change-password POST) behind the auth guard, identifying the user from the JWT with no id in the path
- [x] 2.6 Apply the same rate-limiting/lockout policy as login to the change-password endpoint; ensure no password material is logged or returned

## 3. Backend — tests

- [x] 3.1 Unit test: read-own-profile returns identity fields and omits `password_hash`
- [x] 3.2 Unit test: linked employee is included only for the active company; account without an employee returns identity only
- [x] 3.3 Unit test: change-password succeeds with correct current password; new login works with the new password and fails with the old
- [x] 3.4 Unit test: wrong current password is rejected generically and leaves `password_hash` unchanged
- [x] 3.5 Unit test: new-equals-current and policy-violating new password are both rejected with the password unchanged

## 4. Frontend — web-user-profile page

- [x] 4.1 Add the "My Profile" route and wire the topbar profile menu (web-app-layout shell) to navigate to it
- [x] 4.2 Add i18n keys (en + la) for all profile labels, the change-password form, and its success/error messages
- [x] 4.3 Build the read-only identity + employee display section from the read-own-profile endpoint, with an empty/hidden employee section when absent
- [x] 4.4 Build the change-password form with `@primevue/forms` (`<Form :resolver :initialValues @submit>` + `<FormField>`), using `zodResolver` of the shared schema and `<Message v-if="$form.<field>?.invalid">` for field errors
- [x] 4.5 On submit call the change-password endpoint; on success show a success message and clear fields; on wrong-current-password show a non-disclosing error

## 5. Frontend — tests

- [x] 5.1 Component test: client validation blocks weak/mismatched/equal-to-current new passwords with no request sent
- [x] 5.2 Component/e2e test: valid change submits, shows success, and clears the fields; wrong-current-password shows the error state

## 6. Verify

- [x] 6.1 End-to-end: sign in, open My Profile from the topbar, change the password, sign out, and sign in with the new password
