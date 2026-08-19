# Reserve only what something can settle

## Why

Driving every seeded document type through to completion surfaced a compensation claim that had
been fully approved and could not go anywhere. `CLAIM-HAL-2026-0001` is `COMPLETED`, holds 50,000 of
the Office Supplies appropriation, is invisible to the payment queue, and has no entry in the
general ledger. It will stay that way forever.

**Three things are true of it at once, and they contradict each other.**

```
budget ledger   RESERVE 50,000 · no ACTUAL · no RELEASE   → still merely committed
general ledger  nothing                                    → never recognised
payment queue   absent                                     → nothing owed to anyone
```

Yet the type is configured `accrues_on_approval = true`, which is a statement that the obligation
**is** recognised at approval. The configuration says one thing and all three ledgers say another.

**The cause is a configuration the engine cannot honour.** A document type that reserves its own
budget needs something to convert that reservation into spend. The seeded types do this three ways:

| type | `requires_budget` | `post_action` | what converts the reservation |
| --- | --- | --- | --- |
| PR | true | `CUT_BUDGET` | itself, at approval |
| PROC | true | `CREATE_SUCCESSOR` | a `DISB` at the end of `PROC → PO → DISB` |
| DISB | false | `CUT_BUDGET` | n/a — it is the converter, for an ancestor |
| **CLAIM** | **true** | **none** | **nothing** |

`CLAIM` reserves and has neither a settling post-action nor a single row in `document_type_ref`. It
is a dead end, and that is provable from configuration rather than a matter of nobody having got
around to it yet.

**The accrual then fails quietly, exactly as designed.** `post_accrual_for_approval` recognises the
expense from the document's `ACTUAL` budget rows — for a compensation it reads its own, deliberately,
because *"it has no chain, and its accrual belongs to the document that was approved"*
(`gl-posting.service.ts`). With no `ACTUAL` there is nothing to recognise, so it logs
`Accrual skipped: no ACTUAL budget_txn` and records a **terminal** `SKIPPED`. Terminal is correct
for a genuine no-op and wrong here: the document is not a no-op, it is misconfigured, and the
terminal state means it is never retried and never appears as an undelivered posting.

Without the accrual the payment queue cannot see it either. `owedDocuments` asks two questions —
did an accrual credit a payable, or is the type `CUT_BUDGET`? — and a claim can only ever answer the
first. That is written down in `owed.ts`: *"A claim recognises its obligation at approval and its
type's post-action says nothing about who is owed, so only the ledger can speak for it."* The
reasoning is right; it just assumes an accrual that this configuration can never produce.

**The specification already requires the behaviour this configuration makes unreachable.**
`gl-journal` carries the scenario, unchanged and passing for the wrong reason:

```
#### Scenario: An approved claim is recognised
- GIVEN a document type that accrues at approval, and a document of that type with no vendor
  that cut budget against one expense account
- WHEN  the document reaches full approval
- THEN  a journal entry exists debiting that expense account and crediting CLAIM_PAYABLE
```

Read the GIVEN: *a document … that cut budget*. The scenario presupposes the claim cut budget,
because its author knew the accrual reads `ACTUAL` rows. The shipped `CLAIM` cannot cut budget. So
the reference configuration cannot produce the document this requirement is about — the rule is
right, and nothing in the box can exercise it.

**The damage is worse than a document that cannot be paid.** The budget is spent from the point of
view of everyone who reads a balance, and unspent from the point of view of everyone who reads the
books:

```
Office Supplies   appropriated 1,000,000
                  RESERVE        150,000   (CLAIM 50k · PR 50k · PROC 50k)
                  RELEASE              0
                  ACTUAL          50,000   (PR only)
                  available      850,000
                  committed      100,000   ← PROC 50k in flight, CLAIM 50k stranded
```

`committed` is `Σ RESERVE − Σ RELEASE − Σ ACTUAL`, and the budget-to-ledger reconciliation already
reports it per account. **That number is only interpretable if every reservation eventually
resolves.** A type that can never resolve turns it into a figure that grows and never comes back,
with nothing to distinguish work in progress from money lost behind a configuration error.

**This is the same defect the last two changes were about, one layer down.**
`finish-every-document-the-wizard-offers` stopped the wizard offering a document it could not
finish. `offer-only-the-doors-you-can-open` stopped it offering a screen the user could not open.
Both asked *can this be carried to a working end?* Nobody asks it of a document type's own
configuration, so a type that takes budget and cannot give it back is accepted without comment.

## What Changes

