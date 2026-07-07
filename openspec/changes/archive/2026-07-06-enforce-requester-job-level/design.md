## Context

The approval router already reads `employee.job_level` to include/skip a step whose
`workflow_step.condition_json` carries `{ "jobLevels": [...] }`. The current rule treats
"requester has no `job_level`" the same as "requester's level not in the list" — the step is
skipped. That makes a data gap (an unset job level) indistinguishable from a deliberate
non-match, so a requester can silently route around a level-gated step.

Submit is already transactional: the document-engine submit lifecycle validates fields, locks FX,
checks the fiscal period, then transitions `DRAFT → SUBMITTED`; auto-start routing then begins on
the submit event. `employee.job_level` is nullable in `erp_approval_system.dbml` and stays that way.

## Goals / Non-Goals

**Goals:**
- Fail submit loudly when the bound workflow is *level-gated* and the requester has no `job_level`.
- Keep existing per-step matching unchanged for requesters who have a `job_level`.
- No schema/migration change; no impact on non-level-gated workflows.

**Non-Goals:**
- Making `employee.job_level` a `NOT NULL` column (would break existing rows and unrelated flows).
- Changing how a *present-but-non-matching* level behaves (still skips, as today).
- Validating job level at employee creation or promotion time.

## Decisions

**Decision: Enforce contextually at submit, not via a column constraint.**
The requirement is conditional — only meaningful when the bound workflow actually has a
`jobLevels` step. A `NOT NULL` on `employee.job_level` would force a level on every employee
regardless of any workflow and break existing data. Instead the submit path computes
`isLevelGated(workflow)` = any step has non-empty `jobLevels`, and blocks only that combination.
*Alternative considered:* a DB constraint — rejected for the reasons above.

**Decision: Guard inside the submit transaction, before routing starts.**
Place the check in the auto-start-routing step of submit (or immediately before it), within the
same `em.transactional(...)` as the rest of submit. On failure the transaction rolls back, so no
holds and no `approval_log`/routing rows are created — consistent with document-engine's
"if any step fails, no holds are created and the document stays `DRAFT`". Reusing the existing
step-inclusion evaluator keeps the "level-gated" definition identical to the routing logic, so
the guard and the router cannot drift.

**Decision: "No `job_level`" covers both no linked employee and null/empty level.**
The router already needs the requester's employee to read `job_level`; treat a missing employee
link or a null/blank `job_level` uniformly as "no job level" for the guard.

**Decision: Error shape mirrors other submit validation failures.**
Return the same validation-style error the submit endpoint already uses for missing required
fields / closed period, with a message naming the missing job level, so `web-documents` surfaces
it inline without new UI plumbing.

## Risks / Trade-offs

- **Existing employees with no job level can no longer submit into level-gated workflows** →
  Mitigation: message names the fix (set the employee's `job_level` via web-employee-admin); admins
  can also drop the `jobLevels` restriction from the step if the gate was unintended.
- **A workflow edited to add a `jobLevels` step now blocks previously-fine requesters** → this is the
  intended tightening; documents already `SUBMITTED`/`IN_APPROVAL` are unaffected (guard runs only at
  submit).
- **Case/whitespace mismatch between stored `job_level` and `condition_json` values** → keep the
  guard's "is-gated" check purely structural (non-empty `jobLevels` array), and reuse the router's
  existing level-comparison for matching so both sides normalize identically.

## Migration Plan

No data migration. Ship the guard behind the normal deploy. Rollback = revert the guard code;
behavior returns to silent-skip. Before/after deploy, optionally report employees who have no
`job_level` but could submit into a level-gated workflow, so admins can backfill levels.

## Open Questions

- None blocking. (If a future need arises to *warn* rather than *block*, it would be a separate,
  configuration-driven change.)
