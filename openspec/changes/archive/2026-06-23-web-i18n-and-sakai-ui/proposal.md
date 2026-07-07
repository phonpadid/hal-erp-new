## Why

The web app already ships a sakai-vue–derived shell (topbar/sidebar/configurator), but the
adoption is half-finished: in-app pages don't share a consistent sakai-style page layout, there is
no landing dashboard, and **i18n covers only the nav/topbar (~13 keys) while all 18 views render
hardcoded strings** — 0 of 18 views call `$t()`, and the existing `la` catalog has corrupted
mixed Thai/Lao text. A Lao-first product cannot ship with English-only screens, so localization and
visual consistency need to be completed across every page.

## What Changes

- **Complete i18n across every authenticated page.** Externalize all user-facing strings in the 18
  views, shared components, form labels/validation messages, table headers, status tags, empty
  states, toasts, and dialogs. No hardcoded display text remains in templates.
- **Restructure i18n catalogs.** Replace the single inline `messages` object with per-locale,
  namespaced catalogs (`la`, `en`); fix the corrupted Lao strings; keep `la` default / `en`
  fallback. Locale switch re-renders all pages live (already wired to auto-save).
- **Locale-aware formatting helpers.** Centralize date/number formatting through i18n (money still
  rendered by the currency's `decimal_places`, never as a JS number).
- **Adopt the sakai page layout on every in-app page.** Consistent page header, card containers,
  spacing, and PrimeUI design tokens so the existing views (documents, approvals, budgets, quota,
  master data, admin screens, notifications) match the sakai look in both light and dark mode.
- **Add a sakai-style Dashboard as the home page.** Stat-card widgets and charts summarizing the
  active company (e.g. pending approvals, my documents, budget utilization), permission-gated, with
  `/` routing to the dashboard instead of the document list.

This is a **frontend-only, presentation-layer** change. No backend endpoints, entities, DTOs,
budget/quota logic, or the DBML are touched.

## Capabilities

### New Capabilities
- `web-i18n`: Full localization of the web application — every authenticated page and shared
  component renders its UI text through the i18n layer, with complete `la` and `en` catalogs, live
  locale switching, and locale-aware date/number formatting.

### Modified Capabilities
- `web-app-layout`: Add a requirement that all in-app pages adopt the shared sakai page layout
  (consistent page header + card structure + PrimeUI tokens), and add a permission-gated home
  Dashboard with summary widgets. (Existing shell/theme/locale/settings-sync requirements are
  unchanged.)

## Impact

- **Affected capabilities (of the 9 build-order capabilities):** none of the backend domain
  capabilities — this touches only the web presentation layer that sits on top of them.
- **Code:** `front-end/src/i18n/**` (restructured catalogs + formatting helpers), all
  `front-end/src/views/**` and shared components/forms (string externalization + sakai layout),
  `front-end/src/router` (home → dashboard), a new `DashboardView` and dashboard widget components.
- **Invariants:** No core invariant is at risk. Money continues to be rendered via
  `decimal_places` and never as a JS number; permission-code gating (UX-only) is preserved on
  navigation and the new dashboard widgets; no company data crosses companies (dashboard reads the
  active company only).
- **Dependencies:** No new runtime dependencies expected (`vue-i18n` and PrimeVue charts are
  already available); confirm during design.
