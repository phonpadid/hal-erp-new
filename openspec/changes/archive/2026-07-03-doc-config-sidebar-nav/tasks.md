## 1. Routing

- [x] 1.1 In `front-end/src/router/index.ts`, replace the single `doc-config` leaf with a
  redirect route `{ path: 'doc-config', redirect: { name: 'doc-config-types' } }`.
- [x] 1.2 Add four sibling routes — `doc-config/types`, `doc-config/forms`,
  `doc-config/mappings`, `doc-config/workflows` — each with
  `meta: { permission: 'DOC_CONFIG_MANAGE' }` so the existing `router.beforeEach` guard
  keeps enforcing access.
- [x] 1.3 Confirm named routes are unique and update any `router.push({ name: 'doc-config' })`
  callers (the redirect handles landing on the first section).

## 2. Sidebar entries (existing NAV model)

- [x] 2.1 In `front-end/src/layouts/store/layout.store.ts`, add a `configuration` entry to
  `NAV_SECTIONS` (placed after `administration`).
- [x] 2.2 Replace the single `configuration` `NAV` entry with four entries in the
  `configuration` section pointing at the four routes, each `permission: 'DOC_CONFIG_MANAGE'`.
- [x] 2.3 Add the matching i18n labels in `nav.ts` (en + la): `sections.configuration`
  plus the four entry keys; remove the now-unused `configuration` key.

## 3. Extract section views from the tabs

- [x] 3.1 Create `doc-config/DocTypesView.vue` from the Document Types tab (list, new/edit
  dialogs), owning its transient state (filters, dialog refs).
- [x] 3.2 Create `doc-config/FormTemplatesView.vue` from the Forms tab (template list, field
  builder, `formsTypeId`/`formsTemplateId` selection state moved here).
- [x] 3.3 Create `doc-config/DeptMappingsView.vue` from the Mappings tab (paged table + new
  mapping dialog, `mapTypeId` state moved here).
- [x] 3.4 Create `doc-config/WorkflowsView.vue` from the Workflows tab (list, new-workflow /
  add-step dialogs), keeping `WORKFLOW_MANAGE` gating on mutating affordances.
- [x] 3.5 Each section calls only the store slice it needs on mount (avoid redundant
  `loadAll()` re-fetches); keep using the shared `useDocConfigStore`.
- [x] 3.6 Delete the old `DocConfigView.vue` (with its `Tabs`/`TabList`/`TabPanels`
  markup) once fully superseded by the four section views.

## 4. i18n

- [x] 4.1 Rename `admin.docConfig.tabs.*` → `admin.docConfig.nav.*` (used as each section
  view's page title) in both `en` and `la` locale files; update references.

## 5. Tests & verification

- [x] 5.1 Update `front-end/src/test/smoke/views.smoke.spec.ts` and any route/tab-based
  assertions to the new child routes.
- [x] 5.2 Add/adjust a test asserting `doc-config` redirects to the first permitted section
  and that a user without `DOC_CONFIG_MANAGE` is blocked from a section route.
- [x] 5.3 Verify `docConfig.spec.ts` still passes unchanged (store untouched).
- [x] 5.4 Run the frontend build/lint and manually confirm each section loads, deep-links,
  and renders correctly in light and dark mode.
