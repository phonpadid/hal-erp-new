## ADDED Requirements

### Requirement: Quota List

The web app SHALL show a `QUOTA_VIEW` user the active company's quotas (type, unit, department,
limit, reset cycle) with the pool remaining, each linking to its detail. The list SHALL NOT show
quotas of other companies.

#### Scenario: Lists the company's quotas with remaining

- **WHEN** a `QUOTA_VIEW` user opens the quotas list
- **THEN** the active company's quotas are shown with their derived pool remaining

### Requirement: Quota Balance Breakdown

The web app SHALL show, for a quota, the derived balance: a pool view (limit, used, remaining)
and — when entitlement-based — a per-employee table (employee, entitled, used, remaining). The
figures SHALL be derived from usage and entitlement records, never a stored usage value.

#### Scenario: Pool breakdown reconciles

- **WHEN** the user opens a limit-based quota's detail
- **THEN** remaining equals limit minus net used

#### Scenario: Per-employee entitlement is shown

- **WHEN** the user opens an entitlement-based quota's detail
- **THEN** each employee's entitled, used, and remaining are shown

### Requirement: Quota Usage Ledger View

The web app SHALL show a quota's usage entries (usage type, quantity, employee, source document,
timestamp), most recent first, as a read-only history. Entries linked to a source document SHALL
link through to it.

#### Scenario: Usage entries are listed

- **WHEN** the user views a quota that has had usage reserved
- **THEN** the USE / RELEASE entries are listed with their quantities

### Requirement: Permission-Gated Quota Affordances

The quota navigation, list, and detail SHALL be shown only to users holding `QUOTA_VIEW` (UX
only; the server still enforces).

#### Scenario: Quota hidden without permission

- **WHEN** a user without `QUOTA_VIEW` is signed in
- **THEN** the Quota navigation entry is not shown
