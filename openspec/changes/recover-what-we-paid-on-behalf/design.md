## Context

The claim integration is being reshaped by its owner: the company pays every claimant through us, and
whether somebody else was at fault decides only which document is raised. A claim carried by the
company is the type that exists today. A claim carried by a branch or a transport line becomes a
second type, and its approval must leave a recovery behind — a note somebody walks to a branch with.

Two pieces of our own machinery meet here, and one of them says something the business has to hear.

**The successor mechanism fits.** `CREATE_SUCCESSOR` records a `pending_successor` row inside the
approval transaction and a sweeper raises the DRAFT with `createFrom`, in the pairing's department.
Guaranteed, deferred, and retryable — exactly the shape of "leave a note".

**The budget guard does not bend.** `post_action` is single-valued, and `SETTLING_ACTIONS` is
`['CUT_BUDGET']` alone. A type that requires budget reserves at submit and is only settled by a
`CUT_BUDGET` post-action, on itself or somewhere down its pairing graph — `reservationCanBeSettled`
walks that graph and `assertAccrualSettlesItself` checks the same thing at the type. So a type cannot
both charge the budget and create a successor, unless the successor itself charges the budget, which
for a document that *collects* money is nonsense.

That constraint is not in the way of the design. It is the design asking a question the business has
not answered: **is money we front for somebody else's mistake a charge against the budget the company
keeps for its own?**

## Goals / Non-Goals

**Goals:**

- Make an automatically-raised successor carry what it needs to be worked by a person who never saw
  the predecessor.
- Configure the claim recovery chain with the type flags the guards actually permit, and say plainly
  what each combination costs.
- Keep the recovery ours: the integrator raises the document and hears nothing further.

**Non-Goals:**

- A receivable ledger, a collection workflow, an ageing report, or a write-off action. The recovery is
  a note; if it ever becomes a process, that is its own capability.
- Multi-valued `post_action`. It would answer this cleanly and it is a much larger change than this
  one — see the options below.
- Deciding for the customer which budget treatment they want. This design states what each option
  costs and asks.

## Decisions

**Inheritance is by field name, bounded by the successor's own form.** The two types have different
`form_field` rows, so an id cannot match; a name can, and a name is what both forms already agree on
(the claim integration's `claimRef`, `trackingNo`, `orgUnit` are names, not ids). Bounding it by the
successor's form is what keeps it from being a smear: a recovery form that asks for four things gets
four things, not the claim's eleven. *Alternative considered:* copy every predecessor value and let
the form ignore what it does not declare — rejected: `doc_field_value` rows keyed to fields the form
does not show are invisible data that later reads would have to filter.

**A value the successor's field would refuse is dropped, not written.** A dropdown that narrows its
options between the two types is a deliberate act by whoever configured it, and inheritance must not
be a way past it. Dropping silently is the lesser evil against writing a value no person could have
entered; the field is simply empty and the person filling it sees what is missing.

**Inheritance is added to the reference chain rather than modifying it.** The existing requirement
speaks about "header fields and `document_line` rows" and has never said anything about
`doc_field_value` — this is a new concern on the same action, and stating it separately keeps the
copied-money rules readable as one paragraph.

**The chain is configuration, and the flags are the real decision.** Three shapes are permitted by the
guards; only the third needs code beyond this change:

```
                              charges the       recovery raised
                              claim budget      automatically      what it costs
  ─────────────────────────────────────────────────────────────────────────────────────
  A  advance: requires_budget=false            ✗            ✓      nothing caps how much
     post_action=CREATE_SUCCESSOR                                   the company fronts;
     recovery: no budget, no post-action                            fronted money needs its
                                                                    own GL to sit in
  ─────────────────────────────────────────────────────────────────────────────────────
  B  advance: requires_budget=true             ✓            ✗      the claim budget is
     post_action=CUT_BUDGET                                         consumed by other
     recovery: raised by create-from,                                people's faults, and
     pairing auto_create=false                                       nothing is ever put
                                                                     back; somebody has to
                                                                     remember to raise the
                                                                     recovery
  ─────────────────────────────────────────────────────────────────────────────────────
  C  post_action becomes multi-valued          ✓            ✓      a change to the document
                                                                    engine's core contract,
                                                                    touching every guard that
                                                                    reads a single action
```

A is what the mechanism was built for and what the claim owner described. B keeps the budget
discipline and trades the automation for a person's memory — and note it is not merely weaker
automation: nothing anywhere would notice a recovery that never got raised. C is honest about wanting
both and should be proposed on its own merits, not smuggled in through a claim.

The recommendation in this design is **A**, on one condition: that fronted money gets a GL account of
its own, so "what we are owed by branches" is answerable from the ledger even though no recovery
workflow exists. Without that condition A is money leaving with no cap and no trace, which is worse
than B.

**The recovery type carries no budget and no post-action.** It is a note. Giving it `CUT_BUDGET` to
satisfy a reachability rule would charge the budget a second time for the same incident; giving it
`ADJUST_INCREASE` would credit the budget for money nobody has yet collected.

## Risks / Trade-offs

- **[Inheritance changes existing chains]** → PR→PO and advance→clearing start carrying field values
  they did not before. That is the intended behaviour and nothing reads those fields expecting blanks,
  but it is a behaviour change on live chains and belongs in the release note.
- **[A narrowed dropdown silently drops a value]** → The person filling the successor sees an empty
  required field and is stopped by the form. The alternative — refusing the successor's creation —
  would turn a configuration mismatch into a failed obligation in the outbox, which is worse.
- **[Option A leaves fronted money uncapped]** → Stated above; the GL condition is the mitigation, and
  the budget report is where somebody would notice. If the business will not accept an uncapped
  exposure, B is the answer and the automation goes.
- **[The recovery is never followed up]** → True under every option: nothing here chases it. The claim
  owner has accepted that explicitly. Worth re-reading in a year with the ledger in hand.

## Migration Plan

Inheritance ships first and alone — it is additive and every existing chain benefits. The claim types
are configured per company afterwards, through the doc-config screens, and can be configured in a test
company first: nothing about the chain is code, so a mistake is edited rather than deployed.

## Open Questions

1. **Which shape — A, B or C?** The finance decision this change cannot make. It sets
   `requires_budget`, `post_action`, the GL account, and whether the recovery is automatic.
2. **Does the recovery type need an approval workflow at all?** Every document routes, but a note to
   go and collect may want a single confirming step rather than a ladder — and whoever approves it is
   confirming "yes, this is owed", which is a real decision with a real owner.
3. **What identifies a transport line on the form?** The claim system will send a route and a trip
   number. Two text fields, or one dropdown fed from a list we do not hold?
4. **Does a recovery ever need to be reported on?** Nobody has asked. If they do, inheritance is what
   makes it possible, which is an argument for shipping inheritance whatever else is decided.
