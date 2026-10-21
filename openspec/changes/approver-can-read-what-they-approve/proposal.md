## Why

A document can sit in an approver's inbox (`ການອະນຸມັດ`) and answer 404 when they open it. The two
screens answer different questions: the inbox asks `ApproverResolverService` who may act on the
current step **now** (live `user_company_role` holders, delegates, escalation), while the document
read admits an approver only through the `document_approval_step_actor` rows frozen when the step
opened. Anyone granted the role after the step opened — or every holder, when the role had none at
that moment and the empty actor list was never revisited — is asked to sign a document they cannot
read. It happened on production in early October 2026 (fixed by hand per user); the 2026-10-13
data shows no case today, but every role grant made while documents are pending can create one.

## What Changes

- Add a fifth party source to the document visibility predicate: **the reader is, right now, an
  eligible approver of the document's current step**, resolved by the SAME
  `ApproverResolverService.eligibleMany` rules the inbox and the approve action use. If the system
  lets you approve a document, it lets you read it.
- The source is narrowed to `IN_APPROVAL` documents of the active company, at their current step,
  that the reader did not create — and is resolved from a small candidate set (steps that target
  the reader, a role the reader holds, a principal who delegated to the reader, or an escalation to
  the reader), so a list or detail read stays a fixed number of queries.
- The existing delegation source compares its window to the company's day (`company.timezone`), as
  the resolver does, instead of the server's UTC day.
- Visibility only. No action, no route, no recorded actor and no PARALLEL_ALL coverage changes —
  `document_approval_step_actor` stays frozen at step open.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-engine`: *A Reader Never Loses The Documents They Are Party To* gains the live-eligible
  source, so a document in someone's approval inbox is always readable by them.

Touches capabilities: document-engine (read predicate), approval-workflow (read-only reuse of the
resolver; no requirement change), rbac (role validity windows are read, not changed).

Cross-capability invariants at risk, and how they hold:
- **Company isolation (1):** the candidate set and the resolver are confined to the active company.
- **No self-approval (8):** unchanged — the resolver excludes nobody new and grants no action; the
  creator already reads their own document by `created_by`.
- **Permission codes (5):** visibility is widened by being party to the workflow, as the existing
  four sources already do; no role name is consulted.

## Impact

- `back/src/modules/document/document.service.ts` — `visibleWhere` / `partyDocumentIds` /
  `delegatedDocumentIds`. Every document read goes through this predicate: list, detail, PDF,
  attachments, approval history, 3-way match.
- `back/src/modules/approval/approver-resolver.service.ts` and `document-route.service.ts` — reused
  as-is (`eligibleMany`, `currentStepsOf`, shipped with the inbox speed fix).
- No migration, no schema change, no API shape change, no frontend change.
- Tests: document visibility specs, plus an invariant test "every document the inbox lists for a
  user is readable by that user".
