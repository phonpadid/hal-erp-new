## 1. Router / gating helper

- [x] 1.1 Add an `isLevelGated(workflow)` helper in the approval-workflow module that returns true when any `workflow_step.condition_json` has a non-empty `jobLevels` array; reuse the existing step-inclusion evaluator so the definition matches routing logic
- [x] 1.2 Add a `resolveRequesterJobLevel(document)` helper that reads the requester's linked `employee` and returns its `job_level`, treating no linked employee or a null/blank `job_level` uniformly as "no job level"

## 2. Submit guard

- [x] 2.1 In the submit lifecycle (auto-start-routing step), inside the existing `em.transactional(...)`, reject the submit when `isLevelGated(boundWorkflow)` is true and the requester has no job level; throw the same validation-style error used by other submit failures, with a message naming the missing job level
- [x] 2.2 Ensure the rejection leaves the document `DRAFT` and creates no budget/quota holds, no `approval_log`, and no routing rows (transaction rolls back)
- [x] 2.3 Confirm requesters with a present `job_level` and non-level-gated workflows are unaffected (existing include/skip matching unchanged)

## 3. API / frontend surfacing

- [x] 3.1 Verify the submit endpoint returns the guard error in the standard validation error shape
- [x] 3.2 Surface the error inline in the `web-documents` submit flow (no new UI plumbing; reuse existing submit-error handling)

## 4. Tests

- [x] 4.1 Unit: level-gated workflow + requester with null/empty `job_level` → submit rejected, document stays `DRAFT`, no holds/routing
- [x] 4.2 Unit: level-gated workflow + requester with no linked `employee` → submit rejected
- [x] 4.3 Unit: non-level-gated workflow + requester with no `job_level` → submit succeeds and routes
- [x] 4.4 Unit: requester with a present `job_level` → existing include/skip behavior unchanged (MANAGER includes, STAFF skips a MANAGER-gated step)
- [x] 4.5 Concurrency/transaction: a rejected submit produces no `budget_txn`/`quota_usage`/`approval_log` rows
