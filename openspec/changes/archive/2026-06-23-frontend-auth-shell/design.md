## Context

`front-end/` is the Vite + Vue 3 + PrimeVue scaffold with stub `stores/auth.ts` (state +
`can()`), `api/client.ts` (axios + request interceptor), a one-route `router`, a sample
`CompanyFormView`, and an `App.vue` with a dark toggle. The backend exposes
`POST /auth/login` → `{ user, companies[], accessToken|null }`,
`POST /auth/switch-company` → `{ accessToken, companyId }`, and `GET /auth/me` →
`{ userId, companyId, departmentId, grants:[{code,scope}] }`. The shared `@erp/shared`
package exports `loginSchema`. No backend change.

## Goals / Non-Goals

**Goals**
- Real login, company selection/switch, logout.
- Session persisted across reloads; `/auth/me` as the single source of live context.
- JWT on every request; 401 → clear + redirect to Login.
- Route guard + permission-code gating of routes and nav.
- An authenticated shell layout; the sample form becomes the first guarded screen.
- Vitest setup + unit tests for the store and guard.

**Non-Goals**
- Feature screens beyond the shell; refresh-token rotation; i18n; realtime.

## Decisions

### D1 — `/auth/me` is the source of live context; token is the only persisted secret
After login (or switch) the shell stores the `accessToken`, then calls `GET /auth/me` to
populate `{ userId, companyId, departmentId, permissions }` where
`permissions = grants.map(g => g.code)`. On reload, if a token exists, the shell calls
`/auth/me` to rehydrate (and validate) it — a 401 there means the token is dead → logout.
Only `token` (+ `activeCompanyId` for display) is written to `localStorage`; permissions are
always re-fetched, never persisted, so they can't drift from the server. *Alternative:*
decode the JWT client-side — rejected; `/auth/me` keeps one authority and avoids base64/exp
parsing on the client.

### D2 — Auth state + actions in the Pinia store
`useAuthStore` gains actions: `login(username, password)`, `selectCompany(companyId)`,
`refresh()` (calls `/auth/me`), `logout()`, and `restore()` (startup). State adds
`departmentId` and `companies: AccessibleCompany[]` (from the login response). `login`:
- call `/auth/login`; keep `companies`; if `accessToken` present → `setToken` + `refresh()`
  → resolve `'home'`; else resolve `'select-company'` (no token yet).
`selectCompany`: `/auth/switch-company` → `setToken` + `refresh()`. Persistence is a tiny
subscription (or explicit writes in `setToken`/`logout`).

### D3 — axios interceptors
Keep the request interceptor (bearer from store). Add a **response** interceptor: on
`error.response.status === 401`, call `auth.logout()` and redirect to `/login` (guard against
loops by not redirecting if already there). The router is imported lazily in the interceptor
to avoid a circular import.

### D4 — Routing & guards
Routes: `/login` (public), `/select-company` (auth, no company required), and protected app
routes under the shell (home = the company form for now). `meta`: `public?: boolean`,
`permission?: string`. A global `beforeEach`:
1. not authenticated and route not public → `'/login'`.
2. authenticated, no active company, route needs one → `'/select-company'`.
3. `meta.permission` set and `!can(permission)` → redirect home (or a Forbidden view).
Nav links and in-view buttons use `can(code)` / the existing `v-can`.

### D5 — Layout
`AppShell.vue`: PrimeVue top bar with the company switcher (Dropdown of `companies`,
calls `selectCompany`), a user menu (username + Logout), the dark toggle (moved from
`App.vue`), and a permission-gated nav. `App.vue` becomes `<RouterView/>`; the shell wraps
protected routes via a layout route or a wrapper component. Theme tokens only (no hardcoded
colors), per the project conventions.

### D6 — Login form
`LoginView.vue` uses `@primevue/forms` `<Form :resolver>` with `zodResolver(loginSchema)`
(mirrors the scaffold sample), `InputText` + password field, `<Message>` for field errors,
and a server-error banner for 401. On success it routes per D2.

### D7 — Frontend tests
Add Vitest to `front-end` (`vitest.config.ts` with `jsdom` + `@vue/test-utils`,
`environment: 'jsdom'`). Unit-test the **auth store** (login default vs no-default, switch,
logout/clear, `can()`), mocking the `api` client, and the **guard** function (pure: given
auth state + route meta → expected redirect). Full component rendering is optional; the
store + guard hold the logic. Verify `pnpm --filter front-end build` (vue-tsc + vite) stays
green.

## Risks / Trade-offs

- **localStorage token** is XSS-exposed (vs httpOnly cookie) → acceptable for this SPA
  stage; documented. A cookie/refresh scheme can replace it without changing call sites
  (all token access goes through the store).
- **Extra `/auth/me` round-trip** on load/login → one cheap call; the payoff is never-stale
  permissions and token validation in one place.
- **Circular import** (api → store → router) → break it by importing the router lazily
  inside the 401 handler.
- **Guard vs server**: client gating is UX only; every screen still relies on the server's
  permission checks, so a stale client can't escalate.

## Migration Plan

Frontend-only. Add dev deps (`@vue/test-utils`, `jsdom`); flesh out `stores/auth.ts` and
`api/client.ts`; add `LoginView`, `SelectCompanyView`, `AppShell`, company-switcher + user
menu; expand the router with guards; move the sample form under auth; add `vitest.config.ts`
+ tests. Verify build + tests. Rollback = revert `front-end/` (backend untouched).

## Open Questions

- Should there be a dedicated Forbidden (403) view, or just redirect home on a missing
  route permission? Default: redirect home now; add a Forbidden view when feature routes
  with distinct permissions exist.
- Persist the active company choice per user across logins? Default: rely on the server's
  `is_default`; revisit if users want a sticky last-used company.
