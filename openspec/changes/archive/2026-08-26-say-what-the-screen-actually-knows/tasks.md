## 1. The inbox search searches the queue

- [x] 1.1 `stores/approvals.ts` — carry a search term through `loadPending(page, limit, search?)`
      and send it to `/approvals/pending`, mirroring how `stores/documents.ts` sends `docNo`.
- [x] 1.2 Backend: accept the term on the pending-inbox query (declared on the DTO, so
      `forbidNonWhitelisted` does not reject it) and match it server-side against document number
      and requester name.
- [x] 1.3 `ApprovalInboxView.vue` — bind the toolbar's `@update:search` to the store's refetch and
      drop the inert `:filters` / `:globalFilterFields`.
- [x] 1.4 `AppDataTable.vue` — refuse (or warn on) `filters` while `lazy` is set, so the next screen
      to bind a client-side filter to a server-paged table finds out at the component boundary.
- [x] 1.5 Component spec: a queue spanning two pages, a search for a document on page 2, the
      document is listed; and a search matching nothing shows an empty result, not the full list.

## 2. Presence is asked per field type, from one rule

- [x] 2.1 `shared/` — add the presence predicate next to `isFieldVisible`: given a field, its
      `doc_field_value`, and the document's attachment and line counts, answer whether it has a
      value. `file` → attachments, `line_items` → lines, everything else → a non-empty value.
- [x] 2.2 `document-submit.service.ts` — use the shared predicate in the required-field gate instead
      of its own inline branch, so there is one rule rather than two.
- [x] 2.3 `DocumentDetailView.vue` — `missingRequiredFields` uses the shared predicate, passing the
      attachment and line counts it already loads.
- [x] 2.4 `CreateDocumentView.vue` — the wizard's own required-field check uses it too.
- [x] 2.5 Component spec: a draft with a required `file` and an attachment shows no prompt; the same
      draft without the attachment does; the same for `line_items` and lines.
- [x] 2.6 Unit spec: the shared predicate agrees with the submit gate for every field type in
      `FIELD_TYPES`.

## 3. A refusal outlives its toast

- [x] 3.1 `DocumentDetailView.vue` — render the store's submit error beside the submit action, not
      only as a toast; clear it when the document is submitted again or edited.
- [x] 3.2 `CreateDocumentView.vue` — the wizard already navigates to the detail page on a failed
      submit; make sure the reason travels with it rather than being lost to the route change.
- [x] 3.3 Component spec: a refused submit leaves the server's reason on screen after the toast
      would have expired, and no completeness prompt contradicts it.

## 4. A budget plan is authored where it can be finished

- [x] 4.1 Set `document_type.authoring_route = 'budgets'` for `BUDGET_PLAN` in company HAL, and in
      the seed for any company the seeder configures a plan type for.
- [x] 4.2 Add a config check (alongside `pnpm boot:check`): a document type whose `post_action` is
      one of the budget-movement actions or `POST_JOURNAL`, carrying no `authoring_route`, is
      reported by name. It reports rather than derives — the spec forbids deriving the route from
      `post_action` (invariant 7).
- [x] 4.3 Verify in the browser: choosing the budget-plan card lands on the budgets screen, and no
      document number is spent.
- [x] 4.4 `BUDGET_PLAN-HAL-2026-0096`, the stranded draft this run created, is cancelled.

## 5. The apps agree on a port

- [x] 5.1 Nothing in the repository needed to move: `back/.env.example` sets `PORT=3000`, both
      READMEs document 3000, `main.ts` defaults to it, and both `.env` files are gitignored — the
      earlier claim that the repo ships a broken pair was wrong and is corrected in the proposal and
      in `docs/ui-run-2026-08-26.md`. The local `back/.env` on this machine now reads `PORT=3000`.
- [x] 5.2 Added to `pnpm boot:check`, alongside a check that a type whose content lives on
      `budget_movement`/`journal_voucher` names an authoring route. Proved by forcing `PORT=5000`:
      it fails and names both ports and both files.
- [x] 5.3 Verified on this machine's config: the check passes, and the browser reached the API for
      every case re-run below.

## 6. Close the loop

- [x] 6.1 Re-ran the browser cases that found the defects. Inbox search: "SPEND" now returns
      exactly the 3 `SPEND_HIST` documents (they were on later pages before) instead of 20
      unrelated rows. Completeness prompt: `REC-HAL-2026-0219`, which has its attachment, shows no
      banner at all. Refusal readability: submitting it, then waiting 8s for the toast to expire,
      leaves the server's reason ("2000000 requested, 1000000 available") as the only text on
      screen. Authoring route: choosing the budget-plan card lands on `/new/budgets` without
      spending a document number.
- [x] 6.2 `pnpm test`: front-end 1005 passed (114 files, up from 996), back 1983 passed
      (up from 1971). Both typecheck clean.
- [x] 6.3 Re-ran `back/e2e` — 83/83.
- [x] 6.4 Folded into `openspec/specs/web-approvals/spec.md` (MODIFIED *Approval Inbox*),
      `openspec/specs/web-documents/spec.md` (two ADDED requirements) and
      `openspec/specs/platform-foundation/spec.md` (MODIFIED *Local development environment*);
      all 75 specs validate.
