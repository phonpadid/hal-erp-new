## Why

The backend is feature-complete, but the frontend is only the Vite/PrimeVue scaffold plus
a sample form and stub `auth` store / `api` client. Nothing can actually log in, hold a
company context, or gate the UI. This change builds the **application shell**: real
authentication against the rbac auth API, company-context selection/switching, JWT-aware
API calls with 401 handling, session persistence across reloads, and route + nav gating by
permission code. It is the foundation every later screen (documents, approvals, budgets)
builds on.

## What Changes

- **New capability `web-shell`** — the Vue application shell.
- **Authentication**: a Login view (username/password) validated by the shared
  `loginSchema` (`@erp/shared` + `@primevue/forms` zodResolver) calling `POST /auth/login`.
  On a default company the returned token is stored and the user lands on the home route;
  otherwise the accessible companies are presented for selection.
- **Company context**: a header company switcher; selecting a company calls
  `POST /auth/switch-company`, which re-issues the token; the session's permissions are then
  refreshed. The active company drives every request.
- **Session hydration**: after login/switch and on app reload the shell calls
  `GET /auth/me` to populate `{ userId, companyId, departmentId, permissions }` (permission
  codes derived from the token's grants) — `/auth/me` is the single source of context, so
  permissions never go stale. The token (+ active company) persists in `localStorage`.
- **API auth & 401 handling**: the axios client attaches the company-context JWT to every
  request; a 401 response clears the session and redirects to Login.
- **Routing & permission-gated UI**: a global guard redirects unauthenticated users to
  Login; routes may declare a required permission (`meta.permission`) and the nav shows only
  affordances the active company grants (`can(code)` / `v-can`) — UX only; the server still
  enforces.
- **Authenticated layout**: a shell (top bar with company switcher, user menu/logout, dark
  toggle, permission-gated nav) wrapping the routed views; the existing sample company form
  is moved behind auth as the first real screen.
- **Frontend test setup**: Vitest + `@vue/test-utils` + jsdom for the front-end package,
  with unit tests for the auth store and the route-guard logic.

## Capabilities

### New Capabilities
- `web-shell`: the Vue app shell — authentication, company-context selection, session
  persistence, JWT/401 handling, and route/permission gating.

### Modified Capabilities
<!-- None. -->

## Impact

- **Affected**: `front-end/` only — no backend change. Consumes existing rbac endpoints
  (`/auth/login`, `/auth/switch-company`, `/auth/me`).
- **Invariants reflected on the client**: 5 (gate UI by permission **code**, never role
  name) and 1 (all calls carry the active-company token) — the client guard is UX only; the
  server remains authoritative.
- **Code**: real `stores/auth.ts` (login/switch/refresh/logout + persistence),
  `api/client.ts` (request + response interceptors), `router` (guard + routes), new
  `LoginView`, `AppShell` layout, company switcher + user menu components; Vitest config +
  tests.
- **New dependencies (dev)**: `@vue/test-utils`, `jsdom` (Vitest is already in the repo).
- **Env**: `VITE_API_URL` (already referenced) points the client at the backend.

## Out of Scope

- Feature screens beyond the shell (document create/submit, approval inbox, budget
  dashboards) — follow-up `web-*` changes.
- Refresh-token rotation / silent renewal — the access token is used until it expires or a
  401 forces re-login.
- i18n, theming beyond the existing light/dark toggle, and real-time (WebSocket) updates.
