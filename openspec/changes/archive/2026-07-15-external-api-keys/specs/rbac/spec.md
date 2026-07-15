## ADDED Requirements

### Requirement: API Key Management Permission

The RBAC permission master SHALL include a permission code `API_KEY_MANAGE` that authorizes
issuing, listing, and revoking API keys within the active company. Authorization for API-key
management endpoints SHALL check this code, never a role name, consistent with permission-code
authorization. Issuing a key SHALL NOT grant the bound user any authority beyond the grants
already resolved for that user in that company.

#### Scenario: Management endpoints authorize on the code
- **WHEN** a request to an API-key management endpoint is authorized
- **THEN** the check is against the `API_KEY_MANAGE` permission code and not against any role name

#### Scenario: A key cannot exceed the bound user's grants
- **WHEN** a key bound to a user authenticates a request
- **THEN** the authority available to that request is exactly the permission-code grants resolved for the bound user in the bound company, and no more

### Requirement: API Key Is An Alternate Authentication Source

The RBAC authentication model SHALL treat an API key as an alternate source of the same
company-context principal produced by interactive login: the resolved principal SHALL carry the
bound user's id, the bound company, the resolved department, and the permission-code grants for
that company, so that permission-code authorization and data-scope enforcement operate
identically regardless of whether the request was authenticated by a JWT or by an API key.

#### Scenario: Identical authorization surface for both sources
- **WHEN** the same endpoint is called once with a JWT and once with an API key bound to the same user and company
- **THEN** permission-code authorization and data-scope enforcement produce the same allow/deny outcome for both, except where API-key requests are additionally barred from approval actions
