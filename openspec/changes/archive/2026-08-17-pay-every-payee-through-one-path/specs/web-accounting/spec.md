# web-accounting

## MODIFIED Requirements

### Requirement: Open Payables Screen

The web app SHALL provide a screen listing the payables this company has accrued and not paid,
gated by `GL_VIEW`, showing who is owed, the kind of payable, document number, amount, invoice date
and due date, ordered by due date.

The screen SHALL show every kind of payable the server returns, and SHALL make the kind visible on
the row. A trade payable was agreed with a supplier on terms; a claim is owed to a person now. A list
that renders them identically reports a total nobody can compose.

A row whose payee the server did not name SHALL be shown by its document number rather than as an
empty payee, and SHALL NOT be attributed to whoever raised the document.

Amounts SHALL be formatted with the base currency's `decimal_places` and never carried as a JS
number. The screen SHALL NOT mark rows overdue: the due date is a company-day and the client does
not know the company's timezone.

The endpoint returns every row in one response, so the table SHALL page and sort on the client
rather than requesting pages the server does not honour.

#### Scenario: Open payables are listed by due date

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the unpaid accruals are listed with who is owed, amount, invoice date and due date,
  ordered by due date

#### Scenario: A claim and a purchase are told apart

- **GIVEN** one open trade payable and one open claim payable
- **WHEN** the screen renders
- **THEN** each row shows which kind it is

#### Scenario: An unnamed payee is not invented

- **GIVEN** an open claim payable the server returned with no payee
- **WHEN** the row renders
- **THEN** it is identified by its document number and names nobody

#### Scenario: Nothing is marked overdue

- **GIVEN** a payable whose due date has passed in the viewer's timezone
- **WHEN** the screen renders
- **THEN** the row is shown without an overdue marking

### Requirement: The Open Payables Screen Shows The Ageing

The open payables screen SHALL show the ageing buckets and their totals above the list, and each
row's bucket alongside its due date, both taken from the server as returned.

The screen SHALL also show the total owed per kind of payable, as the server reported it, so a
reader can see what the overall figure is composed of without opening a second screen or adding two
numbers themselves.

The screen SHALL NOT compute a bucket, a days-overdue figure, or a per-kind total of its own: it does
not know the company's day, and a total recomputed in the browser is a second opinion about a figure
the server already derived.

#### Scenario: The buckets are shown with their totals

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the five buckets are shown with the amount in each

#### Scenario: The composition is shown beside the total

- **GIVEN** the server reported open payables of both kinds
- **WHEN** the screen renders
- **THEN** the total owed per kind is shown as returned

#### Scenario: A row shows the bucket the server put it in

- **GIVEN** an overdue payable
- **WHEN** the row renders
- **THEN** it shows the bucket the server reported, not one derived in the browser
