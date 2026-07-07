## Context

`ToastService` is registered and `<Toast/>` is mounted in `AppLayout.vue`, but no view
calls `useToast()`. Instead every store carries an `error: string` and its own copy of:

```ts
function messageOf(e: any): string {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}
```

Views render that string through `ErrorState`/`Message` — components meant for an empty
content region on page load, not for action outcomes. Several stores (org, rbacAdmin,
approvalConfig) share a `run()` wrapper that sets `error`. `ConfirmationService` /
`ConfirmDialog` are not installed, so destructive actions run with no guard.

Decisions from the user: **errors always go to a toast** (never a modal); **ConfirmDialog
is only a pre-action guard** for destructive/serious actions; **page-load GET failures
keep the inline `ErrorState`**.

## Goals / Non-Goals

**Goals**
- One place to raise success/error feedback and to confirm destructive actions.
- Consistent, visible outcome for every mutation; no silent failures.

**Non-Goals**
- No change to page-load `ErrorState`/empty/loading states (Content Region States).
- No backend/API change. Not introducing a global HTTP interceptor that toasts every
  error (would double-toast handled cases and toast GET loads we intentionally keep inline).

## Decisions

**Decision: a `useFeedback()` composable as the single seam.**
```
const fb = useFeedback()
fb.success(msg)                       // success toast
fb.error(e)                           // error toast; message via shared messageOf(e)
await fb.confirm({ message, header }) // resolves true/false from ConfirmDialog
```
It wraps `useToast()` and `useConfirm()`. Views call `fb` for action outcomes; stores stay
focused on state. Centralizing here keeps the presentation rules in one file.
- *Alternative — Axios response interceptor that toasts all errors*: rejected; it can't tell
  an action failure from a page-load GET (which must stay inline), and would fight the
  per-call handling that decides success messages.

**Decision: errors → toast only; confirm is pre-action.**
Per the chosen rule, `fb.error()` always uses a toast (severity `error`), regardless of
HTTP status. `fb.confirm()` is invoked *before* destructive actions; the action runs only
on accept. ConfirmDialog never displays an error.

**Decision: keep store mutations returning a success boolean; views own the feedback.**
Stores already return `true/false` (or throw) and still set `error` for any inline use.
Views call the store action and then `fb.success(...)` / `fb.error(...)`. The store's
`messageOf` is replaced by importing the shared util so there is one message-extraction
rule.
- *Alternative — move toasts into stores*: rejected; stores have no `useToast` setup
  context and it couples state to presentation. Feedback belongs to the view layer.

**Decision: shared `messageOf` util.**
Extract the duplicated function to `src/utils/apiError.ts` and re-use it in `useFeedback`
and any store still surfacing `error` for the inline path.

## Destructive actions to guard with `confirm()`

Document cancel and reject (DocumentDetailView) · close fiscal year, remove holiday
(OrgAdminView) · revoke access, remove role assignment, detach permission (RbacAdminView)
· cancel delegation (ApprovalConfigView). Non-destructive mutations (create/update/submit/
approve/save) get success/error toasts without a confirm step.

## Risks / Trade-offs

- [Double feedback if both a store inline `error` and a toast fire] → for action paths,
  stop writing to the inline `error` (or ignore it in the view) and rely on the toast; keep
  `error` only for the GET load path consumed by `ErrorState`.
- [Toast fatigue on bulk/looped actions] → one toast per user action, not per row; bulk
  ops summarise in a single toast.
- [i18n drift] → all new strings added to en + la together; covered by the locale-parity test.

## Migration Plan

Pure frontend, one release. Register `ConfirmationService` + mount `<ConfirmDialog/>`, add
the composable/util, then migrate views. Rollback = revert; the inline `ErrorState` path is
untouched so nothing regresses if a view is reverted mid-migration.

## Open Questions

None — severity rule (errors always toast), confirm scope (destructive only), and load-error
handling (keep inline) are decided.
