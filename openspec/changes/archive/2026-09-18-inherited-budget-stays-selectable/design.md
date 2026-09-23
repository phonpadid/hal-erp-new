## Context

`BudgetService.listSelectable(departmentId?)` returns the budgets the caller may charge: at
`DOC_CREATE` DEPARTMENT scope, the home department's plus shared nodes; wider scopes see the
company's. `CreateDocumentView` loads it once and `LineItemsEditor` treats any line whose
`budgetId` is not in the list as "lost" (`unavailableValue`), which the step gate counts as
missing. `createFrom` copies predecessor lines with their `budgetId`; the server's `setLines` and
submit never compare a line's budget with the document's department (control points govern
through the *budget's* department). So an inherited budget is valid everywhere except the picker.

## Goals / Non-Goals

**Goals:**
- A draft's existing line budgets are always offered back to whoever edits it.
- Say which ones are inherited, so the requester is not misled into thinking they may pick
  siblings of that budget.
- No new money on the wire; no widening beyond what the document already carries.

**Non-Goals:**
- Parent-department budgets for child departments in general.
- Server-side validation of line budgets against departments (deliberately absent today).

## Decisions

### 1. Widen by `documentId`, not by predecessor or department tree

Alternatives: (a) walk `parent_dept_id` upward — changes the meaning of DEPARTMENT scope for
every requester, not just successors; (b) resolve the predecessor's budgets — the successor's
lines already carry exactly those, and a draft the requester re-budgeted should be offered *its*
budgets, not its ancestor's. The document's own lines are the smallest true answer.

### 2. Company scoping is the authorization

The read is gated on `DOC_CREATE`. The `documentId` lookup is `document_line` joined to
`document` filtered by the active company; a document of another company yields nothing (not a
404 — the read is a list). Naming a document id the caller cannot open reveals at most which
budgets (identity, no amounts) are on it, which `DOC_CREATE` in that company already lets them
enumerate via their own picker. Accepted; noted here so nobody mistakes it for a leak later.

### 3. `inherited` is computed against the caller's own set

Rows the caller could select anyway are returned once, unflagged; rows added only because the
document carries them get `inherited: true`. The client groups them under one heading
(`documents.create.line.inheritedBudgets`) placed first, and `budgetLost` is false for them
because they are in the list — no special case in the gate.

### 4. Only ACTIVE budgets, still

An inherited budget whose status is no longer ACTIVE stays unavailable: the line really must be
re-budgeted. Same rule as the base read.

**Budget/quota writes**: none.

## Risks / Trade-offs

- [A client that never sends `documentId` (API-key integrators)] → unchanged behaviour.
- [A requester edits a draft they did not raise, in a department that does not own its budgets]
  → they see those budgets, may keep them, may not pick others. Same as before the block existed.

## Migration Plan

None — additive query parameter and response field.

## Open Questions

None.
