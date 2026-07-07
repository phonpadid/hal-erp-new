## Why

In-app pages have inconsistent horizontal width. Each view hardcodes its own
`max-w-*` + `mx-auto` (`max-w-7xl` on the dashboard, `5xl` on lists, `4xl` on
details, `3xl`/`xl` on forms), so `/` looks almost full-screen while other routes
appear inset with uneven left/right gutters. Page content also leans on bare text and
plain `.card` divs (e.g. summary grids, empty messages) instead of PrimeVue panel
components, so grouping reads flat and varies page to page.

## What Changes

- **Single content region, full-width.** Apply the content width/centering once in
  the shell (`.layout-main` / a shared page container) and remove the per-view
  `max-w-* mx-auto` wrappers. In-app pages render full-width within the existing
  container padding so horizontal gutters are identical across every route.
  Public full-screen pages (`login`, `select-company`) are unaffected.
- **Panel components for grouping.** Replace bare-text / plain-`.card` grouping with
  appropriate PrimeVue panel components across all in-app views as appropriate:
  `Card`, `Panel`, `Fieldset`, `Divider`, `Accordion`, `ScrollPanel`, `Splitter`. The
  shared `SectionCard` is re-backed by a real PrimeVue panel so every detail/section
  inherits consistent, theme-aware chrome.
- All component labels stay in i18n (en/la parity) and use PrimeUI theme tokens only
  (light/dark both work) — no hardcoded colors.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-app-layout`: tighten *Consistent Page Layout* to mandate a single,
  centrally-applied full-width content region (no per-page width), and that section
  grouping uses shared PrimeVue panel components rather than bare text or ad-hoc
  `.card` divs.

## Impact

- Code (frontend only): `front-end/src/layouts/AppLayout.vue` and
  `src/styles/layout/_main.scss` (content region); the shared kit
  (`SectionCard.vue`, and grouping in `DetailHeader`/section usage); and every view
  under `src/views/**` that currently sets `max-w-*`/bare text
  (~18 views).
- No backend, API, DB, or permission change. Permission-gated visibility is unchanged.
- Risk surface is visual/responsive regression; covered by the existing component and
  layout tests plus dark-mode check.
