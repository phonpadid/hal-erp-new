## 1. Infra: confirmation + feedback seam

- [x] 1.1 In `src/main.ts`, register `ConfirmationService` (alongside the existing `ToastService`).
- [x] 1.2 In `src/layouts/AppLayout.vue`, mount a global `<ConfirmDialog/>` next to `<Toast/>`.
- [x] 1.3 Add `src/utils/apiError.ts` exporting the shared `messageOf(e)` (the array/`response.data.message`/fallback rule).
- [x] 1.4 Add `src/composables/useFeedback.ts` exposing `success(msg)`, `error(e)` (toast, message via `messageOf`), and `confirm({ message, header?, acceptLabel? }): Promise<boolean>` (wraps `useConfirm`). Severity rule: errors always toast; confirm is pre-action only.

## 2. i18n

- [x] 2.1 Add a `feedback`/`common` i18n group (en + la parity): generic success/failure titles, confirm dialog accept/reject labels, and confirm prompts for the destructive actions (cancel/reject document, close fiscal year, remove holiday, revoke access, remove assignment, detach permission, cancel delegation).

## 3. Wire success/error toasts into action flows

- [x] 3.1 Replace each store's local `messageOf` with the shared util; keep the inline `error` only for the page-load (GET) path consumed by `ErrorState`.
- [x] 3.2 Documents (`DocumentDetailView`, `CreateDocumentView`): success toast on create/submit; error toast on failure (replace the silent `docs.error` assignment for actions).
- [x] 3.3 Budgets (`BudgetDetailView` adjust): success toast on adjustment created (before routing), error toast on failure.
- [x] 3.4 Admin/config + master/quota/notifications/currency views: success toast on create/update/save, error toast on failure for every mutation.

## 4. Confirm destructive actions before running

- [x] 4.1 `DocumentDetailView`: cancel and reject go through `fb.confirm(...)` before calling the store; proceed only on accept.
- [x] 4.2 `OrgAdminView`: `closeFiscalYear` and `removeHoliday` confirm first.
- [x] 4.3 `RbacAdminView`: `revokeAccess`, `removeAssignment`, `detachPermission` confirm first.
- [x] 4.4 `ApprovalConfigView`: `cancelDelegation` confirms first.

## 5. Verify

- [x] 5.1 Confirm page-load GET failures still render the inline `ErrorState` (not a toast/dialog) — no regression to Content Region States.
- [x] 5.2 `npx vue-tsc -b` shows no new errors in changed files; run `pnpm test` (locale parity + components) green.
- [x] 5.3 Manual: a successful save shows a success toast; a failing action shows an error toast; a destructive action shows a confirm dialog and only runs on accept — in light and dark mode.
