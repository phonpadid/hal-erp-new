## Why

The web frontend has grown to ~30 routed pages across documents, approvals, budgets,
quota, payments, reports, and admin, but there is no systematic check that each page
actually renders and its core flow works. A concrete symptom is already visible: every
report view passes `:message` to `<EmptyState>` without the **required** `title` prop, so
empty report tables render a blank heading — `vue-tsc` flags 7 instances and the bug
ships because no smoke test exercises those views. We need a page-by-page audit that both
fixes the bugs hiding today and leaves behind a repeatable bar so broken pages are caught
going forward.

## What Changes

- Define an explicit, testable bar for "a working page" (render without errors; loading,
  empty, and error states present; money formatted via currency `decimal_places`, never a
  JS number; UI gated by permission code; i18n keys resolve).
- Audit all ~30 routed web views one by one against that bar and catalog every defect in
  the change's `tasks.md` audit matrix.
- Fix the defects found, starting with the confirmed `<EmptyState>` missing-`title` bug
  across the six report views, plus any runtime/console errors surfaced during the walk.
- Add a lightweight smoke-render test per view (mount with mocked store/router/i18n,
  assert it renders without throwing and shows the right loading/empty/error branch) so
  regressions fail CI.
- Make `vue-tsc -b` clean a gate — no view ships with type errors.
- No backend, schema, or business-logic changes; no API contract changes.

## Capabilities

### New Capabilities
- `web-ui-quality`: Cross-cutting acceptance criteria every routed web page MUST meet —
  successful render, loading/empty/error state handling, currency formatting via
  `decimal_places`, permission-code gating mirrored from the server, i18n key resolution,
  and a smoke-render test as the standing regression guard.

### Modified Capabilities
<!-- None. This change verifies existing web-* specs are met and fixes drift; it does not
     alter any capability's requirements. -->

## Impact

- **Code:** `front-end/src/views/**` (all routed views, esp. `views/reports/*` for the
  `EmptyState` fix), `front-end/src/components/EmptyState.vue` consumers, and new
  `*.spec.ts` smoke tests beside each view.
- **CI / build:** `vue-tsc -b` becomes a required gate; Vitest suite gains ~30 smoke tests.
- **No impact** on backend services, the DBML, migrations, or any API. Invariants
  (company isolation, append-only ledgers, money-never-a-number) are unaffected, though
  the audit re-checks that views format money via `decimal_places` and never coerce to
  `number`.
