## Why

The application shell (topbar / sidebar / configurator) is already ported from sakai-vue, and
the dashboard widgets already carry proper loading / empty / error states. But the in-app pages
that live inside that shell — list, detail, form, and admin views — are flat and interchangeable:
`PageHeader` + a bare `.card` + a `DataTable` whose only empty state is a line of grey text and
whose only loading state is the table's spinner overlay. There is no consistent toolbar (search,
filters, bulk actions, export), and no shared "state" treatment, so every page reads the same and
none of them feel like the sakai reference. This change gives each page type the components it
actually needs so the UI looks finished and is easier to scan and act on.

## What Changes

- Add a small, reusable **page-component kit** under `front-end/src/components/` that mirrors
  sakai-vue conventions, all driven by PrimeUI theme tokens (light/dark safe):
  - **`PageToolbar`** — a wrapper over PrimeVue `Toolbar` for list pages: a global search field
    (`IconField` + `InputText`), a `#filters` slot, a `#bulk` slot shown when rows are selected,
    and an `#actions` slot (primary action + export).
  - **State components** — `EmptyState` (icon + title + message + optional CTA), `ErrorState`
    (icon + message + retry), and a `TableSkeleton` (sakai-style skeleton rows) so each page can
    render loading / empty / error explicitly instead of relying on a spinner and grey text.
  - **`DetailHeader`** / `SectionCard` helpers so detail pages get a consistent status-tagged
    header and titled card sections instead of a stack of identical bare cards.
- Use the **right input for the data shape**, not a one-size `InputText`:
  - **Long / multi-line text** uses `Textarea` (with `autoResize`); **rich text** uses
    `primevue/editor` (`<Editor v-model="value" editorStyle="height: 320px" />`). Dynamic form
    fields render the control that matches their field type instead of a plain text box.
  - **Long forms become steps.** A multi-section form (e.g. create-document: header → fields →
    line items → review) is presented as a `Stepper` wizard with per-step validation instead of
    one long scroll.
  - **Sequential / historical data becomes a `Timeline`.** The document approval history (and
    similar event logs) renders as a vertical `Timeline` with status markers instead of a table.
- **Group the sidebar menu into logical sections** (e.g. Workspace, Budget & Quota, Master Data,
  Administration) with separators, replacing today's single flat list — each entry stays
  permission-gated and empty sections are hidden.
- Adopt the kit across the existing in-app views (budgets, documents, approvals, quota, master
  data, notifications, admin) so list pages gain a toolbar + skeleton + rich empty/error states,
  detail pages gain a consistent header + sectioned cards + timeline, and the long create-document
  form becomes a stepper.
- Standardise the existing `*.list.empty` / error i18n keys and add the few new keys the state
  components need (titles, retry, "clear filters"), keeping en/la locale parity.

No backend, API, data-model, or permission behaviour changes — this is presentation only. The
existing permission-code gating on actions is preserved (the toolbar's primary/bulk actions stay
gated exactly as today; client gating remains UX-only with the server authoritative).

## Capabilities

### New Capabilities
<!-- none — this refines an existing frontend capability rather than introducing a new one -->

### Modified Capabilities
- `web-app-layout`: extends the **Consistent Page Layout** requirement so the shared page
  convention also covers a list-page toolbar (search / filters / bulk actions), explicit
  loading / empty / error states for content regions, input controls matched to the data shape
  (long text → textarea/editor), long forms presented as steps, and event history presented as a
  timeline; and extends the **Permission-Gated Navigation** requirement so the sidebar is grouped
  into labelled sections rather than a single flat list.

## Impact

- **Affected code (frontend only):** new components in `front-end/src/components/`
  (`PageToolbar.vue`, `EmptyState.vue`, `ErrorState.vue`, `TableSkeleton.vue`, `DetailHeader.vue`,
  `SectionCard.vue`, plus a `FormStepper.vue` wrapper and an `EventTimeline.vue`); a
  field-type → control mapping for dynamic form fields (textarea/editor); the create-document form
  becomes a stepper; the sidebar menu model in
  `front-end/src/layouts/store/layout.store.ts` gains section grouping; refactors of the views
  under `front-end/src/views/**`; additions to `front-end/src/i18n/locales/{en,la}/**`.
- **New dependency:** PrimeVue `Editor` requires the optional `quill` peer dependency (already
  bundled by PrimeVue 4 styling); add it to the frontend if not present.
- **No change** to backend, DBML, migrations, REST APIs, Pinia store contracts, or routing
  (the stepper submits the same payload the single-page form does today).
- **Invariants:** none of the core/backend invariants are touched. The relevant frontend rule —
  show/hide and enable/disable by **permission code** from the active-company context — is
  preserved: toolbar and bulk actions remain gated by the same codes used today.
