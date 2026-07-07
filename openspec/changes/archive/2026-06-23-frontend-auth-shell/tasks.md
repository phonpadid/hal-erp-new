## 1. Auth store (state, actions, persistence)

- [x] 1.1 Extend `useAuthStore` state with `departmentId` and `companies: AccessibleCompany[]`; keep `token`/`userId`/`activeCompanyId`/`permissions` + `isAuthenticated`/`can`.
- [x] 1.2 Actions: `login(username, password)` → `POST /auth/login`; store `companies`; if `accessToken` → `setToken` + `refresh()` and return `'home'`, else return `'select-company'`. `selectCompany(companyId)` → `POST /auth/switch-company` → `setToken` + `refresh()`. `refresh()` → `GET /auth/me` sets `{ userId, companyId, departmentId, permissions = grants.map(code) }`. `logout()` clears + wipes storage. `restore()` reads the token from `localStorage` and `refresh()`s (401 → `logout`).
- [x] 1.3 Persist `token` (+ `activeCompanyId`) to `localStorage` on `setToken`/`logout`; permissions are never persisted (always via `/auth/me`).

## 2. API client interceptors

- [x] 2.1 Keep the request interceptor (bearer from store). Add a response interceptor: on `401`, `auth.logout()` and redirect to `/login` (no loop when already there); import the router lazily to avoid a circular import.

## 3. Views & layout

- [x] 3.1 `LoginView.vue`: `@primevue/forms` `<Form :resolver>` with `zodResolver(loginSchema)` (`@erp/shared`), username + password fields, `<Message>` errors, a 401 banner; on success route per the store result.
- [x] 3.2 `SelectCompanyView.vue`: list `auth.companies`; choosing one calls `selectCompany` then routes home.
- [x] 3.3 `AppShell.vue`: top bar with a company switcher (Dropdown over `companies` → `selectCompany`), user menu (username + Logout), the dark toggle (moved from `App.vue`), and a permission-gated nav (`can`/`v-can`). `App.vue` becomes `<RouterView/>`.
- [x] 3.4 Move the sample company form under auth as the `home` route inside the shell layout.

## 4. Routing & guards

- [x] 4.1 Routes: `/login` (`meta.public`), `/select-company` (auth, no company required), protected app routes under the shell (`home`); support `meta.permission`.
- [x] 4.2 Global `beforeEach`: unauthenticated + non-public → `/login`; authenticated + no active company + route needs one → `/select-company`; `meta.permission` && `!can` → redirect home. Export the guard logic as a pure function for testing.

## 5. Frontend test setup & tests

- [x] 5.1 Add `@vue/test-utils` + `jsdom`; `front-end/vitest.config.ts` (`environment: 'jsdom'`, globals) and a `test` script.
- [x] 5.2 Auth store tests (mock `api`): login with default company sets session + returns `'home'`; login without default returns `'select-company'` and loads no permissions; `selectCompany` refreshes permissions; `logout` clears; `can(code)` reflects permissions.
- [x] 5.3 Guard tests (pure function): unauthenticated→`/login`; authenticated+no-company→`/select-company`; missing `meta.permission`→redirect home; allowed→proceed.

## 6. Verify

- [x] 6.1 `pnpm --filter front-end build` (vue-tsc + vite) and `pnpm --filter front-end test` pass.
- [x] 6.2 Run `openspec validate frontend-auth-shell --strict`.
