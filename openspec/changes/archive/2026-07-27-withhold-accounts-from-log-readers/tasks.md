## 1. Close the hole at the entity

- [x] 1.1 Mark `AppUser.passwordHash` hidden from serialization, and say in a comment which
  endpoint proved it was needed — a bare flag invites someone to remove it as decoration.
- [x] 1.2 Confirm nothing reads the hash through serialization. Verification, reset and seeding all
  read the property off the object, which hiding does not affect; if any caller relies on the
  serialized form, stop and reconsider the approach.

## 2. Write the log's shape down

- [x] 2.1 Map the approval log to an explicit object per entry: step number, action, remark, time,
  approver as id and username, delegator as id and username or absent.
- [x] 2.2 Drop the stamped signature and the nested document from the response. Both were riding
  along unnoticed, which is the same failure as the hash in smaller print.
- [x] 2.3 Leave every other approval endpoint alone. If the diff touches `can-act`, `sla`, or
  `pending-approvers`, re-read the design.

## 3. Prove it

- [x] 3.1 Assert a serialized user has no `passwordHash`. Use ORM metadata without a database so
  the test runs everywhere.
- [x] 3.2 Pin the exact key set of a log entry, and assert the whole payload contains neither the
  hash nor the signature id — checking the approver alone would miss a field added at the top level.
- [x] 3.3 Run both against the unfixed code first and confirm they fail. A test for a leak that
  passes before the fix is testing nothing.
- [x] 3.4 Re-read the endpoint from a running server with an external key and confirm the payload.

## 4. Tell the caller

- [x] 4.1 Quote the response shape in the claim guide and state plainly that an approver is an id
  and a username, so the caller can see the boundary rather than infer it.
