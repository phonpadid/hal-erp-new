## ADDED Requirements

### Requirement: Master Codes Are Issued By The System

The system SHALL issue `vendor.vendor_code` and `item.item_code` itself when a vendor or item is
created through the API, and SHALL NOT accept a caller-supplied code on create — a request
carrying `vendorCode` or `itemCode` SHALL be rejected with a validation error. Codes SHALL come
from a group-wide `master_sequence` row per `kind` (`VENDOR`, `ITEM`), incremented under a
pessimistic row lock (`SELECT … FOR UPDATE`) inside the same transaction as the insert, and
formatted as `V-` / `I-` followed by the number zero-padded to at least five digits. The
migration that introduces `master_sequence` SHALL seed each `current_no` at the highest number
already used by an existing code of the same pattern, so an issued code never collides with a
legacy one. The code SHALL remain immutable after creation and SHALL be returned on the created
record.

#### Scenario: A vendor is created without a code
- **WHEN** a `MASTER_MANAGE` user creates a vendor with a name and no code
- **THEN** the vendor is created with `vendor_code` `V-00001` (or the next number) and the response carries it

#### Scenario: Sequential codes
- **GIVEN** the last issued item code is `I-00041`
- **WHEN** an item is created
- **THEN** its `item_code` is `I-00042`

#### Scenario: A supplied code is refused
- **WHEN** a create request carries `vendorCode` or `itemCode`
- **THEN** the request is rejected with a validation error and nothing is created

#### Scenario: Concurrent creates never share a code
- **WHEN** two vendor creates run concurrently
- **THEN** both succeed with two different consecutive codes

#### Scenario: The sequence starts above legacy codes
- **GIVEN** an existing item whose `item_code` is `I-00001` and a vendor whose `vendor_code` is `BANKPICK-DEMO`
- **WHEN** the migration seeds `master_sequence`
- **THEN** the next item code issued is `I-00002` and the next vendor code is `V-00001`
