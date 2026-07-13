## Context

Documents are created by requesters who are not accountants. Today the flow forces two
accounting-shaped choices onto them: the line GL account and (via the selectable-budgets
read) the budget line. Two specs also disagree — `master-data` said the line GL is
"editable by the user" while `web-documents` said it is auto-filled read-only. The DBML
already supports doing better: `item.default_gl_account` exists ("ช่วย auto เลือกหมวดงบ
ตอนสร้าง PR"), `budget` is unique on `(fiscal_year_id, department_id, gl_account)`, and
`document` carries `department_id`. So an item selection is enough to pin both the GL and
the budget line deterministically.

## Goals / Non-Goals

**Goals:**
- Requester picks the **item** (the "what"); server derives the line's `gl_account` and
  resolves `budget_id`.
- Remove any requester-facing raw GL entry; make GL server-authoritative.
- Fail loudly (clear error) when an item-backed line cannot resolve a budget on a
  `requires_budget` type.
- Reconcile `master-data` with `web-documents` on the read-only GL behavior.

**Non-Goals:**
- No change to how budget is reserved/converted/released (invariants 3–5).
- No DBML/schema change — all needed columns already exist.
- No change to the chart-of-accounts resolver or the `gl-journal` posting engine.
- Not building an item→GL admin UI (that is master-data maintenance, out of scope here).

## Decisions

- **Item is the single input; GL and budget are derived server-side.** Alternative: keep
  the requester picking the budget with GL merely displayed. Rejected — it still exposes
  accounting choices and leaves the two-spec conflict unresolved. Deriving both matches the
  DBML's stated intent and invariant 7 (configuration over code).
- **Budget resolved by `(fiscal_year, department, gl_account)` unique key.** The fiscal
  year is the company's `fiscal_year` whose `[start_date, end_date]` contains the document
  date; department is `document.department_id`; gl_account is the item default. This triple
  is the existing unique index, so the resolution is deterministic (0 or 1 row). Alternative
  (resolve by budget name or free choice) rejected as ambiguous.
- **Server ignores any client-sent `gl_account` on item-backed lines.** The client may send
  only `itemId`; the server overwrites GL from the item master. Prevents client/server
  drift and tampering — the frontend guard is UX only.
- **Block-with-error, not silent fallback, for unresolvable item lines.** On a
  `requires_budget` type, an item with no default GL or no matching `ACTIVE` budget rejects
  the save/submit with a message naming the gl_account/department/fiscal year. Alternative
  (auto-create a budget, or reserve nothing) rejected — it hides misconfiguration and
  risks uncontrolled spend.
- **Explicit budget picker survives only as a fallback for item-less lines.** Free-text
  lines (no item) on a `requires_budget` type still need a budget, so the selectable-budgets
  read stays for that case. A new resolve-budget read (by GL/dept/year) backs the primary
  item path.
- **Resolution happens at line save and is re-validated at submit.** Budgets can be
  deactivated between draft and submit, so submit re-resolves rather than trusting the
  stored `budget_id`. Consistent with the locked-FX-at-submit pattern.

## Risks / Trade-offs

- **Item master lacks GLs / budgets not set up for a department** → many lines would block.
  Mitigation: clear, specific errors pointing finance at the exact missing setup; the
  fallback picker covers item-less lines in the meantime.
- **Document date outside any fiscal year, or fiscal year `CLOSED`** → no resolution.
  Mitigation: treat as a rejection with a period-specific error (aligns with existing
  closed-period submit guard).
- **Multiple budgets for one triple** → impossible by the unique index; resolution is
  single-row by construction.
- **Existing drafts** created under the old flow may carry a client-chosen GL. Mitigation:
  on next edit/submit, re-derivation overwrites GL from the item and re-resolves budget; no
  data migration needed since columns are unchanged.

## Reference: Document Creation Case Matrix

Governing rule (holds for every case): **the requester never picks a raw GL code.** The GL
reaches a line one of three ways — derived from the selected **item**, carried by the
**budget** the requester picks, or **not applicable** (the document does not spend money).
The only real variables are *does the line need an item?* and *does the type need a budget
(`requires_budget`)?* All behavior is driven by `document_type` config, not hardcoded per
type (invariant 7).

| Document (real example) | `category` | Item | Budget (`requires_budget`) | Requester picks GL? | Where GL/budget comes from |
|---|---|:---:|:---:|:---:|---|
| PR/PO for catalog goods (PCs, materials) | PROCUREMENT | Recommended (receiving / 3-way) | yes | no | item → GL + budget auto-resolved |
| PR/PO for services (cleaning, consulting) | PROCUREMENT | Not needed (free-text) | yes | no | requester picks budget (budget carries GL) |
| Utilities (electricity / water / internet) | FINANCE | Optional* | yes | no | item → auto **or** pick budget |
| Cash advance / petty cash | FINANCE | Not needed | yes | no | requester picks budget |
| Travel / reimbursement | FINANCE | Not needed | yes | no | requester picks budget |
| Advance clearing | FINANCE | Not needed | yes | no | inherited from the referenced advance |
| Leave (annual / sick) | HR | none | no (uses **quota**) | no | GL not involved |
| Overtime request | HR | none | no or yes** | no | quota / OT budget |
| Promotion (PROMOTE) / Resignation (RESIGN) | HR | none | no | no | not involved |
| General approval / IT service request | ADMIN·IT | none | no (approval only) | no | not involved |

\* Utilities: define a standing `item` with a default GL → picking the item auto-resolves
GL + budget; otherwise the requester types a description and picks a budget.
\*\* Overtime: set `requires_budget = true` only if the organization budgets OT pay.

Reading the matrix:
- **Item is needed only** when the line must support goods receiving / 3-way matching /
  stock. Services, expenses, and HR documents do not need an item.
- **Budget is needed** strictly per the `requires_budget` flag — money-spending documents
  only. HR leave/promotion/resignation and approval-only documents carry no budget.
- **GL always rides on the budget (or the item), never a requester input.**

Known gap (out of scope for this change): `document_type` has `requires_vendor` but **no
`requires_item`**, so the schema cannot force a line to carry an item (`item_id` is always
nullable). Enforcing "procurement-goods lines must use an item" would need a new
`requires_item` flag and its own proposal.

## Migration Plan

- Pure behavior change, no schema migration. Deploy backend (derivation + resolve read +
  submit re-validation) and frontend (item-primary editor, GL/budget read-only, picker
  demoted) together.
- Rollback: revert both deployments; stored `document_line.gl_account`/`budget_id` remain
  valid under the old flow.

## Open Questions

- Should an authorized finance role be allowed to override a blocked line inline in a later
  iteration? Current decision is block-only; revisit if it proves too rigid in practice.
