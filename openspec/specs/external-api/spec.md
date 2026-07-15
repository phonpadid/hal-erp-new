# External API Specification

## Purpose
API-key credentials for machine-to-machine access: issuance, secret hashing/custody, the
authentication guard, request-time resolution to a company-scoped principal, the operation
cap (read + create/submit, never approve), revocation, expiry, listing, usage visibility,
and audit attribution. External systems authenticate with a long-lived, revocable,
auditable key that resolves to the same principal an interactive login would produce.

## Requirements

### Requirement: API Key Credential Issuance

The system SHALL allow a user holding `API_KEY_MANAGE` in the active company to issue an
API key bound to exactly one target user and that one company. The key's raw secret SHALL be
of the form `<prefix>.<random>`, where `random` carries at least 32 bytes of CSPRNG entropy.
The system SHALL persist only a hash of the raw secret and SHALL return the raw secret exactly
once, in the creation response; it SHALL never expose the raw secret again.

#### Scenario: Admin issues a key and receives the raw secret once
- **WHEN** a user with `API_KEY_MANAGE` issues a key for a target user who is a member of the active company
- **THEN** the system stores an `api_key` row with `company_id` = the active company, `user_id` = the target user, a unique `prefix`, and `secret_hash` = the hash of the raw secret
- **AND** the response contains the raw secret exactly once and no later read returns it

#### Scenario: Only the hash is persisted
- **WHEN** a key is issued
- **THEN** the stored row contains `secret_hash` and never the raw secret

#### Scenario: Issuance requires the management permission
- **WHEN** a user without `API_KEY_MANAGE` attempts to issue a key
- **THEN** the request is rejected with 403 and no key is created

#### Scenario: Target user must belong to the active company
- **WHEN** an admin attempts to issue a key for a user who is not a member of the admin's active company
- **THEN** the request is rejected and no key is created

### Requirement: API Key Authentication Resolves To The Bound Principal

The system SHALL accept an API key credential presented on a request and resolve it to the
same authenticated principal (`AuthUser`) that the bound user would obtain by logging in and
selecting the bound company. Grants and data scopes SHALL be resolved live at request time
from the bound user and company, so a key never carries more authority than the bound user
currently holds. A request presenting a key SHALL be marked with an API-key authentication
source and the key's id for downstream use.

#### Scenario: Valid key authenticates as the bound user
- **WHEN** a request presents a valid, non-revoked, non-expired API key secret
- **THEN** the system attaches an `AuthUser` with the bound user's id, the bound company id, the resolved department, and the permission-code grants resolved for that user in that company
- **AND** the request is marked with authentication source `api-key` and the key id

#### Scenario: Grants track the bound user live
- **WHEN** the bound user's permissions in the company have changed since the key was issued
- **THEN** the request is authorized using the user's current resolved grants, not a snapshot from issue time

#### Scenario: Invalid secret is rejected
- **WHEN** a request presents a secret whose hash does not match the stored `secret_hash` for the prefix
- **THEN** the request is rejected with 401 and no principal is attached

#### Scenario: Company isolation is preserved
- **WHEN** a key bound to company A authenticates a request
- **THEN** the resolved principal is scoped to company A only and cannot read or write data of any other company

### Requirement: API Keys Cannot Approve

A request authenticated by an API key SHALL be permitted to read and to create or submit
documents subject to the bound user's permission codes, but SHALL NOT be permitted to approve,
reject, or delegate approval of any document, even if the bound user holds the corresponding
approval permission codes. The prohibition SHALL be enforced on the authentication channel and
SHALL NOT be expressible as a grant.

#### Scenario: Key may create and submit a document
- **WHEN** an API-key request calls a document create or submit endpoint and the bound user holds the required create/submit permission code
- **THEN** the request is authorized and the document is created or submitted

#### Scenario: Key is denied approval even with the approval grant
- **WHEN** an API-key request calls an approve, reject, or delegate endpoint and the bound user holds the corresponding approval permission code
- **THEN** the request is rejected with 403 and no approval, rejection, or delegation is recorded

#### Scenario: No-self-approval remains intact
- **WHEN** a document is created via an API key bound to user U
- **THEN** the document's creator is user U and no channel exists by which that same key could approve it

### Requirement: API Key Revocation And Expiry

The system SHALL allow a user holding `API_KEY_MANAGE` to revoke a key in the active company,
taking effect immediately. The system SHALL reject authentication for any key that has been
revoked or whose expiry has passed. Revocation SHALL be a state change on the existing key row,
not a deletion, so the audit history is preserved.

#### Scenario: Revoked key stops authenticating
- **WHEN** a key is revoked and a subsequent request presents its secret
- **THEN** the request is rejected with 401

#### Scenario: Expired key stops authenticating
- **WHEN** a key with an `expires_at` in the past presents its secret
- **THEN** the request is rejected with 401

#### Scenario: Revocation is scoped to the active company
- **WHEN** an admin attempts to revoke a key belonging to a different company
- **THEN** the request is rejected and the key remains active

### Requirement: API Key Listing And Usage Visibility

The system SHALL let a user holding `API_KEY_MANAGE` list the keys of the active company,
showing for each key its name, public prefix, bound user, status (active/revoked/expired),
`expires_at`, and `last_used_at`. Listings SHALL never include the raw secret or the secret
hash. The system SHALL update `last_used_at` on successful authentication on a best-effort
basis without failing or delaying the authenticated request.

#### Scenario: Listing shows non-secret metadata only
- **WHEN** an admin lists the active company's API keys
- **THEN** each entry shows name, prefix, bound user, status, expiry, and last-used time, and never the raw secret or its hash

#### Scenario: Last-used is updated on authentication
- **WHEN** a request successfully authenticates with a key
- **THEN** the key's `last_used_at` is updated on a best-effort basis and a failure to update does not fail the request

### Requirement: API Key Action Attribution

The system SHALL attribute actions performed via an API key to the bound user in the existing
audit trail (for example document `created_by` and `approval_log` actor), while additionally
recording that the action originated from an API key and which key it was, so key-originated
activity is distinguishable without breaking append-only audit semantics.

#### Scenario: Key-created document is attributed to the bound user
- **WHEN** a document is created via an API key bound to user U
- **THEN** the document's `created_by` is user U and the audit record identifies the originating API key
