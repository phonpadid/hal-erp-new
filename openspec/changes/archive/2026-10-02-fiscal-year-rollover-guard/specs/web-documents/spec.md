## ADDED Requirements

### Requirement: A Blocked Budget Type Explains Itself at Type Selection

The Create Document wizard SHALL disable a type the creatable-types read marks as blocked for the
fiscal year: it SHALL render that type's card disabled (not selectable by pointer or keyboard, its disabled
state exposed to assistive technology) and SHALL show the translated reason, naming the year and
telling the user to contact whoever manages budgets. Unblocked types SHALL behave as before. If the
server still refuses creation (the block appeared after the list loaded), the wizard SHALL show the
same translated message rather than a generic failure.

#### Scenario: Budget types are disabled in a new unbudgeted year

- **WHEN** a requester opens the wizard on 2027-01-02 with no budgeted 2027 year
- **THEN** every budget-consuming type card is disabled with the Lao message naming 2027, and a
  leave-request card remains selectable

#### Scenario: Race with the server

- **WHEN** a type was selectable when the list loaded but the server refuses creation with the
  year-block error
- **THEN** the wizard shows the same translated year-block message
