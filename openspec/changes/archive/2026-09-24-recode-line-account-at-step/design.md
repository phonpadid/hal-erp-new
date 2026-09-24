## Context

`document_line.account_id` is the account the ledger debits for a line. It is resolved at submit
from configuration — the item's `item_company.default_gl_account`, else the type's
`default_gl_account`, else the budget's `gl_account` (`line-account-chain.ts`) — checked to name an
active, postable account of the company, and stamped as a foreign key
(`document-submit.service.ts` `resolveLineAccounts`). From then on nothing moves it: `assertEditable`
refuses every line write outside DRAFT, and the posting (`gl-posting.service.ts` `expenseByAccount`)
reads the stamp, falling back to `budget.account_id` for lines that predate it.

The stamp is frozen for a good reason — re-deriving it at payment would let an item's default GL,
edited after approval, move the account a settlement debits with the entry still balancing. But
"frozen from configuration" has been read as "frozen from people", and the people who know the
chart of accounts are the last step of every HAL route (`ບັນຊີ`, step 5 of
`ສາຍອະນຸມັດເບີກຈ່າຍ (5 ຂັ້ນ)`; steps 6–7 of `Full Approval Chain`). The item registry, since
`an item names one budget, not the account behind it`, stamps an item's GL from its bound budget, so
every item on budget `6.101` posts to the one account `6.101` names, and the budget's real shape —
several accounts under one plan line — is unreachable from the document.

Two precedents shape this change and are reused rather than paralleled:

- **`requires_payment_slip`** (`mid-approval-slip`, archived 2026-09-03): a boolean on
  `workflow_step`, copied to `document_approval_step` at submit by `DocumentRouteService`, read from
  the route by the approve path, authored in `WorkflowStepCreateView.vue` beside a "your approver
  could not satisfy this" notice, rendered on `WorkflowDetailView.vue`.
- **`RESTATE_RATE`** (`finance-states-the-document-rate`, `DocumentRateService`): a person changes
  one document's stamped value mid-route, under the document's `PESSIMISTIC_WRITE` lock, only while
  `IN_APPROVAL` with a pending step and no payment, and the change is one `approval_log` row with
  before → after in `remark`.

One wrinkle the precedents do not cover. On a chain (PR → PO → DISB) the reservation, and so the
`budget_txn` ACTUAL rows, live on the PR; `expenseByAccount` reads the lines of the document the
ACTUAL row names — the PR's — so a change to the DISB's lines would post nothing different. The
GRNI split beside it (`stockPortionByAccount`) already reads the posted document's own line first
and the charged ancestor's second; the expense side does not.

Stakeholders: accounting (the actor), `WORKFLOW_MANAGE` admins (who turn it on per step),
requesters and earlier approvers (whose approvals must stay meaningful), the GL reader (who must
be able to see that an account moved and who moved it).

## Goals / Non-Goals

**Goals:**

- Let the approver of a configured step move one line's posting account to another postable
  account of the company, while the document is still refusable, attributed in `approval_log`.
- Reach the ledger: an accrual or settlement posted after the recode debits the recoded account,
  including when the document being posted is the tail of a chain.
- Leave master data, the budget, every amount, every `budget_txn`, and every earlier approval
  untouched.
- Same authoring and visibility shape as the slip requirement, so an admin who has configured one
  recognises the other.

**Non-Goals:**

- Choosing an account at DRAFT, or changing how an item/type/budget resolves a default. The
  requester still gets a configured default; this change is the correction after it.
- Recoding after an entry exists. That is `Any Entry Can Be Reversed, Once` plus a voucher.
- Moving a line to another budget, changing a quantity or amount, or splitting a line in two. A
  budget that must post to two accounts through one line needs two lines, which the requester
  writes at DRAFT (RETURN) — splitting mid-route would change the reservation.
- Backfilling `document_line.account_id` on documents submitted before the stamp existed.
- Reading the flag from `workflow_step` live for documents already routing.

## Decisions

### The line is overwritten; the history is the log

`document_line.account_id` and `document_line.gl_account` are updated in place. No override column,
no shadow "original account" column.

