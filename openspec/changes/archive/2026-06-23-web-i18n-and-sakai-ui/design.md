## Context

The front-end already runs on Vue 3 + PrimeVue 4 (Aura, `.dark` selector) + Tailwind +
`tailwindcss-primeui`, with a sakai-vue–derived shell ported into `front-end/src/layouts/`
(`AppLayout`, `AppTopbar`, `AppSidebar`, `AppMenu`, `AppConfigurator`, `AppFooter`) and the sakai
SCSS under `front-end/src/styles/layout/`. `vue-i18n` is installed and wired in `main.ts`, the
configurator + topbar already switch locale, and the layout store auto-saves the chosen locale to
the `user-preferences` backend.

Two gaps remain. **(1) i18n is shell-only:** `front-end/src/i18n/index.ts` defines ~13 inline
nav/topbar keys for `la`/`en`, the `la` strings are corrupted (mixed Thai/Lao), and none of the 18
views call `$t()`. **(2) Visual consistency is partial:** in-app pages don't share a sakai page
layout, and `/` routes to `MyDocumentsView` with no landing dashboard, unlike the sakai reference
which opens on a stats/charts `Dashboard.vue`.

This change is purely presentation-layer; no backend, DTO, entity, or DBML change.

## Goals / Non-Goals

**Goals:**
- Every authenticated page and shared component renders all user-facing text via `vue-i18n` — no
  hardcoded display strings in templates (titles, table headers, status labels, buttons, empty
  states, dialogs, toasts, form labels/validation messages).
- Complete, namespaced `la` and `en` catalogs (`la` default, `en` fallback); corrupted Lao fixed.
- Live locale switching re-renders all pages without reload (already wired) and is persisted.
- Locale-aware date/number formatting helpers; money still rendered by currency `decimal_places`.
- All in-app pages adopt one shared sakai page layout (page header + card containers + PrimeUI
  tokens), looking correct in light and dark mode.
- A permission-gated home Dashboard with sakai-style stat-card + chart widgets for the active
  company; `/` routes to it.

**Non-Goals:**
- No backend/API/DTO/entity/DBML changes; no new domain capability.
- No new business logic or data — the dashboard reads existing endpoints only.
- Not importing sakai's demo pages (uikit/utilities/landing/auth mockups) or its mock data services.
- No translation of server-originated dynamic data (company names, document type labels, user
  content) — only the app's own UI chrome is localized.

## Decisions

### D1 — i18n catalog structure: per-locale files with nested namespaces
Replace the single inline `messages` object with `front-end/src/i18n/locales/{la,en}.ts` (or
`.json`) imported by `index.ts`, organized by namespace mirroring the view tree:
`common.*` (save/cancel/confirm/loading/empty/yes-no), `nav.*`, `topbar.*`, plus one namespace per
feature area (`documents.*`, `approvals.*`, `budgets.*`, `quota.*`, `master.*`, `admin.*`,
`notifications.*`, `auth.*`, `dashboard.*`, `validation.*`).
- *Why:* keeps `index.ts` small, lets each catalog be edited per area, and namespacing avoids key
  collisions across 18 views. *Alternative considered:* one flat file — rejected, becomes
  unmanageable at full coverage and invites duplicate/colliding keys.
- Keep `legacy: false` (Composition API). Views use `const { t } = useI18n()` in `<script setup>`
  and `$t('...')` in templates.

### D2 — `la` stays default, `en` fallback; missing-key safety
Preserve current `locale: 'la'`, `fallbackLocale: 'en'`. The two catalogs MUST be key-complete
(same key set). Enforce parity with a small unit test that asserts the `la` and `en` key sets are
identical, so a string added to one locale can't silently fall through.
- *Why:* Lao-first product; catching drift in CI is cheaper than spotting it in the UI.

### D3 — Localized formatting via i18n number/datetime formats
Use `vue-i18n` `numberFormats`/`datetimeFormats` per locale for dates and plain counts; keep money
formatting in the existing currency helper driven by `decimal_places`, exposed through a composable
(e.g. `useFormat()`) so views never call `Intl` ad hoc or coerce money to a JS number.
- *Why:* upholds the money invariant and keeps formatting consistent. *Alternative:* per-view
  `Intl` calls — rejected (drift, and risks numeric money).

### D4 — Shared sakai page layout via a wrapper, not copy-paste
Introduce a small presentational wrapper (e.g. `PageHeader` + a `card`-class container convention
matching sakai) that every view uses for its title/actions/body, instead of each view styling its
own header. Tables, tags, and empty states standardize on PrimeVue + PrimeUI tokens.
- *Why:* guarantees visual consistency and dark-mode correctness from one place; minimizes diff per
  view. *Alternative:* restyle each view independently — rejected (drift, repeated work).

### D5 — Dashboard composed from existing endpoints, permission-gated per widget
New `front-end/src/views/DashboardView.vue` + widget components under
`front-end/src/components/dashboard/`. `/` (`home`) routes to it. Each widget is gated by the same
permission code as its underlying feature (e.g. a pending-approvals widget shows only with
`DOC_APPROVE`); a user seeing no widgets still gets a valid empty dashboard. Charts use PrimeVue's
`Chart` (Chart.js, already a PrimeVue dependency) themed with PrimeUI tokens.
- *Why:* no new backend; reuses the active-company-scoped data already available. *Alternative:*
  add dashboard-summary endpoints — rejected as out of scope (would pull in backend capabilities).

### D6 — String externalization is mechanical and verifiable
Sweep each view, moving literals into the matching namespace. Guard against regressions with a lint
rule / test that flags non-whitespace literal text in view templates (allowing an explicit
`i18n-ignore` escape hatch for genuinely non-translatable tokens like codes/symbols).

## Risks / Trade-offs

- **Large, broad diff across all 18 views** → sequence by feature area (one area per task), each
  area independently reviewable; the `PageHeader` wrapper keeps per-view churn small.
- **Lao translation completeness/quality (corrupted existing strings)** → fix known-bad keys first;
  the key-parity test (D2) guarantees coverage even if some Lao copy needs later polish; `en`
  fallback prevents blank UI.
- **Missing-key blank strings at runtime** → key-parity test + non-default `fallbackLocale` ('en').
- **Dashboard widget loading many endpoints on home** → load widgets independently with per-widget
  loading/empty/error states; never block the whole dashboard on one slow call.
- **Permission-gating drift on new widgets** → reuse the existing `v-can` directive / permission
  helper used by the sidebar, not bespoke checks.

## Migration Plan

1. Restructure i18n (catalogs + formatting composable) with `la`/`en` parity test — no UI behavior
   change yet.
2. Land the shared `PageHeader`/card convention; migrate views area-by-area (strings + layout) in
   reviewable batches.
3. Add `DashboardView` + widgets; switch `/` to the dashboard last.
- **Rollback:** presentation-only and incremental; revert the offending batch. Switching `/` back
  to `MyDocumentsView` is a one-line router revert if the dashboard needs to be pulled.

## Open Questions

- Which summary widgets make the v1 dashboard (pending approvals, my open documents, budget
  utilization, recent notifications)? Final set to be confirmed during implementation against
  available endpoints.
- Do we want a per-locale font tweak for Lao legibility, or is the current theme font sufficient?
