## MODIFIED Requirements

### Requirement: Reference-Chain Pairing Configuration
The system SHALL store allowed predecessor→successor document-type pairings as
`document_type_ref` rows, each scoped to a single company via `company_id`. Both
`predecessor_type_id` and `successor_type_id` SHALL reference `document_type` rows
belonging to the same company as the pairing; the system SHALL reject any attempt to
create a pairing whose two types are not both in that company. The combination
(`company_id`, `predecessor_type_id`, `successor_type_id`) SHALL be unique. Each pairing SHALL
carry an `auto_create` flag (default `false`) indicating whether the `CREATE_SUCCESSOR` post-action
auto-creates that successor on full approval of the predecessor; `DOC_CONFIG_MANAGE` users MAY set
it per pairing. Reference-chain lookups (create-from validation and `CREATE_SUCCESSOR` successor
resolution) SHALL read these rows scoped to the active company and MUST NOT rely on any hardcoded
pairing table. The `CREATE_SUCCESSOR` post-action SHALL auto-create a DRAFT successor for **each**
successor pairing of the source type whose `auto_create` is `true` (zero, one, or many), and SHALL
do nothing when none are marked `auto_create`.

#### Scenario: Pairing requires same-company types
- GIVEN a predecessor type in company A and a successor type in company B
- WHEN an admin attempts to create a `document_type_ref` pairing between them
- THEN the request is rejected and no pairing row is written

#### Scenario: Duplicate pairing is rejected
- GIVEN a `document_type_ref` pairing PR→PO already exists in a company
- WHEN an admin attempts to create the same PR→PO pairing again in that company
- THEN the request is rejected as a duplicate

#### Scenario: CREATE_SUCCESSOR auto-creates each auto_create pairing
- GIVEN an approved document whose type has two successor pairings both marked `auto_create=true`
- WHEN the `CREATE_SUCCESSOR` post-action runs
- THEN a DRAFT successor is created for each of the two successor types, each referencing the source

#### Scenario: Only auto_create pairings are created
- GIVEN an approved document whose type has one successor pairing marked `auto_create=true` and another marked `auto_create=false`
- WHEN the `CREATE_SUCCESSOR` post-action runs
- THEN a DRAFT is created for the `auto_create=true` successor only, and the `auto_create=false` pairing remains available for manual create-from

#### Scenario: CREATE_SUCCESSOR is a no-op when no pairing is auto_create
- GIVEN an approved document whose type has no successor pairing marked `auto_create=true`
- WHEN the `CREATE_SUCCESSOR` post-action runs
- THEN it does nothing (logged) and the approval still completes
