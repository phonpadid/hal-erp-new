## Why

The app currently uses a minimal `AppShell` (a header + nav buttons). A richer layout has been
placed in `front-end/src/layouts` + `front-end/src/styles` — a topbar / collapsible sidebar /
menu / theme configurator / footer (PrimeVue "Sakai"-style), with a per-user **settings** layer
(theme preset, primary colour, surface, dark mode, menu mode, and locale) that the layout store
already syncs to a backend endpoint (`GET`/`PUT /user/setting`, partial upsert with debounced
auto-save). This change adopts that layout as the app shell and builds the backend that persists
each user's preferences — so a user's chosen colours/mode/language follow them across sessions and
devices.

The layout store, theme composable, and settings service are written and assume: `vue-i18n`
(menu labels + locale), `sass` (the `.scss` layout styles), an `@/` import alias, and a
`/user/setting` API returning `{ data: <setting> }`. None of those exist yet, and there is no
table for UI preferences in the DBML — so this change wires the frontend dependencies and adds a
new `user_setting` table + endpoint.

## What Changes

- **New capability `user-preferences`** (backend): a `user_setting` table (one row per user) and
  `GET` / `PUT /user/setting` — read the signed-in user's settings (defaults when none), and
  upsert a partial patch (`preset`, `primary`, `surface`, `dark_theme`, `menu_mode`, `locale`).
  Identified by the JWT; a user can only read/write their own. Responses are `{ data: <setting> }`
  to match the placed service.
- **New capability `web-app-layout`** (frontend): adopt the placed layout as the shell —
  - topbar (logo, menu toggle, locale switch, dark-mode toggle, theme configurator, profile/
    logout) + the active-company switch and the notification bell folded in;
  - collapsible sidebar driven by a **permission-gated ERP menu** (Documents, Approvals, Budgets,
    Quota, Master data, Access, Configuration) — the placed store's sample menu is replaced with
    our nav, each item gated by its permission code;
  - the theme **configurator** (preset / primary / surface / menu mode) and **dark-mode** toggle;
  - **persistence**: on session restore the user's settings load from the backend and apply the
    theme + locale; changes auto-save (debounced, partial diff) — all already implemented in the
    placed store, now wired to the real API.
- **Frontend deps & wiring**: add `vue-i18n` (minimal `la`/`en` messages for the shell) and
  `sass`; add the `@/` → `src` alias (vite + vitest + tsconfig); register the PrimeVue
  `StyleClass` directive + `ToastService`; import the layout `.scss`; point the placed
  `setting.service` at the existing API client.
- **Replace** the old `AppShell` usage in the router with the new `AppLayout`; existing views,
  routes, guards, and the auth/active-company logic are unchanged.
- **Tests**: backend `user_setting` (defaults, partial upsert, own-by-token); frontend tests for
  the settings partial-diff/auto-save logic and the permission-gated menu.

## Capabilities

### New Capabilities
- `user-preferences`: per-user UI settings persistence (theme + locale), read/written by the
  owning user via `/user/setting`.
- `web-app-layout`: the Vue application shell — topbar/sidebar/menu/configurator, permission-gated
  navigation, theme + locale switching, and per-user settings sync.

## Impact

- **Schema**: adds one `user_setting` table (a UI-preferences table, outside the core
  approval/budget/quota domain) + a migration. No change to existing tables or invariants.
- **Affected**: `back/src/modules/user-preferences/*` (new module), `back/src/app.module.ts`
  (register), a migration; `front-end/` (layout adoption, i18n, deps, alias, router/main wiring),
  retiring `AppShell` from the router.
- **Invariants reflected**: 5 (the sidebar menu is gated by permission codes; the settings API is
  per-user by token). The settings table is not company-scoped — preferences are per *user*, not
  per company (a user keeps one theme across companies).
- **New dependencies**: `vue-i18n`, `sass` (frontend).

## Out of Scope

- Full per-screen translation — i18n covers the shell (nav/topbar/common) only; screen bodies
  stay as-is.
- Theme changes for users other than yourself (no admin-manages-others settings).
- Server-driven menu/permissions beyond the existing permission codes; the menu is defined in the
  client and filtered by `can()`.
- The Lao web-font asset wiring beyond a graceful fallback if the font file is absent.
