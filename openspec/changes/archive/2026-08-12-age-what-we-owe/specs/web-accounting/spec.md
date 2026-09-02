# web-accounting

## ADDED Requirements

### Requirement: The Open Payables Screen Shows The Ageing

The open payables screen SHALL show the ageing buckets and their totals above the list, and each
row's bucket alongside its due date, both taken from the server as returned.

The screen SHALL NOT compute a bucket or a days-overdue figure of its own: it does not know the
company's day.

#### Scenario: The buckets are shown with their totals

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the five buckets are shown with the amount in each

#### Scenario: A row shows the bucket the server put it in

- **GIVEN** an overdue payable
- **WHEN** the row renders
- **THEN** it shows the bucket the server reported, not one derived in the browser
