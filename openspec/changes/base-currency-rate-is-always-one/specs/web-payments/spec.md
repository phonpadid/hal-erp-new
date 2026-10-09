## ADDED Requirements

### Requirement: The Rate Field Is Fixed At 1 For A Base-Currency Document

The web SHALL show `1` and disable the actual-rate control when the document's currency is the
company's base currency, wherever it asks for that rate — the slip panel, the ready-to-pay record
dialog and the payment-batch result rows — and SHALL say in one line why it cannot be changed. The
server refuses the figure either way; a field that accepts a number the server will refuse is how
the 14,574,000,000 FX loss was typed in the first place.

The control SHALL stay enabled, and keep its current behaviour, for a document carrying a foreign
currency.

#### Scenario: A LAK document offers no rate to type

- **GIVEN** a document whose currency is the company's base currency
- **WHEN** the ready-to-pay record dialog or the batch result row is opened for it
- **THEN** the rate shows 1, cannot be edited, and the reason is stated beside it

#### Scenario: A USD document still asks for the rate

- **GIVEN** a document in a foreign currency
- **WHEN** the same dialog is opened
- **THEN** the rate control is editable and starts from the document's locked rate
