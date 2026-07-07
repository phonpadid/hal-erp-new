## ADDED Requirements

### Requirement: Context-Safe Quota Reads

Quota read operations SHALL execute within a valid EntityManager context — forking their own unit
of work when not invoked inside a caller's transaction — so the derived-balance breakdown, usage
ledger, and remaining/net-usage helpers never fail with a global-EntityManager context error.
Reads invoked inside a transaction (e.g. usage reserve/settle) SHALL continue to use the caller's
EntityManager.

#### Scenario: Quota breakdown read succeeds over HTTP

- **WHEN** a `QUOTA_VIEW` user requests a quota's breakdown via the read endpoint
- **THEN** the pool and per-employee figures are returned (not a 500 internal error)
