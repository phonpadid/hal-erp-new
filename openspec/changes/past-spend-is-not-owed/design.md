## Context

`owedDocuments` is the single predicate behind the ready-to-pay queue, the batch builder (via `readyToPay`), the slip-status column and the record-payment guard. Its two clauses are the ledger's answer (an accrual credited a payable) and the configuration's answer (`post_action = CUT_BUDGET`). `records_past_events` marks a type used to write down what already happened. It is a type flag, so this is configuration, not per-type code (invariant 7).

## Decisions

- **D1: Narrow the configuration clause, keep the ledger clause.** The new predicate is `accrued OR (CUT_BUDGET AND NOT records_past_events)`. "Past event" says the payment already happened, so the post-action is not evidence of a debt. An accrual credit is a booked obligation, and the ledger still outranks configuration.
- **D2: Exclude, don't auto-record a payment.** Recording a synthetic `payment` row would need a bank account, a rate and evidence that the system does not have for historic spend. It would also post GL for money the old books may already hold. Exclusion is the reversible, minimal fix.
- **D3: No branching on the code `SPEND_HIST`.** Branching only on the flag keeps invariant 7.

## Risks / Trade-offs

- A past-event type set up by mistake for real, current payables would hide those from the queue. Mitigation: the flag's meaning is "this money already moved", the type form already describes it that way, and switching the flag off brings the documents back, because the queue is derived.
- Past-spend documents produce no payment-driven GL entry. If accounting needs that expense in the GL, it goes in through a journal, as it did before this system.