Why: the ledger has exactly one seam that answers "which account does this line post to" —
`l.account ?? l.budget?.account` in `expenseByAccount`, `stockPortionByAccount`, `accountByLineOf`
and the RNI report — and adding a second column means touching every one of them and inventing a
precedence rule each could get wrong. The value before the recode is not lost: `approval_log` is
append-only and the `RECODE_ACCOUNT` row carries it, which is the same place the rate before a
`RESTATE_RATE` lives. "What did the requester submit" is a history question and history is the
log's job.

`gl_account` is kept in step with `account_id` (set to the new account's `code`) because the detail
view, the PDF and the line table render `gl_account`, and a display code disagreeing with the
posting account is precisely the silent divergence the stamp was introduced to end.

Alternative considered — `document_line.recoded_account_id` read in preference: rejected for the
seam count above, and because "recoded" becomes a permanent second meaning of the row that every
future reader has to remember.

### The action is its own service and endpoint, not an `act()` action

`POST /documents/:id/lines/:lineNo/recode-account { accountId }` guarded by `DOC_LINE_RECODE`,
served by `DocumentLineRecodeService.recode(documentId, lineNo, accountId)` in `modules/document`.
It is not a new `ActDto.action`.

Why: `act()` is the verdict path — it opens and closes route steps, releases holds, emits
`approval.outcome`. A recode does none of that; it is a correction made *between* verdicts, like a
restatement. Putting it through `act()` would mean every branch of the verdict path learning to
skip itself for one action. `DocumentRateService` is the model: a service of its own that borrows
the approve path's lock and its eligibility resolver.

The service depends on `DocumentRouteService.routeStep` and `ApproverResolverService.eligible`
(both in the approval module) exactly as `ApprovalRoutingService.act` does, so "eligible for the
current step" has one definition. It lives in `modules/document` because it writes `document_line`,
and the document module already imports the approval module for `applicableSteps`.

### Gates, in order, all before the write

Under `PESSIMISTIC_WRITE` on the `document` row, inside one `inTransaction`:

1. Document exists in the active company (company filter on, so another company's document is
   not-found — invariant 1).
2. `status === IN_APPROVAL`, else refused naming the status.
3. The current route step (`routeStep(documentId, currentStepNo)`) has `allowsAccountRecode`,
   else refused naming that this step does not allow it. Read from `document_approval_step`, not
   `workflow_step` (invariant 7, and the slip precedent's reasoning: the route is what the document
   is running).
4. The acting user is in `resolver.eligible(step, document)` — principal or active delegate — else
   `Forbidden`. Self-approval (invariant 8) is not checked: a recode is not an approval, and a
   creator who is somehow also the eligible accountant changes nothing about who approves. It is
   still refused in practice because the creator is never an eligible approver of their own
   document, but that is the resolver's rule, not this service's.
5. No `journal_entry` whose `source_id` is this document (accrual, settlement). Belt and braces
   — `IN_APPROVAL` already precedes both — but it is the invariant the whole change rests on and it
   costs one indexed read.
6. The line exists on this document and has a positive `line_amount`; a zero line posts nothing
   and is refused rather than silently "recoded".
7. The target `account` is in the active company, `is_active`, `is_postable`. Same three checks
   `resolveLineAccounts` applies at submit, same message shape.
8. The target differs from the current account, else refused as a no-op — an `approval_log` row
   saying "612.06 → 612.06" is noise in an append-only table.

Only then: set `line.account`, `line.gl_account = account.code`, persist one `ApprovalLog`
(`stepNo = document.currentStepNo`, `approver = actingUser`, `delegatedFrom` from the eligibility
entry, `action = RECODE_ACCOUNT`, `remark = "line <n>: <old code> → <new code>"` — free text is
the log's shape; `RESTATE_RATE` writes `rate a → b` the same way), commit.

Gate 5 answers the concurrency question directly: the last APPROVE and the recode both take the
document's row lock, so they serialise. If APPROVE lands first the document is `COMPLETED` and
gate 2 refuses; the accrual then posts (asynchronously, via `approval.outcome`) on lines the recode
never touched. If the recode lands first, the approve path reads the recoded lines. There is no
interleaving in which the entry is written from lines that then change.

### The expense side reads the posted document's line first

`expenseByAccount(tem, actuals, documentId, verb)` currently, per ACTUAL row, loads the lines of
`txn.document` (the charged document) and takes `l.account ?? l.budget?.account`. It will
additionally load the lines of `documentId` (the document being posted) once, keyed by `line_no`,
and take, per charged line: the posted document's line's `account` for the same `line_no`, else the
charged line's `account`, else the charged line's `budget.account`.

When `documentId === txn.document.id` — every non-chained document — the first and second reads
are the same line and behaviour is unchanged. When they differ, the posted document's stamp wins
where it exists.

Why this and not "write through to the ancestor's line": the DISB is the document accounting saw
and signed; its lines are the ones the recode was made on and the ones the PDF shows. Writing to a
`COMPLETED` PR's lines from a DISB's approval step would change a document its approvers already
closed, which is worse than the problem. And `stockPortionByAccount` already reads own-line-first,
so this makes the two sides of the GRNI split agree by construction rather than by coincidence.

Consequence worth stating: a chained document whose own stamp differs from its ancestor's *without*
a recode — the item's GL changed between the PR's submit and the DISB's — now posts on the DISB's
stamp, where before it posted on the PR's. Both are "the stamp the approvers of that document saw";
the DISB's is the later and the one accounting approved. This is recorded in the gl-journal delta
as a scenario so it is a decision, not a surprise.

The `line_no` match is the same assumption `cutBudget` and `stockPortionByAccount` already make
(`create-from` copies a chain 1:1 with `line_no` preserved).

### The flag is per step, copied to the route, and needs a permission the approver may not hold

`workflow_step.allows_account_recode` → `document_approval_step.allows_account_recode` at submit
(`DocumentRouteService`, next to `requiresPaymentSlip`). Authored through the existing step
create/update DTOs under `WORKFLOW_MANAGE`.

The permission code is new — `DOC_LINE_RECODE`, declared in `modules/document/permissions.ts` and
in `seed-data`'s catalog so `permissions:sync` creates the row and `PermissionCatalogService`
reports its absence — rather than reusing `GL_JV_POST` or `DOC_APPROVE`. `DOC_APPROVE` is held by
every approver and would let a department head recode; `GL_JV_POST` is the right people but the
wrong privilege (writing a voucher is larger than moving a line's account, and a company might
grant one without the other). A code of its own costs one catalog entry and lets the editor's
"your approver could not use this" notice ask a precise question.

Like the slip, the step editor *says* when the configured approver role holds no
`DOC_LINE_RECODE` and does not refuse the configuration — the grant can come afterwards.

### The UI edits the line where the approver already acts

`DocumentDetailView.vue` is where an approver opens a document and approves it (`can-act`). It
gains, on the lines table, an account cell that becomes an action when: the document is
`IN_APPROVAL`, the current route step carries the flag, `can-act` is true, and the user holds
`DOC_LINE_RECODE`. Everything but the last rides on the detail read, which already answers
`slipRequired`, `hasSlip` and `canRestateRate` for exactly this reason: it gains
`accountRecodeAllowed` (the current route step's flag — the same `currentStep` read `slipRequired`
uses) and `canRecodeAccount` (that, and `IN_APPROVAL`, and `can-act` for the viewer). The gates the
service applies are asked here without the lock, so the UI states *why* it cannot rather than
hiding the control. The picker lists postable, active accounts of the company (existing
`accounts` API, filtered), shows code and name, and submits one line at a time; on success the
detail refetches, which refreshes both the lines and the approval history.

The history renders `RECODE_ACCOUNT` as "Re-coded line n: a → b" from `remark`, localised label,
same row shape as `RESTATE_RATE`.

### DBML

`workflow_step` and `document_approval_step` each gain `requires_payment_slip` (overdue) and
`allows_account_recode`; `approve_action` gains `RECODE_ACCOUNT`; `document_line.account_id`'s note
gains one sentence: a person on a step that allows it may restate this, attributed in
`approval_log`, only while the document is in approval. No new table.

## Risks / Trade-offs

- [An accountant recodes a line to an account of the wrong type — a liability where the budget
  meant expense] → The picker and the service check `is_postable` and company only, not
  `account_type`; a budget that is genuinely principal + interest *needs* a liability account on
  one line. The log row makes the choice reviewable, and the trial balance is the control.
- [The recode is made, then the document is RETURNED to DRAFT and resubmitted] → Resubmit
  re-stamps every line from configuration (`resolveLineAccounts` runs again) and the recode is
  lost; the log row survives. This matches the rate: a restatement does not outlive a return.
  Stated in the document-engine delta so nobody expects otherwise.
- [Own-line-first changes which stamp a chained document posts on, even with no recode] → Only
  where the two stamps differ, which needs an item GL edit between two submits of one chain. Made
  explicit as a gl-journal scenario. The alternative — write-through to a closed ancestor — was
  judged worse.
- [`DOC_LINE_RECODE` is declared but the live catalog lacks the row after deploy] → The deploy runs
  `permissions:sync`; `PermissionCatalogService` logs at boot and the admin screen shows the gap.
  The step editor's notice will also read "no role holds it" until granted.
- [A recode races the final APPROVE] → Both take the document's `PESSIMISTIC_WRITE`; whichever is
  second sees the first's result (gate 2 or the recoded lines). Concurrency test required.
- [Two recodes of one line race] → Serialised on the same lock; two log rows in order, last write
  wins, gate 8 refuses a second identical write. Test required.
- [The approver on the flagged step is also the document's creator] → Not eligible to approve, so
  not eligible to recode either (gate 4). No new self-approval surface.

## Migration Plan

One migration, `Migration2026091100000_recode_line_account`:

1. `alter table workflow_step add column allows_account_recode boolean not null default false`.
2. `alter table document_approval_step add column allows_account_recode boolean not null default
   false`.
3. Widen `approval_log_action_check` to `(... , 'RESTATE_RATE', 'RECODE_ACCOUNT')`, in the shape of
   `Migration20260906100000`.

No backfill; every existing row stays valid. `down()` drops the two columns and re-narrows the
check — safe only if no `RECODE_ACCOUNT` row has been written (invariant 2 forbids deleting one);
otherwise leave the check widened, as the rate migration says.

Deploy order: migration → `permissions:sync` (creates `DOC_LINE_RECODE`) → release. Both remotes
(`origin`, `production`) need it. Turning the flag on for HAL's accounting step and granting the
code to `ຫົວໜ້າບັນຊີ` / `ພະນັກງານ (ບັນຊີ)` is an operational step done through the admin screens
after release, not part of the migration.

## Sequence and transaction notes

Recode (no `budget_txn`, no `quota_usage`):

```
POST documents/:id/lines/:n/recode-account
  → inTransaction
      SELECT document FOR UPDATE           (company filter on)
      gates 2–8 (route step, eligibility, no journal_entry, line, account)
      UPDATE document_line SET account_id, gl_account
      INSERT approval_log (RECODE_ACCOUNT, remark before → after)
    commit
```

Final approve, then posting (existing paths, unchanged except the read order in `expenseByAccount`):

```
act(APPROVE)  → SELECT document FOR UPDATE … INSERT approval_log … COMPLETED … emit approval.outcome
                 (serialises with a recode on the same row lock)
doPostAccrualForApproval / postForPayment
  → settlementActuals (chain walk, unchanged)
  → expenseByAccount: lines of posted doc (own) ⨝ lines of charged doc by line_no
       account = own.account ?? charged.account ?? charged.budget.account
  → one balanced entry
```

## Open Questions

- Should the recode be offered on a document whose type is not `requires_budget` (a pure DISB whose
  lines carry a stamp but no budget)? The gates as written allow it — the line has a stamp, the
  ledger reads it — and nothing in the posting distinguishes. Left allowed; revisit if a step is
  ever configured on a type that should not expose it.
- HAL's `ຫົວໜ້າບັນຊີ` role holds `PAYMENT_MANAGE`-class codes today and no `GL_*`; whether
  `DOC_LINE_RECODE` goes to the head, the staff, or both is HAL's call at grant time.
