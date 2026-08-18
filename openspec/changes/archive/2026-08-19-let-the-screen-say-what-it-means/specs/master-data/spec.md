# master-data

## ADDED Requirements

### Requirement: The Enabled Item Read Carries The Stock-Tracked Flag

The read that lists the items enabled for the active company SHALL include each item's
`is_stock_tracked` value.

A client cannot offer only stock-tracked items — which `web-inventory` requires of the line editor —
unless it can tell which items those are. The flag exists on the group `item` record but has not been
part of this payload, so the line editor offered every enabled item and the user learned the
difference only when the server refused the document at submit.

This is an additive field on an existing response. The permission governing the read SHALL be
unchanged, and no existing field SHALL change meaning.

#### Scenario: The flag reaches the client

- **WHEN** a client lists the items enabled for the active company
- **THEN** each entry reports whether the item is stock-tracked

#### Scenario: The read is otherwise unchanged

- **WHEN** a client lists the items enabled for the active company
- **THEN** the same items are returned as before, with the same permission required
