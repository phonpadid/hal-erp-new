# Design — Finish every document the wizard offers

## Context

Twelve of nineteen seeded types cannot produce a working document through the create wizard. The
twelve fall into four families with four different remedies, so the work is not one fix repeated but
one rule applied four ways: **a type the wizard cannot carry to a working document must not present
itself as one it can.**

Nothing has launched. The seed is re-seeded rather than migrated.

## Decisions

### D1. The signal is a column on `document_type`, not a rule derived from `post_action`

The wizard needs to know, per type, whether the generic form can author its content. Three candidates:

| | how it reads | why not |
| --- | --- | --- |
| derive from `post_action` | client holds a set of "not generic" actions | invariant 7 — behaviour branching on hardcoded code, and `post_action` answers a different question (*what full approval does*), not *where the content is written* |
| drop the `dept_doc_type` mapping | absent mapping = not offered | **impossible**: `createDraft` calls `deptDocTypes.resolve(departmentId, documentTypeId)` for every document, including the ones the voucher screen makes. Removing the mapping breaks the dedicated screen too |
| **a column (chosen)** | `document_type.authoring_route` | configuration, per company, and says the thing directly |

`authoring_route` is nullable. `null` means the generic wizard authors this type. A value names the
screen that does — the same string the client router uses, so the wizard can send the user there
without a second lookup table.

The mapping stays for every type either way: it carries the form template and the workflow, which a
dedicated screen needs just as much.

### D2. The types stay in the list; only what selecting them does changes

Removing LEAVE from the card grid would be the smaller change and the worse one. A requester looking
for "leave" looks where documents are made, and a list that quietly omits it teaches nothing. The
cards stay; choosing one whose `authoring_route` is set navigates there instead of advancing to step 2.

This also keeps the wizard honest about what exists: the grid remains the inventory of what this
department may raise, which is what `dept_doc_type` means.

### D3. `requires_employee`, mirroring the flags already there

The HR pair needs `document.related_employee` set before submit. The codebase already has this exact
shape four times — `requires_vendor`, `requires_item`, `requires_payee`, `requires_warehouse` — each
a boolean on `document_type` enforced at submit and rendered as a picker. A fifth follows the
pattern rather than inventing one, and it is what lets the rule be configuration: a company that
wants a different HR document gets the picker by setting the flag, not by someone editing a switch.

`UPDATE_EMPLOYEE` and `TERMINATE_EMPLOYEE` keep their no-op-when-absent branch. That branch is right
for a post-action handed a document with no subject; what changes is that the wizard can no longer
produce one.

### D4. The stock family is built, not hidden — the spec already promised it

`web-inventory` describes the form: a warehouse selector when `requires_warehouse`, a destination
when `post_action` is `TRANSFER_STOCK`. The server side is complete (`document.dto.ts:122,127`
accept `warehouseId` / `destWarehouseId`; `GET /warehouses` lists them; submit enforces both). Only
the client is missing, and two payload fields it cannot branch on.

So: `creatable-types` and `types/:id/form` gain `requiresWarehouse` and `postAction`; the wizard
renders the selectors on step 2 beside the other document-level fields; submit sends them. These
types keep `authoring_route` null — they are meant to be ordinary configured documents.

### D5. Overtime has no door to route to, and this change does not build one

Leave routes to `request-leave`; time correction has `request-correction`; both exist. Overtime has
a complete backend — `POST /overtime-claims`, `GET /overtime-claims/preview`,
`POST /overtime-claims/:documentId/submit`, `GET /overtime-claims/document/:id` — and **no client at
all**: no API module, no view, no route.

Building that screen is a change about overtime, not about the wizard, and it needs decisions this
one has no business making (which days the preview spans, how a claimant sees computed hours). Until
it exists, OT's `authoring_route` points at nothing, so **OT is deactivated in the seed** rather than
offered as a door that opens onto a wall. The proposal records this as the one type the change
removes rather than repairs, and the follow-up is named.

### D6. Empty budget documents are refused at submit, not at approval

`activate()` and `movementOf()` already refuse a budget document with no movement. Moving an
equivalent check to submit costs one query and changes who pays for the mistake: today the requester
submits happily and an approver discovers it, with the document stuck in their queue; after, the
requester learns immediately and the approver never sees it.

The check belongs in `DocumentSubmitService` beside the other pre-submit guards
(`requires_warehouse`, `requires_payee`, …), reading the same configuration: a type whose
`post_action` is a budget movement requires at least one `budget_movement` row. This is the one
place the change does branch on `post_action`, and legitimately — the question being asked *is*
"what will full approval try to do".

The same reasoning applies to `POST_JOURNAL` and its `journal_voucher` rows.

## Risks

- **`authoring_route` is a string the client must recognise.** A typo yields a route that does not
  resolve. Mitigated by seeding it from the same route names the router declares, and by the wizard
  falling back to its own step 2 when the route is unknown rather than dead-ending — the failure
  mode returns to today's behaviour instead of a blank screen.
- **Deactivating OT removes a type somebody may be using.** On a seeded database nobody is. On a
  configured one the flag is per company and reversible, and the alternative is a card that cannot
  produce a submittable document.
- **The submit-time budget check duplicates a rule the post-action owns.** Two places can drift. The
  design accepts it because the check is a strict subset — "at least one movement exists" — while
  the post-action still validates everything it needs at the moment it needs it. The submit guard is
  an early filter, not a replacement, and the post-action keeps its own refusal.
