## Why

Action outcomes are surfaced inconsistently and quietly. Toast is registered
(`ToastService` + `<Toast/>`) but **no view uses it**; mutation errors are written to a
per-store `error` string and shown — if at all — via an inline `ErrorState`/`Message`
that was designed for page-load failures. So a user who submits, approves, cancels, or
saves often gets no clear confirmation, and a failed action may surface in the wrong
place or not at all. `ConfirmationService`/`ConfirmDialog` aren't installed, so
destructive actions (cancel/reject a document, close a fiscal year, remove a holiday,
revoke access) fire immediately with no guard.

## What Changes

- **Install confirmation infra.** Register `ConfirmationService` and render a global
  `<ConfirmDialog/>` alongside the existing `<Toast/>`.
- **One feedback seam.** Add a `useFeedback()` composable wrapping toast + confirm:
  `success(msg)` → success toast, `error(e)` → error toast (message extracted from the
  API response via a shared helper), and `confirm({...})` → a `ConfirmDialog` for
  destructive actions. Consolidate the duplicated per-store `messageOf` into one util.
- **Errors → Toast (always).** Every user-initiated **action** (mutation) that fails
  shows an error Toast. `ConfirmDialog` is NOT used to display errors — it is used only
  to confirm a destructive/serious action *before* it runs.
- **Success → Toast.** Every successful action shows a success Toast.
- **Destructive actions confirm first.** Cancel/reject a document, close a fiscal year,
  remove a holiday, revoke access / remove a role assignment / detach a permission, and
  cancel a delegation prompt a `ConfirmDialog` before proceeding.
- **Page-load (GET) failures keep the inline `ErrorState`** with retry (unchanged) —
  toasts/confirms are for action outcomes, not for empty content regions.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-app-layout`: add a requirement for consistent **action feedback** (success/error
  toasts) and **destructive-action confirmation** (ConfirmDialog), distinct from the
  existing content-region load/empty/error states.

## Impact

- Frontend only: `src/main.ts` (register `ConfirmationService`),
  `src/layouts/AppLayout.vue` (mount `<ConfirmDialog/>`), a new `useFeedback` composable
  + shared `messageOf` util, and the views/stores that run mutations
  (documents, approvals, budgets, org-admin, rbac-admin, approval-config, master-data,
  currency, quota, notifications, doc-config).
- All toast/confirm text via i18n (en/la parity); PrimeUI theme tokens (light/dark).
- No backend/API change. No change to the page-load `ErrorState` path.
