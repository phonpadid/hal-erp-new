# Route the voucher through the workflow

## Why

A journal voucher is checked by exactly one person, whatever it says. A voucher moving 5,000 and a
voucher moving 50,000,000 take the same path and satisfy the same control.

That was a deliberate stopping point, and the reason it gave has since stopped being true. The
maker-checker change wrote: *"it is maker-checker rather than a configured chain: `approval_log`'s
document is a required foreign key to `document`, and a voucher is not a document."* The FK is real.
But the conclusion — that a chain therefore cannot exist — assumed a voucher could never BE a
document, and that assumption was never tested against what `document` actually requires.

Meanwhile the approval engine already holds everything a threshold ladder needs, unused by the one
capability that writes the ledger directly:

- `workflow_step.amount_min` / `amount_max` — the ladder, as data
- `approve_mode` — SEQUENTIAL, PARALLEL_ALL, PARALLEL_ANY
- `sla_hours` — escalation on a step nobody reaches
- `condition_json` — steps that engage by the requester's position level
- `approval_delegation` — approve-on-behalf during absence, one hop, with its own amount ceiling
- `show_signature_on_pdf` — the signature blocks on the exported document

So the system has two approval mechanisms: one configurable, audited and reusable, and one written
by hand for vouchers because of an FK. Every improvement to the first — a new escalation rule, a
delegation policy — silently does not apply to the single most privileged write in the system.

Materiality thresholds on manual journal entries are not an embellishment. They are the ordinary
segregation-of-duties control an auditor expects, and their absence is what "one checker for
everything" means in practice.

## What Changes

**A journal voucher becomes a document.** A seeded `JV` document type, a `workflow` with steps, and
a running number, so a voucher gets `JV-2026-0001` and rides the same route every other document
rides — the same inbox, the same delegation, the same SLA, the same audit trail in `approval_log`.

**Its payload stays where it is.** The document carries the header and the routing; `journal_voucher`
and `journal_voucher_line` stay as the voucher's accounting content, now hanging off the document.
The reason is not conservatism — it is that `document_line` cannot express a voucher line without
breaking the amount the ladder routes on. See design D1.

**Posting becomes a post-action.** `POST_JOURNAL`, beside `CUT_BUDGET` and the stock actions, so
"what does full approval do" stays configuration (invariant 7) rather than a branch on a type code.

**The ladder ships as data, not as code.** The seed installs a two-band route — one approver below a
threshold, a second above it. The numbers are `workflow_step` rows: a company changes its policy by
editing configuration, which is the entire reason for doing this rather than growing a bespoke
ladder in the GL module.

**A closed period is refused before an approver is asked.** Today the period guard fires inside the
approval transaction, so a voucher whose month closed while it waited would fail at the last step and
roll back an approval the approver correctly gave. The guard moves forward: checked at submit, and
checked again before each approval is accepted.

## What This Change Does NOT Do

- **Does not weaken the ledger rules.** Balance, the company's calendar day, the closed-period
  refusal, account resolution and append-only all still come from `createEntry` and the
  chart-of-accounts resolver. Nothing about how an entry is written changes.
- **Does not make a voucher budget-bearing.** `requires_budget` stays false. An accountant correcting
  the ledger is not adjusting anyone's budget (invariants 3 and 6).
- **Does not set anyone's approval policy.** The seeded thresholds are a working default, and a
  default is not advice about what a company's limits should be.
- **Does not touch the reversal's arithmetic.** A reversal is still the original's lines with the
  sides exchanged, still at most once per entry. It just rides the same route now.
- **Does not move `GL_JV_POST`.** Preparing a voucher stays its own privilege; what changes is who
  must approve it and how many of them.
