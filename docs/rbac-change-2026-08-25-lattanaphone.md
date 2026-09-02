# RBAC change on `real_server` — LATTANAPHONE, 2026-08-25

Recorded so it can be undone. This database is destined for a production restore.

## Who

`LATTANAPHONE` · ນາງ ລັດຕະນາພອນ ສຸກສາຄອນ · employee `H-00083` · department `BG` ພະແນກງົບປະມານ
user id `343b6055-e834-4b7f-85cd-8a8962894d98`

## State BEFORE the change

One assignment, and no other role existed that fitted the job:

| role | department | default |
|---|---|---|
| `STAFF` ພະນັກງານ | ພະແນກງົບປະມານ | yes |

`STAFF` grants 8 codes, all at DEPARTMENT scope:
`DOC_APPROVE DOC_CANCEL DOC_CREATE DOC_RECEIVE DOC_SUBMIT DOC_VIEW MASTER_VIEW NOTIFICATION_VIEW`

The whole company had exactly two roles: `ADMIN` (63 codes) and `STAFF` (8).

## What was changed

1. Created role `BUDGET_OFFICER` · ພະນັກງານງົບປະມານ (id `fa87af28-9e4c-4f15-9b72-a820b71bb8f0`)
2. Granted it 12 permissions:

   | scope | codes | why |
   |---|---|---|
   | COMPANY | `BUDGET_VIEW` `BUDGET_MANAGE` `REPORT_VIEW` `COA_VIEW` | the budget office oversees all 20 departments; DEPARTMENT scope would show only its own |
   | DEPARTMENT | the 8 `STAFF` codes | unchanged from what she already had |

3. Assigned `BUDGET_OFFICER @ ພະແນກງົບປະມານ` to her. **`STAFF` was left in place** and is still her default — nothing was revoked.

## Rollback

```sql
-- 1. take the new assignment off her
DELETE FROM user_company_role
 WHERE user_id = '343b6055-e834-4b7f-85cd-8a8962894d98'
   AND role_id = 'fa87af28-9e4c-4f15-9b72-a820b71bb8f0';

-- 2. drop the role's grants, then the role
DELETE FROM role_permission WHERE role_id = 'fa87af28-9e4c-4f15-9b72-a820b71bb8f0';
DELETE FROM role           WHERE id      = 'fa87af28-9e4c-4f15-9b72-a820b71bb8f0';
```

Nothing else was touched: no document, no budget, no ledger row. Her `STAFF` assignment is exactly
as it was, so step 1 alone restores what she could see and do.
