## Context

The lifecycle itself is sound. A browser pass over the full flow — create, upload, submit, approve
twice, return, resubmit, reject, withdraw, self-approve, overspend, list, search, export
(`docs/ui-run-2026-08-26.md`) — found every state transition, every ledger row and every refusal
correct, including the resubmission path repaired by `keep-a-document-moving-after-submit`.

What is wrong is narrower and entirely in the presentation layer: three places where a screen says
something the system does not know, or offers something it cannot do.

| # | Symptom | Where |
|---|---|---|
| 1 | The inbox search box filters nothing | `ApprovalInboxView` + `AppDataTable` in `lazy` mode |
| 2 | A draft with its file attached is told the file is missing | `DocumentDetailView.missingRequiredFields` |
| 3 | The wizard offers a budget plan it cannot finish | `document_type.authoring_route` is NULL for `BUDGET_PLAN` |

Two candidate defects were investigated and dismissed: a line amount that reads `0` (the
accessibility snapshot is taken before the field commits; it recomputes on blur) and a submit error
that looked swallowed (it is a toast, captured with a `MutationObserver`, carrying the server's
exact message).

## Goals / Non-Goals

**Goals:**
- A search control that is offered filters the set it appears to filter.
- A completeness prompt agrees with the gate it exists to predict.
- A refusal a requester can act on stays readable while it is still true.
- A document type the wizard offers can be completed from where it is offered.

**Non-Goals:**
- Changing any approval, budget or numbering behaviour. Nothing here touches a ledger.
- Rewriting `AppDataTable`'s paging model. Server-side search is added to the one screen that
  needs it and already has the shape to follow.
- Making the over-budget message name its control point in words instead of UUIDs. The numbers are
  right and the message is the server's; readability there is its own change.
- Auditing every other lazy table for the same inert-filter pattern. Worth doing; not here.

## Decisions

### 1. Inbox search goes to the server, following the documents list

`ApprovalInboxView` currently declares:

```vue
:filters="filters"
:globalFilterFields="['docNo', 'requesterName']"
```

`AppDataTable` sets `lazy`, and in that mode PrimeVue hands filtering to the server and ignores
`filters` entirely. No `@filter` handler exists, so the binding is decoration.

`MyDocumentsView` solves the same problem on the same components by sending the term as a query
parameter and refetching — verified working during this run, filtering to two matches across the
whole dataset. The inbox follows it: the term travels to `/approvals/pending`, the store refetches,
and page 1 of the filtered set is shown.

**Alternative considered — drop `lazy` and let PrimeVue filter.** It would filter the 20 rows the
client holds out of 43, look like it worked, and hide the rest. That is the failure mode the
`web-documents` list requirement already rejects ("results reflect the full dataset, not only the
current page").

**Alternative considered — remove the search box.** Honest, and better than today, but the inbox is
the screen where finding one document among dozens is the whole job.

`AppDataTable` should also stop accepting `filters` silently while ignoring them, so the next screen
to make this mistake finds out at the component boundary rather than in a browser.

### 2. Presence is asked per field type, from one rule

The server already decides presence this way:

```ts
const present =
  f.fieldType === 'file'
    ? attachmentCount > 0
    : f.fieldType === 'line_items'
      ? lineCount > 0
      : val !== undefined && val !== null && val !== '';
```

The client's `missingRequiredFields` implements only the third arm. The fix is not to paste the
other two arms into the client — that is how the copies drifted in the first place — but to put the
predicate where both can reach it, next to `isFieldVisible` in the shared package the two already
share for visibility. The client then passes what it has (`fieldValues`, attachment count, line
count) and gets the same answer the gate will give.

That keeps the promise the current comment makes and does not keep: *"this prompt can never
disagree with the wizard or the server submit gate"*.

### 3. A refusal outlives its toast

The toast stays — it is the right thing for the moment of the click. What is added is that the
reason remains reachable while the document is still in the state that produced it: rendered beside
the submit action rather than only floating past it.

The completeness banner and the refusal banner must not contradict each other. With decision 2 the
completeness banner is correct, so the contradiction that made this urgent disappears; keeping the
refusal on screen is what stops a future one from being invisible.

### 4. `BUDGET_PLAN` gets its route, and the gap becomes visible

No code and no spec change: `web-documents` already requires *Choosing a Type Authored Elsewhere
Goes There* with the scenario "A budget plan goes to the budget screen", and `CreateDocumentView`
already redirects on `authoring_route`. The row is set:

```
document_type.authoring_route = 'budgets'   -- BUDGET_PLAN, company HAL
```

To stop the same gap recurring silently, the seeded/config check gains a rule: a type whose
`post_action` moves budget or posts a journal — the types whose content lives outside
`document_line` and `doc_field_value` — and which carries no `authoring_route` is reported. The spec
is explicit that the route must not be DERIVED from `post_action` (invariant 7: configuration, not
code), so this reports a suspected misconfiguration rather than filling one in.

**Note on the blast radius.** Until the row is set, the submit gate still refuses these documents,
so nothing unapprovable reaches an approver — the cost is a spent document number and a user walked
into a dead end.

### 5. Front-end and backend agree on a port

`front-end/.env` names `http://localhost:3000/api-new`; `back/.env` sets `PORT=5000`. Which one
should move is the maintainer's call — the README and `.env.example` decide it, and the other file
follows. Whichever way it goes, a check that compares the two and fails loudly belongs with the
other boot checks (`pnpm boot:check`), because the symptom otherwise is a login screen that reports
a connection error and gives no hint which of two files is wrong.

## Risks / Trade-offs

**Server-side inbox search adds a query parameter to an endpoint other clients may call.** → It is
optional and absent means today's behaviour, so no existing caller changes.

**Moving the presence predicate into the shared package couples the client to a server rule.** →
They are already coupled; today the coupling is a comment claiming agreement that does not hold.
Sharing `isFieldVisible` set the precedent and the same reasoning applies.

**Keeping a refusal on screen can leave a stale message after the user fixes the cause.** → It is
cleared when the document leaves the state that produced it — a fresh submit attempt, or an edit
that changes what was refused.

**Setting `authoring_route` redirects users who are used to the wizard.** → That is the point, and
the wizard keeps the card: the requirement is explicit that the grid stays the inventory of what the
department may raise.

## Migration Plan

No schema migration. One data update (`BUDGET_PLAN.authoring_route`), applied per company that
configures a plan type; it changes no existing document, since `authoring_route` is read only when a
card is chosen.

Each fix is independently verifiable in the browser:

1. Inbox search → search a document number on page 2 of a multi-page queue; it appears.
2. Completeness prompt → open any `REC*` draft with its attachment; no banner.
3. Refusal readability → submit an over-budget draft, wait ten seconds; the reason is still there.
4. Authoring route → choose the budget-plan card; arrive at the budgets screen.
5. Ports → follow the README on a clean checkout; the login form reaches the API.

Rollback is reverting the commit and the one row.

## Open Questions

- **Which port is correct — 3000 or 5000?** The repo currently disagrees with itself and the
  answer is the maintainer's, not this change's.
- **How many other lazy tables accept `filters` and ignore them?** The inbox is the one this run
  touched. A sweep belongs in its own change, and the `AppDataTable` guard in decision 1 would
  surface them.
