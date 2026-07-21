## ADDED Requirements

### Requirement: Bulk Role-Permission Writes

The system SHALL provide an `RBAC_MANAGE`-gated write surface that applies a batch of
`role_permission` changes for one `role` in a single request. A batch SHALL carry, for that
role, the set of permission codes to grant (each with a data-visibility `scope` of
`OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`) and the set of permission codes to detach.

The whole batch SHALL be applied inside one database transaction: either every item takes
effect or none does. The batch SHALL be validated in full **before** any row is written —
if any item names an unknown `permission.code`, an invalid `scope`, or a `role` outside the
requester's active company, the entire batch SHALL be rejected and no `role_permission` row
SHALL be created, updated, or deleted.

Within a batch, an item that is already satisfied SHALL NOT be an error. Granting a
permission the role already holds **with the same scope** SHALL be reported as skipped;
granting one the role already holds **with a different scope** SHALL update that grant's
`scope` (the `(role_id, permission_id)` pair stays unique — a second row SHALL NOT be
inserted); detaching a permission the role does not hold SHALL be reported as skipped. The
response SHALL report per-item outcomes so the caller can distinguish applied from skipped
work. The existing single-item grant endpoint SHALL keep rejecting a duplicate grant with a
conflict.

#### Scenario: Grant many permissions in one request

- **WHEN** an `RBAC_MANAGE` user submits a batch granting several permission codes to a role
  in the active company
- **THEN** one `role_permission` row exists per code with the submitted `scope`, and the
  response reports each item as applied

#### Scenario: Batch mixes grants and detaches

- **GIVEN** a role that holds permissions A and B
- **WHEN** a batch grants C and D and detaches A
- **THEN** the role holds B, C, and D, and no longer holds A

#### Scenario: Re-granting a held permission with the same scope is skipped, not fatal

- **GIVEN** a role that already holds permission A with scope `DEPARTMENT`
- **WHEN** a batch grants A with scope `DEPARTMENT` alongside a new permission B
- **THEN** B is granted, A is reported as skipped, and the request succeeds

#### Scenario: Re-granting a held permission with a new scope updates it in place

- **GIVEN** a role that already holds permission A with scope `DEPARTMENT`
- **WHEN** a batch grants A with scope `COMPANY`
- **THEN** the existing `role_permission` row's `scope` becomes `COMPANY` and no second row
  for that `(role_id, permission_id)` pair is inserted

#### Scenario: An invalid item rejects the whole batch

- **WHEN** a batch contains one unknown permission code among otherwise valid items
- **THEN** the request is rejected and none of the batch's grants or detaches are applied

#### Scenario: A role outside the active company is rejected

- **WHEN** an `RBAC_MANAGE` user submits a batch naming a `role` belonging to another company
- **THEN** the request is rejected and no `role_permission` row is written

### Requirement: Bulk User Role Assignment Writes

The system SHALL provide an `RBAC_MANAGE`-gated write surface that assigns several roles to
one user in a single request against a shared context: one `department_id`, an optional
default flag, and an optional validity window (`valid_from`/`valid_to`). The system SHALL
create one `user_company_role` row per named role, all carrying that shared context and the
requester's active `company_id`.

The whole batch SHALL be applied inside one database transaction, validated in full before
any row is written. If any named `role` or the `department` does not belong to the active
company, or the window's `valid_to` precedes its `valid_from`, the entire batch SHALL be
rejected and no `user_company_role` row SHALL be created.

Because `user_company_role` is unique on `(user_id, company_id, role_id)`, a role the user
already holds in the active company SHALL be reported as skipped rather than failing the
batch. Because `is_default` marks the company a user enters at login, the batch's default
flag is part of its shared context and SHALL be applied to **at most one** of the
assignments the batch creates; the remaining assignments SHALL be created with
`is_default = false`.

#### Scenario: Assign several roles in one request

- **WHEN** an `RBAC_MANAGE` user submits a batch assigning three roles to a user with one
  department and no window
- **THEN** three `user_company_role` rows exist for that user in the active company, each
  with that `department_id`

#### Scenario: Shared acting window applies to every role in the batch

- **WHEN** a batch assigns two roles with `valid_from` and `valid_to` set
- **THEN** both created assignments carry that same validity window

#### Scenario: An already-held role is skipped, not fatal

- **GIVEN** a user who already holds role A in the active company
- **WHEN** a batch assigns roles A and B
- **THEN** B is assigned, A is reported as skipped, and the request succeeds

#### Scenario: The default flag lands on exactly one assignment

- **WHEN** a batch assigns three roles with its shared default flag set
- **THEN** exactly one of the created assignments has `is_default = true` and the other two
  have `is_default = false`

#### Scenario: A department outside the active company rejects the whole batch

- **WHEN** a batch names a `department` belonging to another company
- **THEN** the request is rejected and no `user_company_role` row is created

#### Scenario: An invalid window rejects the whole batch

- **WHEN** a batch carries a `valid_to` earlier than its `valid_from`
- **THEN** the request is rejected and no `user_company_role` row is created
