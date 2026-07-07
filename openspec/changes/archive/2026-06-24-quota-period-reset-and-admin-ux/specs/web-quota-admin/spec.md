## ADDED Requirements

### Requirement: Quota Definition Management

The web app SHALL let a `QUOTA_VIEW` user list quotas and a `QUOTA_MANAGE` user create and
edit them — quota type, unit, level (company when no department, otherwise a department),
`limit_value`, `reset_cycle` (MONTHLY / QUARTERLY / YEARLY / NONE), carry-forward policy,
and active state — validated client-side against the shared schema mirroring the backend
DTO. Deactivation SHALL set the quota inactive rather than hard-delete it.

#### Scenario: Create a quota

- **WHEN** a `QUOTA_MANAGE` user submits a valid new quota (e.g. ANNUAL_LEAVE, unit "day",
  YEARLY)
- **THEN** it appears in the quota list for the active company

#### Scenario: Edit a quota's reset cycle and carry-forward policy

- **WHEN** the user edits a quota's reset cycle or carry-forward policy
- **THEN** the change is saved and reflected in the list and detail

#### Scenario: Deactivate a quota

- **WHEN** the user deactivates a quota
- **THEN** it is marked inactive and no longer offered for new reservations

### Requirement: Entitlement Management

The web app SHALL let a `QUOTA_MANAGE` user view and maintain per-person
`quota_entitlement` rows for a quota and year — setting `entitled_value` and (read-only
derived) `carried_over`, with the entitled total, used, and remaining shown per employee.

#### Scenario: Set an employee's yearly entitlement

- **WHEN** the user sets an employee's `entitled_value` for a year
- **THEN** the entitlement is saved and the employee's derived remaining updates

#### Scenario: Entitlement list reflects the selected year

- **WHEN** the user switches the selected year
- **THEN** the table shows that year's entitled, used, and remaining per employee

### Requirement: Mid-Year Adjustment

The web app SHALL let a `QUOTA_MANAGE` user apply a signed mid-year adjustment to an
employee's entitlement (a delta to `adjusted`) with a reason, without overwriting
`entitled_value` or `carried_over`.

#### Scenario: Adjust an entitlement up

- **WHEN** the user applies a +2 adjustment to an employee's entitlement
- **THEN** that employee's `adjusted` and derived remaining increase by 2

### Requirement: Carry-Forward and Period Close

The web app SHALL let a `QUOTA_MANAGE` user run carry-forward for a quota from a source
period to the next, seeding the next period's `carried_over` from the source period's
remaining when the quota's carry-forward policy allows it, and SHALL surface the result.

#### Scenario: Run year-end carry-forward

- **WHEN** the user runs carry-forward for a quota from 2025 to 2026
- **THEN** each employee's 2026 `carried_over` reflects their 2025 remaining

#### Scenario: Carry-forward disabled is reflected

- **WHEN** the quota's carry-forward policy is disabled
- **THEN** the action communicates that no balance is carried and `carried_over` stays 0

### Requirement: Permission-Gated Quota Admin Affordances

The web app SHALL show the quota-admin navigation, management screens, and
create/edit/adjust/carry-forward actions only to users holding the relevant permission
code — `QUOTA_VIEW` for reads, `QUOTA_MANAGE` for writes (UX only; the server still
enforces).

#### Scenario: Management actions hidden without QUOTA_MANAGE

- **WHEN** a user holding only `QUOTA_VIEW` opens the quota area
- **THEN** create, edit, adjust, and carry-forward actions are not shown

#### Scenario: Quota admin hidden without QUOTA_VIEW

- **WHEN** a user without `QUOTA_VIEW` is signed in
- **THEN** the quota-admin navigation entry is not shown
