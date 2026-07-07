## Context

The placed layout (`front-end/src/layouts`, `front-end/src/styles`) is a PrimeVue "Sakai"-style
shell: `AppLayout` (topbar+sidebar+content+footer+Toast), `AppTopbar`, `AppSidebar`, `AppMenu`,
`AppMenuItem`, `AppConfigurator`, plus `store/layout.store.ts`, `composables/{layout,useTheme}.ts`,
`types/{layout.type,setting.dto}.ts`, `services/setting.service.ts`. The store already implements
load-from-backend, apply-theme, and debounced partial-diff auto-save against `GET`/`PUT
/user/setting` returning `{ data: <setting> }`. It depends on things not yet present: `vue-i18n`
(`useI18n`, `$t`), `sass`, an `@/` alias, `@/shared/services/api`, `@/modules/identity/composables/
useAuth`, the PrimeVue `StyleClass` directive (`v-styleclass`), and global `Toast`/`SelectButton`.
The DBML has no UI-preferences table. The existing app has: `api/client.ts` (axios, bearer + 401),
`stores/auth.ts` (login/restore/logout/selectCompany/can), `NotificationBell.vue`, and a router
that wraps children under the old `AppShell`.

## Goals / Non-Goals

**Goals**
- Persist per-user settings: `user_setting` table + `GET`/`PUT /user/setting` (own, by token,
  partial upsert, `{ data }` shape).
- Adopt the placed layout as the shell; ERP permission-gated menu; theme + locale switch; settings
  sync on restore + auto-save.
- Wire deps (`vue-i18n` la/en, `sass`), `@/` alias, StyleClass/Toast, and the API shim.

**Non-Goals**
- Full per-screen i18n, admin-edits-others settings, server-driven menus, web-font sourcing.

## Decisions

### D1 — Backend `user_setting` (new table)
Entity `UserSetting`: `user` (one-to-one / unique FK → `app_user`, primary key by user id),
`preset`, `primary`, `surface` (text), `darkTheme` (bool), `menuMode` (text), `locale` (text),
`updatedAt`. Not `CompanyScopedEntity` — preferences are per user, across companies. Generate a
migration. `UserSettingService`: `getForUser(userId)` → row or the defaults (preset Aura / primary
yellow / surface stone / darkTheme false / menuMode static / locale la); `upsertForUser(userId,
patch)` → create-or-update only provided keys. `UserSettingController` `@Controller('user')`,
`JwtAuthGuard`, no special permission (own data by `req.user.userId`): `GET setting` → `{ data }`,
`PUT setting` → `{ data }`. Register in `app.module`. *Alternative (JSONB on app_user)* was
rejected by the user in favour of a typed table.

### D2 — Frontend dependencies & config
Add `vue-i18n` and `sass` (dev). Add `@` → `src` alias in `vite.config.ts`, `vitest.config.ts`,
and `tsconfig.app.json` `paths` (alongside the existing `@erp/shared` alias). Create
`src/shared/services/api.ts` that re-exports the existing `api/client` as `default` so the placed
`setting.service`'s `import api from "@/shared/services/api"` works unchanged (it uses
`api.get/.put` and reads `res.data.data`).

### D3 — i18n (minimal la/en)
`src/i18n/index.ts` with `createI18n({ legacy:false, locale:'la', fallbackLocale:'en' })` and
message dicts covering the shell: the ERP nav labels, `profile`, `logout`, and any topbar/common
keys. Registered in `main.ts` before the store is used (the store calls `useI18n()` at setup).
`locale` is part of the saved setting; switching it triggers the store's `watch(locale)` →
auto-save.

### D4 — Replace the menu model with ERP nav (permission-gated)
Rewrite `layout.store`'s `model` to our nav, built from a static list of
`{ key, icon, to, permission }` mapped through `t()` and filtered by `useAuthStore().can(permission)`:
Documents (`DOC_VIEW`), Approvals (`DOC_APPROVE`), Budgets (`BUDGET_VIEW`), Quota (`QUOTA_VIEW`),
Master data (`MASTER_VIEW`), Access (`RBAC_MANAGE`), Configuration (`DOC_CONFIG_MANAGE`). The
sample vet/POS menu is removed. `model` stays a computed so it reacts to locale and active-company
grants.

### D5 — Topbar integration (auth, company, notifications)
Rewrite `AppTopbar`'s `useAuth` import to our `stores/auth` (`logout`), and fold in the
active-company `Select` (from `auth.companies` / `selectCompany`) and `<NotificationBell>` (shown
when `can('NOTIFICATION_VIEW')`) beside the locale/theme actions — preserving the placed visual
structure. Add the missing explicit component imports (`SelectButton`, `Toast`) and register the
`StyleClass` directive + `ToastService` globally in `main.ts`.

### D6 — Shell wiring & router
`main.ts`: `app.use(i18n)`, `app.use(ToastService)`, `app.directive('styleclass', StyleClass)`,
import `./styles/main.css` + `./styles/layout/layout.scss`. The router's `/` route uses `AppLayout`
(instead of `AppShell`) wrapping the existing children; guards/`meta.permission` unchanged. After
`auth.restore()` resolves (and after login), call the layout store's `loadUserSetting()` so the
saved theme/locale apply before/at first paint; the store's existing autosave handles the rest.
`AppShell.vue` is retired from the router (left in tree or removed).

### D7 — Styling reconciliation
The placed `styles/main.css` uses Tailwind v4 directives (`@import "tailwindcss"`,
`@custom-variant`); the current `style.css` uses v3 (`@tailwind base`). Keep whichever matches the
installed Tailwind major: import the layout `.scss` (chrome) regardless, and use the existing
Tailwind entry for utilities; only adopt `main.css`'s non-Tailwind bits (font-face fallback,
helpers) if Tailwind is v4. Verified at apply. PrimeVue theme runtime: the composable uses
`@primeuix/themes` (transitive via `@primevue/themes`); add it explicitly if it doesn't resolve.

## Risks / Trade-offs

- **Breadth & new deps** — vue-i18n + sass + alias touch app bootstrap; mitigated by keeping
  existing views/routes/guards untouched and adding the i18n/alias alongside current config.
- **Store calls `useI18n()` at setup** — i18n must be installed before any layout store use; the
  store is only used inside the shell (mounted after `app.use(i18n)`), so ordering holds.
- **Tailwind version mismatch** (D7) — handled by importing the scss chrome and not blindly
  swapping the Tailwind entry; verified during apply.
- **Font asset** — `main.css` references a Lao font file that may be absent; the `@font-face`
  falls back to sans-serif, so it degrades gracefully (no asset shipped here).

## Migration Plan

Backend: add `UserSetting` entity + module, generate the migration (throwaway pg), wire into
`app.module`, apply to `new_erp`; test. Frontend: install `vue-i18n` + `sass`; add `@` alias + the
api shim + i18n; integrate topbar/menu; switch the router to `AppLayout`; wire `main.ts`. Run
`pnpm -r build` + both suites; `openspec validate web-app-layout --type change --strict`. Rollback
= revert the module/migration and the `front-end/` wiring (the placed layout files can stay).

## Open Questions

- Keep `AppShell.vue` as a fallback or delete it? Default: leave the file but route through
  `AppLayout`; remove later if unused.
- Default locale `la` vs `en`? Default `la` per the placed `defaultUserSetting`; overridden by the
  user's saved setting once set.
