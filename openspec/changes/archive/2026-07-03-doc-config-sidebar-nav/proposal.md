## Why

The Configuration area (`/doc-config`) crams its four sub-areas — Document Types, Form
Templates, Department Mappings, and Workflows — into a single page behind PrimeVue tabs.
As each sub-area has grown (field builder, workflow steps, mappings pagination) the
single-page/tabbed layout is cramped, cannot be linked to directly, and mixes four
distinct workflows in one route. Splitting the tabs into a dedicated Configuration
sub-sidebar gives each area its own URL, a clearer mental model, and room to grow.

## What Changes

- Remove the PrimeVue `Tabs`/`TabList`/`TabPanels` from the Configuration page.
- Introduce a Configuration sub-sidebar (left nav) shown only within the Configuration
  area, listing the four sections: Document Types, Form Templates, Department Mappings,
  Workflows.
- Split each former tab into its own child route under `doc-config` (e.g.
  `doc-config/types`, `doc-config/forms`, `doc-config/mappings`, `doc-config/workflows`),
  each directly linkable. `doc-config` redirects to the first accessible section.
- The main top nav keeps a single **Configuration** entry (unchanged); the four sections
  live in the sub-sidebar, not the top nav.
- Preserve existing permission gating: the Configuration entry and its sections require
  `DOC_CONFIG_MANAGE`; the Workflows section's mutating affordances still require
  `WORKFLOW_MANAGE`.
- **BREAKING** (UX/URL only): the tabbed single-page layout is replaced; any bookmark to
  `/doc-config` still resolves via redirect.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-doc-config`: The Configuration area's navigation requirement changes — the four
  sub-areas are presented as a permission-gated sub-sidebar with per-section routes
  rather than tabs on one page. The four functional requirements (Document Type,
  Form/Field, Department Mapping, Workflow/Step management) are unchanged in behavior;
  only their presentation/navigation surface moves.

## Impact

- Frontend only; no backend, DB, API, or invariant impact.
- `front-end/src/views/admin/DocConfigView.vue` — split into a layout shell plus four
  section views (or extracted section components), tabs removed.
- `front-end/src/router/index.ts` — `doc-config` becomes a parent route with four child
  routes and a redirect.
- `front-end/src/layouts/AppShell.vue` — the top-nav Configuration entry is unchanged;
  the sub-sidebar renders inside the Configuration layout.
- i18n: `admin.docConfig.tabs.*` keys are repurposed as sub-sidebar labels (or renamed).
- Tests: `front-end/src/stores/docConfig.spec.ts` unaffected; smoke test
  (`front-end/src/test/smoke/views.smoke.spec.ts`) and any tab-based assertions updated
  to the new routes.
- No cross-capability invariant is touched: company isolation, permission-code gating,
  and server authority all remain as-is (client nav is UX-only).
