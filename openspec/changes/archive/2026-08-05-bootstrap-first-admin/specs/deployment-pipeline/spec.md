## MODIFIED Requirements

### Requirement: A deploy reconciles the permission catalog before restarting

The deploy SHALL reconcile the permission catalog after applying migrations and before restarting the application, and SHALL then verify it. A deploy whose catalog verification fails SHALL stop without restarting, leaving the previous process serving, because an application whose authorization codes are absent is worse than one running slightly older code. The step that reconciles SHALL be the catalog-only command, never the demo seeder, which also creates sample companies, roles, and loginable accounts.

No step of the deploy SHALL create a login account, by any command. This covers the demo seeder and the production bootstrap alike: the bootstrap creates an account holding the entire permission catalog, and a pipeline that runs on every push to the default branch is not a place where such an account should be able to come into existence unobserved. Bootstrapping is performed by a person, on the host, once.

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

#### Scenario: The deploy cannot bootstrap an administrator

- **WHEN** the deploy runs against an environment holding no `app_user` row
- **THEN** it does not invoke the bootstrap command, and the environment remains without an account until a person runs it