**A compensation claim settles its own reservation.** `CLAIM` is configured `post_action =
CUT_BUDGET`, joining `PR` in the shape the engine already supports — reserve at submit, convert to
actual at approval. This is not a workaround for the accrual: `accrues_on_approval` and a settling
post-action are two ways of saying the same thing about the same event, and a self-reserving type
that recognises its expense at approval must record that recognition in both ledgers or they
disagree. The accrual then finds the `ACTUAL` rows it was always written to read, the claim becomes
payable, and the transfer-slip column starts reporting on it.

**A type may not be configured to reserve budget with no way to release it.** A document type
whose `requires_budget` is true SHALL either settle its own reservation through its `post_action`,
or have a path through the configured reference pairings to a type that does. A configuration that
satisfies neither is refused when it is written, rather than accepted and discovered as a stranded
reservation months later.

The check is decidable, not a heuristic. `document_type_ref` is configuration, and it is what the
server already enforces on `POST /documents/from/:refId` — a successor that is not paired is
refused. So the set of documents that can ever settle a given reservation is exactly the set the
pairing graph allows, and walking it is walking three rows.

**Removing a pairing is checked the same way**, because the graph can be broken from either end.
Deleting `PO → DISB` would strand every reservation `PROC` takes, and the deletion is where that is
cheap to see. The codebase already answers this exact question for budgets —
`budgetsStrandedByDeactivating` refuses to deactivate a control point that would strand a budget —
and this is the same question about a different resource.

**The rule is enforced where the other configuration rules already live.** `DocumentTypeService`
already refuses a second `POST_JOURNAL` type per company and an unknown category; this joins them.

## Who this answers

| party | what happens today | after |
| --- | --- | --- |
| whoever approves a compensation claim | the claim completes and quietly holds budget forever | the reservation becomes spend, as approving it says it does |
| whoever pays it | the claim never reaches the payment queue | it appears, owed, with a slip to upload |
| whoever reads the books | an approved expense that was never recognised | the accrual posts at approval, as the type is configured to |
| whoever reads a budget balance | `committed` includes money that will never resolve | `committed` is work in progress and nothing else |
| whoever configures a new document type | may build a dead end and hear nothing | the configuration is refused, naming what is missing |
| whoever prunes a reference pairing | may strand every reservation an existing type takes | the deletion is refused while something depends on it |

## What This Change Does NOT Do

- **Does not repair `CLAIM-HAL-2026-0001`.** It is already `COMPLETED`, `budget_txn` is append-only
  (invariant 2), and no endpoint settles a document after its post-action has run. Correcting it is
  a question about accounting policy — a corrective release is not the same statement as a budget
  increase, and the ledger should not be made to say the wrong one for convenience. **It is left as
  it is, on a test database, as known-bad demo data**, and recorded here so the next person to read
  that 50,000 knows what it is rather than trusting it.

  Correcting the type changes what that document looks like, in one direction only, and the change
  is worth stating precisely. `owedDocuments` reads the **type's** `post_action`, not the document's
  history, so the moment `CLAIM` becomes a settling type the old claim appears in the payment queue
  alongside the new ones. Its budget reservation is still stranded and its accrual is still a
  terminal `SKIPPED`; only its visibility moved. It is therefore payable-looking and
  unrecognised — a narrower wrongness than before, and a different one. Anyone clearing that queue
  on the test database should know the first claim in it is the artefact, not a debt.
- **Does not change how the accrual works.** `post_accrual_for_approval` keeps recognising from
  `ACTUAL` rows, keeps distinguishing a vendor purchase that follows its chain from a compensation
  that reads its own, and keeps recording a terminal `SKIPPED` for a genuine no-op. The defect was
  never in that code; it was in a configuration that guaranteed it nothing to read.
- **Does not require every reservation to be resolved by the time a document completes.** `PROC`
  deliberately holds its reservation past `COMPLETED` so the `DISB` at the end of its chain can
  settle it. The question this change asks is not *"is this resolved yet?"* but *"can anything ever
  resolve it?"*, and it asks it of the configuration rather than of each document.
- **Does not touch `PR`'s configuration.** Whether a purchase requisition should convert its own
  reservation at approval — rather than at the disbursement that eventually pays it — is a question
  about the reference chain, not about this defect. It is coherent as it stands: it settles itself
  and, not accruing, books nothing until payment.
- **Does not add a report for stranded reservations.** Once the configuration cannot produce one,
  the existing `committed` figure means what it says. A report to find the stranded ones would be a
  tool for a problem this change removes.
