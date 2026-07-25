## ADDED Requirements

### Requirement: A deploy reconciles the permission catalog before restarting

The deploy SHALL reconcile the permission catalog after applying migrations and before restarting the application, and SHALL then verify it. A deploy whose catalog verification fails SHALL stop without restarting, leaving the previous process serving, because an application whose authorization codes are absent is worse than one running slightly older code. The step that reconciles SHALL be the catalog-only command, never the demo seeder, which also creates sample companies, roles, and loginable accounts.

#### Scenario: A deploy carries new permission codes

- **GIVEN** a commit that declares permission codes the target environment does not have
- **WHEN** the deploy runs
- **THEN** the codes are inserted after the migrations and before the restart, and the deployed endpoints are grantable

#### Scenario: The catalog is still short after reconciling

- **WHEN** the verification step reports a missing code
- **THEN** the deploy stops there and the running process is not restarted

#### Scenario: Sample data is never deployed

- **WHEN** a deploy reconciles the catalog
- **THEN** no company, department, role, user, master-data, or document-configuration record is created as a side effect
