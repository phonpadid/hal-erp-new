## MODIFIED Requirements

### Requirement: Group Item Registry
The system SHALL keep items in a group-wide `item` table with a default GL account,
enabled per company via `item_company`.

#### Scenario: Default GL is auto-filled onto the line

- GIVEN an item with a default GL account
- WHEN it is added to a document line
- THEN the line's GL account is set from the item's `default_gl_account`
  server-authoritatively and is not editable by the requester
