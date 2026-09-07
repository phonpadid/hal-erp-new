## 1. Server intake

- [x] 1.1 One intake that creates the `DRAFT` budget and its plan document in a single
      `em.transactional(...)`, returning the plan document id.
- [x] 1.2 Keep the budget insert adjacent to the document insert inside that transaction, so the
      `doc_running_number` pessimistic lock (invariant 7) is not held across anything else.
- [x] 1.3 A failure in either half leaves no budget, no document and no movement.
- [x] 1.4 Re-propose: raise a plan for an existing budget that is `DRAFT`, belongs to the active
      company, and is carried by no existing plan. Refuse anything else, naming which condition
      failed.

## 2. Client

- [x] 2.1 The budgets store calls the single intake; delete the create-then-createPlan sequence.
- [x] 2.2 The create form still routes to the plan document on success, unchanged for the user.
- [x] 2.3 Offer re-propose where a stranded `DRAFT` is visible — the budget list and the budget's
      own page — gated on `BUDGET_MANAGE`.

## 3. Tests

- [x] 3.1 Proposing writes budget + document + movement, all three present.
- [x] 3.2 A failure raising the plan leaves no budget behind — the case that stranded `1.106`.
- [x] 3.3 Proposing the same dimension twice is refused as a conflict, not a 500 from the unique
      index.
- [x] 3.4 Re-propose raises a plan for a stranded `DRAFT` and returns its document.
- [x] 3.5 Re-propose refuses an `ACTIVE` budget, another company's budget, and one that already has
      a plan — each naming its own reason.
- [x] 3.6 Concurrency: two proposals racing for the same dimension — one wins, one is refused, and
      no stranded budget is left by the loser.
- [x] 3.7 The existing plan intake and numbering suites pass unchanged.

## 4. The row this started with

- [x] 4.1 Check whether a plan-less `DRAFT` budget remains on the customer database, and clear it
      through the re-propose path rather than by hand. **None remains** — the database holds one
      budget, `1.106`, now `ACTIVE` and carried by one `ACTIVATE_BUDGET` movement. The row that
      started this had already been rescued by hand before this change, so there was nothing left
      to clear through the new path. Verified read-only, with no test data written to the
      customer's database: the list read now answers `stranded` per row, `POST /budgets/propose`
      answers 400 from its DTO (so the route exists), and `POST /budgets/:id/propose` refuses
      `1.106` with "is ACTIVE, so there is nothing to propose".
