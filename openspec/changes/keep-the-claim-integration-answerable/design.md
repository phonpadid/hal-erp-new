## Context

Two facts an external claim system needs from us went unreachable, each for its own reason, and both
were found by walking the claim flow end to end against a local stack rather than by anything failing
loudly.

**The paid-or-not read.** `document_settlement` was deliberately absorbed into `payment` — the
`Payment` entity says so in its own comment: the second table was "a copy of a path that was already
generic", and what it carried and `payment` lacked (method, reference, note) became columns there.
The storage move was right. What went with it was `GET /documents/<id>/settlement`, which no spec
carried: it was documented only in `docs/claim-integration.md`, so nothing in this repository broke
when it disappeared. The endpoint now 404s permanently, and 404 is exactly what the contract defines
as "approved, not yet paid" — the failure mode is silence.

**The budget on a line.** `resolveLineGlAndBudget` was inverted on purpose: an account cannot choose
between the budgets that share it, so the budget is the one the requester named. Right for a person
at a screen; the screen reads `GET /budgets/selectable`, and `BudgetController` takes `JwtAuthGuard`
alone. An API-key requester therefore could not see a single budget, and every line it sent named
none — accepted into the DRAFT, refused at submit.

## Goals / Non-Goals

**Goals:**

- Re-answer "has the money left?" from the record that now holds it, and pin the answer with a spec
  and a test so the next storage move takes the read with it.
- Let a machine requester discover a budget the same way a person does, without handing it the
  budget module.
- Say both in `docs/claim-integration.md`, which is the contract an integrator actually reads.

**Non-Goals:**

- Restoring `document_settlement`. The absorption was correct; only the read was lost.
- Exposing the slip, the recorder or the note through the settlement read. They are audit and
  accountability records, and the integration document has always said they are not on offer.
- Opening `BudgetController` to API keys. That controller reads money; this change needs one list of
  names.
- Choosing the budget for the caller. Guessing which budget a claim comes out of is the error this
  design refuses to make.

## Decisions

**The settlement read lives on the documents controller, not on payments.** The documented path is
`/documents/<id>/settlement`, and `DocumentController` is already the controller that accepts an API
key (`JwtOrApiKeyGuard`); `payments/*` does not. Keeping the path also keeps every existing
integrator's client unchanged. *Alternative considered:* a new path under `payments` with a note in
the doc — rejected, because it makes every caller change code to recover an answer they already had.

**The answer is derived, not stored.** `settlementType`, `settledAt` and `reference` are read from
`payment.method`, `payment.paid_at` and `payment.reference` at request time. No column, no
projection, no copy to keep in step. *Alternative considered:* stamping the three onto `document` at
payment time — rejected: a second copy of a fact, and the pair would disagree the first time a
payment was corrected.

**The day is the company's, not the server's.** `paid_at` is a timestamptz; the response is a date,
so a timezone has to be chosen and the only defensible one is `company.timezone` — the same clock the
rest of the system dates things by (`localDateIn`). A payment recorded at 22:30 UTC is the next day in
Vientiane, and reporting the previous day to a waiting customer is a wrong answer, not a rounding.

**The budgets read is a delegation, not a new query.** `DocumentService.selectableBudgets()` calls
`BudgetService.listSelectable()`, the picker the create wizard already uses, which resolves the
caller's department from `RequestContext` — and the API-key guard populates exactly that context.
So a key gets its bound user's department budgets by the same rule an interactive caller does, with
no second implementation of scope to drift. *Alternative considered:* changing `BudgetController`'s
guard to `JwtOrApiKeyGuard` — rejected: it would hand a key every budget-figure read on that
controller to fix one missing list.

**Gated on `DOC_CREATE`, and carrying no figures.** Naming the budget a request charges is part of
making the request. The existing `/budgets/selectable` already draws this line and returns identity
only; this route reuses that decision rather than restating it.

## Risks / Trade-offs

- **[The read is only as correct as `payment` is]** → A payment recorded against the wrong document
  would report the wrong claim as paid. Unchanged by this design: `payment` is already unique per
  document, and recording one is the deliberate act of a person in finance.
- **[A caller with a wide `DOC_CREATE` scope sees many budgets]** → For a COMPANY-scope key the list
  is every active budget in the company, which is a long list to choose from. Mitigated on the
  consumer side, where the integrator pins the budget by code; the alternative — narrowing what the
  key may see — belongs to how the key's user is set up, not to this read.
- **[The contract is still a document, not a test, for external callers]** → The two requirements
  added here are the mitigation: the read now has a spec and a DB-backed test, so the next
  refactoring of `payment` fails a test in this repository instead of a claim in another one.

## Migration Plan

Deploy is additive: two GET routes and no schema change, so old and new servers can run side by side.
Rollback is removing them; a consumer that has started sending `budgetId` keeps working against a
rolled-back server, because the field was always accepted.

## Open Questions

- Should the settlement read also answer for a payment produced by a bank run (`payment.batch_id` set)
  differently — for instance by naming the run? Nothing asks for it today; the three fields are what
  the contract promises.
