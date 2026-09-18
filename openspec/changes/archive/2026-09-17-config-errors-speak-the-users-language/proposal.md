## Why

On `/new/doc-config/*` every refusal reaches the administrator as the server's English sentence in
a toast — `This would leave document type 'CLAIM_RECOVERY' reserving budget with no way to settle
it. Give it a settling post-action, or keep a reference pairing…` — while the screen around it is
in Lao. Forty-odd such sentences exist across document types, categories, form templates,
mappings, workflows and delegations; some print raw UUIDs (`Workflow 3f2a… not found`). The person
who reads them cannot tell what went wrong or what to do, and asked for the messages to be in a
language they read.

The example that raised it is also a wrong refusal. `CLAIM_RECOVERY` (a money-return type,
`ADJUST_INCREASE`) carries `requires_budget = true`, so the settle guard counts it as a reserving
type with no settlement. But (1) it is mapped to no department — the spec says such a type "cannot
have a document raised against it and therefore reserves nothing" — and (2) the guard runs on every
document-type write and inspects the whole company, so toggling the active switch on `REC` or any
other type is refused with a message about `CLAIM_RECOVERY`. A pre-existing fault blocks every
unrelated edit and names the wrong thing. On the production copy that is the state today.

## What Changes

- **Errors carry a message key the client can translate.** Alongside `code` (which stays what the
  platform spec says it is — a situation a caller *acts on* differently), an error response MAY
  carry `messageKey` and `params`. `message` stays the English text for logs, API clients and as
  the fallback. The web app's single error seam (`messageOf`) renders `errors.<messageKey>` from
  i18n with `params` when a translation exists, else the server's `message`. Every refusal in the
  configuration services — document type, category, form template, department mapping, reference
  pairing, workflow, step, delegation — gets a key, with en/la/zh text written for the person
  configuring the system, naming the thing by its code or name, never by UUID.
- **The settle guard binds only to raisable types and only to what this write breaks.** A type
  counts as reserving only while it is active, requires budget *and is mapped to at least one
  department* (the spec's own definition). A write is refused only for types that had a settlement
  before the write and would not after it; a type already without one is not this write's fault and
  does not block it. The refusal names that type, in the reader's language, and says the two ways
  to repair it.
- **`CLAIM_RECOVERY` itself** is repaired by configuration, not code: its `requires_budget` is
  turned off through the type editor (a money-return type takes no reservation — `BUDGET_ADJ_INC`
  is configured that way). Recorded here so the reason survives; no migration.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `platform-foundation`: *Every error response carries a stable code* — a response MAY additionally
  carry `messageKey` and `params` for human-readable translation; `code` semantics unchanged.
- `web-app-layout`: *Action Feedback and Confirmation* — the error toast shows the translated
  message when the server named a key the client knows, else the server's message.
- `document-engine`: *A Type That Reserves Budget Has A Way To Settle It* — reserving means mapped,
  active and budget-requiring; a write is refused only for the types it newly strands; the refusal
  is keyed.
- `web-doc-config`: configuration screens surface every refusal in the user's language.

## Impact

**Capabilities touched:** platform-foundation (error envelope), document-engine (config guards),
approval-workflow config services, web-app-layout and web-doc-config. No ledger, budget, quota or
routing behaviour changes; the settle guard becomes *less* restrictive only in the two ways the
spec already describes (unmapped types; pre-existing faults), never more permissive about a write
that breaks a settlement path.

**Invariants:** invariant 3 (derived balances) is what the settle guard protects; the diff-based
rule still refuses every write that removes a reserving type's last path. Invariant 7: the guard
reads `dept_doc_type` mappings and `document_type_ref` pairings — configuration — not type codes.

**Schema:** none.

**Code:** `back/src/common/errors/error-code.ts` (+ `explained()` helper), `coded-exception.filter.ts`
(pass `messageKey`/`params` through), `ref-chain.config.ts` (mapped + diff-based guard),
`document-type.service.ts`, `dept-doc-type.service.ts`, `ref-chain.service.ts`,
`document-category.service.ts`, `form-template.service.ts`, `workflow-config.service.ts` (keyed
refusals); front-end `utils/apiError.ts`, new `i18n/locales/{en,la,zh}/errors.ts`.

**Tests:** guard tests in `ref-chain` / `document-type` specs gain the "unmapped type does not
bind" and "pre-existing fault does not block an unrelated write" cases; a filter test proves the
envelope; a frontend test proves the seam prefers a known key and falls back otherwise.

**Rollout:** additive envelope fields; older clients ignore them. The mobile app reads `message`
only and keeps working. Deploy both targets; then the administrator turns off `requires_budget` on
`CLAIM_RECOVERY` (or leaves it — once the guard reads mappings it no longer blocks anything).
