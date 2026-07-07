## Why

Today, when a workflow step restricts `jobLevels` and the requester has no `employee.job_level`,
the step is **silently skipped**. A requester who simply never had a job level recorded can therefore
route around a level-gated approval step and land a shorter chain than the configuration intended —
a silent authorization gap, not an error. We want the missing prerequisite to fail loudly at submit,
before any holds are created, instead of quietly weakening the approval chain.

## What Changes

- At submit, the system evaluates whether the document's bound workflow contains **any** step whose
  `condition_json` carries a non-empty `jobLevels` restriction (a *level-gated* workflow).
- **BREAKING (behavioral):** If the workflow is level-gated and the requester has no `employee.job_level`
  (no linked employee, or an employee with an empty/null `job_level`), the submit is **rejected** with a
  clear error. The document stays `DRAFT`, no budget/quota holds are created, and no routing starts.
- A requester **with** a `job_level` submits as before — the existing per-step `jobLevels` matching
  (include when matched, skip when not) is unchanged.
- A workflow with **no** level-gated step is unaffected: requesters without a `job_level` submit normally.
- The rejection message names the missing prerequisite so the requester/admin knows to set the
  employee's job level.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `approval-workflow`: The "Conditional Workflow Selection" behavior changes for the missing-`job_level`
  case. A missing requester `job_level` no longer silently skips level-gated steps; instead, submitting
  into a level-gated workflow without a requester `job_level` is rejected at submit time. The per-step
  matching rule for requesters who *do* have a `job_level` is unchanged.

## Impact

- **Spec:** `approval-workflow` — Conditional Workflow Selection requirement + a new submit-guard scenario.
- **Backend:** the submit path (document-engine submit lifecycle → auto-start routing) gains a
  pre-routing guard that inspects the bound workflow's steps for `jobLevels` and the requester's
  `employee.job_level`. No schema/DBML change — `employee.job_level` stays optional; the constraint is
  contextual (only enforced when the bound workflow is level-gated), not a column-level `NOT NULL`.
- **API/UX:** submit endpoint returns a validation-style error; `web-documents` submit flow surfaces it
  inline. No new tables, columns, or migrations.
- **Invariants:** touches no append-only ledger, FX-lock, or company-isolation rule; it only tightens
  when routing is allowed to begin. Guard runs inside the existing submit transaction so a rejected
  submit creates no holds (consistent with "if any step fails, no holds are created").
