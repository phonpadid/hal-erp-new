## 1. Backend: user_setting (user-preferences)

- [x] 1.1 `UserSetting` entity: `user` (unique FK → app_user, the identity), `preset`, `primary`, `surface` (text), `darkTheme` (bool), `menuMode` (text), `locale` (text), `updatedAt`. Not company-scoped.
- [x] 1.2 Generate a migration for `user_setting` and apply it.
- [x] 1.3 `UserSettingService`: `getForUser(userId)` → row mapped to the DTO, or the defaults (Aura/yellow/stone/false/static/la) when none; `upsertForUser(userId, patch)` → create-or-update only provided keys; bump `updatedAt`.
- [x] 1.4 `UserSettingController` (`@Controller('user')`, `JwtAuthGuard`, own data by `req.user.userId`): `GET setting` → `{ data }`; `PUT setting` (partial body) → `{ data }`. Register the module in `app.module`.
- [x] 1.5 Backend test (DB-backed): GET with no row returns defaults; PUT `{ primary, darkTheme }` creates the row; a second PUT `{ locale }` leaves primary/darkTheme intact (partial); reads/writes are scoped to the token's user.

## 2. Frontend: dependencies & config

- [x] 2.1 Add `vue-i18n` and `sass` (dev) to `front-end`; install from the workspace root.
- [x] 2.2 Add the `@` → `src` alias to `vite.config.ts`, `vitest.config.ts`, and `tsconfig.app.json` `paths` (alongside `@erp/shared`).
- [x] 2.3 `src/shared/services/api.ts`: re-export the existing `api/client` as `default` (so the placed `setting.service` resolves `@/shared/services/api`).
- [x] 2.4 `src/i18n/index.ts`: `createI18n({ legacy:false, locale:'la', fallbackLocale:'en' })` with `la`/`en` messages for the shell (nav labels + profile/logout/common).

## 3. Frontend: layout integration

- [x] 3.1 Replace `layout.store` `model` with the ERP nav built from `{ key, icon, to, permission }` → `t()` + filtered by `useAuthStore().can(permission)`: Documents/Approvals/Budgets/Quota/Master data/Access/Configuration.
- [x] 3.2 `AppTopbar`: point logout at `stores/auth`; fold in the active-company `Select` (`auth.companies`/`selectCompany`) and `<NotificationBell>` (when `can('NOTIFICATION_VIEW')`); add explicit `SelectButton` import.
- [x] 3.3 Fix remaining `@/...` imports in the placed layout files to resolve (alias) and remove references to non-existent modules.

## 4. Frontend: wiring & router

- [x] 4.1 `main.ts`: `app.use(i18n)`, `app.use(ToastService)`, `app.directive('styleclass', StyleClass)`; import `./styles/main.css` + `./styles/layout/layout.scss` (reconcile Tailwind version per design D7); add `@primeuix/themes` if it doesn't resolve.
- [x] 4.2 Router: route `/` through `AppLayout` wrapping the existing children; keep guards + `meta.permission`. Retire `AppShell` from the router.
- [x] 4.3 After `auth.restore()` (and post-login), call the layout store `loadUserSetting()` so the saved theme/locale apply; the store's debounced auto-save persists subsequent changes.

## 5. Frontend tests

- [x] 5.1 Settings persistence logic: the store's partial-diff `saveUserSetting` sends only changed fields and no request when nothing changed (mock `setting.service`); `loadUserSetting` applies returned values and falls back on error.
- [x] 5.2 Permission-gated menu: the `model` excludes entries whose permission the user lacks and includes those they hold (mock auth `can`).

## 6. Verify

- [x] 6.1 `pnpm --filter back build` + `pnpm --filter back test`, `pnpm --filter front-end build` + `pnpm --filter front-end test` pass; backend migration applies to `new_erp`.
- [x] 6.2 Run `openspec validate web-app-layout --type change --strict`.
