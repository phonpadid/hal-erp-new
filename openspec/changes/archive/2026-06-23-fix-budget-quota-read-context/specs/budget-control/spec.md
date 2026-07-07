## ADDED Requirements

### Requirement: Context-Safe Budget Reads

Budget read operations (list, get, derived-balance breakdown, append-only ledger) SHALL execute
within a valid EntityManager context — forking their own unit of work when not invoked inside a
caller's transaction — so they never fail with a global-EntityManager context error. Reads
invoked inside a transaction (e.g. reserve/settle) SHALL continue to use the caller's
EntityManager, preserving atomicity.

#### Scenario: Breakdown read succeeds over HTTP

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown via the read endpoint
- **THEN** the derived components are returned (not a 500 internal error)

#### Scenario: Reserve still runs in one transaction

- **WHEN** budget balance is computed inside a reservation's transaction
- **THEN** it uses that transaction's EntityManager, not a separate fork
