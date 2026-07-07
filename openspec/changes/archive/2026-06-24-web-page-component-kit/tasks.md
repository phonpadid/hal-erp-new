## 1. Page-component kit

- [x] 1.1 Add `front-end/src/components/PageToolbar.vue` — wraps PrimeVue `Toolbar`; `v-model:search` global field via `IconField` + `InputText`; `#filters`, `#bulk`, `#actions` slots; `#bulk` only rendered when a `selectionCount > 0` prop is truthy; theme tokens only.
- [x] 1.2 Add `front-end/src/components/EmptyState.vue` — `icon` + `title` + `message` props and an optional default/`#action` slot for a CTA; centered, muted, theme-token styling.
- [x] 1.3 Add `front-end/src/components/ErrorState.vue` — `message` prop, `pi pi-exclamation-triangle` icon, and a `retry` emit wired to a `Button`.
- [x] 1.4 Add `front-end/src/components/TableSkeleton.vue` — `columns` and `rows` props rendering sakai-style `Skeleton` placeholder rows.
- [x] 1.5 Add `front-end/src/components/DetailHeader.vue` — `title`/`subtitle` + `status` + `statusSeverity` props rendering a `Tag`; `#actions` slot; reuses `PageHeader` layout conventions.
- [x] 1.6 Add `front-end/src/components/SectionCard.vue` — titled `.card` section with `title` prop and default slot for body content.
- [x] 1.7 Add `front-end/src/components/FormStepper.vue` — wraps PrimeVue `Stepper`/`StepList`/`StepItem`/`StepPanels`; takes a `steps` definition, exposes per-step `#step-<key>` slots, and a `validateStep` hook that blocks "Next"/submit until the step is valid.
- [x] 1.8 Add `front-end/src/components/EventTimeline.vue` — wraps PrimeVue `Timeline`; `events` prop of `{ icon, severity, title, subtitle, at, body }`; status-coloured markers via theme tokens; renders `EmptyState` when `events` is empty.
- [x] 1.9 Add a `fieldComponent(fieldType)` map (e.g. `front-end/src/utils/formFields.ts`): `text`→`InputText`, `number`/`date`→typed `InputText`, `textarea`/`long_text`→`Textarea` (`autoResize`), `richtext`/`html`→`primevue/editor` `Editor` (`editorStyle="height: 320px"`). Add `quill` to the frontend deps if missing.

## 2. i18n

- [x] 2.1 Add `components.toolbar.*` (search placeholder, clear filters) and `components.state.*` (default empty title, default error title, retry) keys to `front-end/src/i18n/locales/en/**`.
- [x] 2.2 Mirror the same keys in `front-end/src/i18n/locales/la/**`; run `i18n.parity.spec.ts` and `no-literal-text.spec.ts` to confirm parity and no hardcoded strings.

## 3. Component tests

- [x] 3.1 Unit-test `PageToolbar` — search `v-model`, slot rendering, and `#bulk` hidden/shown by `selectionCount`.
- [x] 3.2 Unit-test `EmptyState` / `ErrorState` (renders message, emits `retry`) and `TableSkeleton` (renders `columns × rows`).
- [x] 3.3 Unit-test `DetailHeader` status tag + severity mapping and `SectionCard` title/slot.
- [x] 3.4 Unit-test `FormStepper` step gating (cannot advance with invalid required fields) and `EventTimeline` (renders events; empty → `EmptyState`).
- [x] 3.5 Unit-test `fieldComponent` map resolves each field type to the expected control.

## 3b. Sidebar grouping

- [x] 3b.1 Add a `section` key to each `NAV` entry in `front-end/src/layouts/store/layout.store.ts` (Workspace, Budget & Quota, Master Data, Administration) and build `model` as ordered `{ label, items }` sections, dropping any section with no visible entries.
- [x] 3b.2 Add `nav.sections.*` i18n keys (en + la); update `layout.store.spec.ts` to assert grouping and empty-section omission.

## 4. Adopt the kit in list views

- [x] 4.1 Budgets — `BudgetListView` uses `PageToolbar` (search + create gated by existing code), `TableSkeleton` while loading-empty, `EmptyState` in DataTable `#empty`, `ErrorState` on store error with retry.
- [x] 4.2 Documents — `MyDocumentsView`: same pattern; keep `DOC_CREATE` gating on the toolbar action.
- [x] 4.3 Approvals — `ApprovalInboxView`: same pattern; bulk-approve `#bulk` slot only if a store bulk action exists, gated by the existing approve code.
- [x] 4.4 Quota — `QuotaListView`: same pattern.
- [x] 4.5 Master data — `MasterDataView`: same pattern for each table region.
- [x] 4.6 Notifications — `NotificationInboxView`: same pattern.
- [x] 4.7 Admin — `OrgAdminView`, `RbacAdminView`, `DocConfigView`, `ApprovalConfigView`, `CurrencyAdminView`: toolbar + states per list region, preserving each view's permission gating.

## 5. Adopt the kit in detail views

- [x] 5.1 `DocumentDetailView` uses `DetailHeader` (doc no + status tag) and `SectionCard` for each information group; sections use `ErrorState`/`TableSkeleton` where they load data.
- [x] 5.2 `DocumentDetailView` approval history renders via `EventTimeline` (status marker + actor + time + remark) instead of the `DataTable`.
- [x] 5.3 `BudgetDetailView` and `QuotaDetailView` use `DetailHeader` + `SectionCard` consistently (and `EventTimeline` for any history regions).

## 5b. Stepper + input controls

- [x] 5b.1 Convert `CreateDocumentView` to `FormStepper` (header → dynamic fields → line items → review) reusing `validateRequired` per step; final submit builds the same payload as today.
- [x] 5b.2 Render dynamic fields through `fieldComponent(fieldType)` so long-text fields use `Textarea` and rich-text fields use `Editor`; replace the document remark/note inputs with `Textarea` (`autoResize`) where appropriate.

## 6. Cleanup & verification

- [x] 6.1 Remove now-dead inline `<span class="text-muted-color">` empty markup and ad-hoc error banners replaced by the kit.
- [x] 6.2 Verify every migrated page in light and dark mode via the configurator (no hardcoded colors; states render correctly).
- [x] 6.3 Run the frontend test suite and lint; confirm i18n parity/no-literal-text specs pass.
