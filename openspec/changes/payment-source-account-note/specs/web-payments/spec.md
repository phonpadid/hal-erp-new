## ADDED Requirements

### Requirement: The Slip Panel Asks Which Account Pays

The transfer-slip panel SHALL collect a choice between the company's main account and its reserve
account, presented as two radio buttons so both options are visible at once — the point is to confirm
which account pays, and a choice hidden inside a dropdown is one that gets left at its default — and
the exchange rate the money actually converted at.

The rate field SHALL start from the rate the document locked at submit, where the caller knows it, so
finance corrects a figure instead of retyping one; where no locked rate is known it SHALL start
empty rather than at an invented value. It SHALL remain editable, because the bank decides the rate,
not the document, and what is submitted SHALL be what is recorded.

It is asked here, and not first on the record-payment screen, because here is where the answer is
known: the person attaching the slip is the person who paid, and they are looking at the transfer as
they do it. The panel appears at the approval step that requires a slip, on the paid document, and in
the record-payment confirmation — the same panel in all three.

The panel SHALL NOT attach a slip until the account is chosen and the rate is a positive number, and
SHALL say why the control is unavailable rather than presenting a disabled button with no reason.
Where an earlier slip on the document already states either, the field SHALL arrive carrying it, so
attaching a second slip confirms rather than re-asks; both SHALL remain editable, because a later
slip may correct an earlier one.

Each slip's stated account and rate SHALL be shown beside the file it belongs to.

#### Scenario: Attaching a slip asks which account and at what rate

- **WHEN** a `PAYMENT_MANAGE` user opens the transfer-slip panel
- **THEN** the main/reserve radio pair and the actual-rate field are shown beside the attach control

#### Scenario: The rate starts at the document's locked rate

- **GIVEN** a document locked at a rate, and no slip stating one
- **WHEN** the panel is opened
- **THEN** the rate field already holds the document's locked rate, and can still be changed

#### Scenario: A slip cannot be attached before both are stated

- **GIVEN** no account has been chosen, or the rate is empty or not a positive number
- **WHEN** the user looks at the attach control
- **THEN** it is unavailable, the reason is stated, and no upload is sent

#### Scenario: The edited rate is what is sent

- **GIVEN** the rate field started at the document's locked rate
- **WHEN** the user changes it and attaches the slip
- **THEN** the slip is stored with the rate they typed

#### Scenario: A second slip confirms rather than re-asks

- **GIVEN** a document whose slip already names the reserve account
- **WHEN** the panel is opened again
- **THEN** the reserve account is already chosen, and can still be changed

#### Scenario: What was stated is shown beside the file

- **GIVEN** a slip attached from the reserve account
- **WHEN** the document's slips are read
- **THEN** the reserve account is shown beside that slip

### Requirement: The Record Form Is The Fallback, Not The Route

A document whose transfer slip states both the account and the rate records itself on completion and
never reaches the record-payment form. The form remains for the documents that do reach it — one paid
in cash, one whose slip predates these fields — and SHALL NOT ask again for anything already stated.

The record-payment form SHALL arrive with the account already chosen and the rate already filled from
the document's transfer slip when one states them, falling back to the document's locked rate for the
rate, and SHALL ask only for what nothing has said yet. It SHALL be shown only when
the method is a transfer and SHALL disappear when the method is cash, and the form SHALL NOT offer to
submit a transfer until an account is chosen.

A recorded payment's account SHALL be shown wherever that payment is read back, so the person
checking it later sees what the person paying stated.

#### Scenario: The slip's answers arrive with the form

- **GIVEN** a document whose transfer slip names the reserve account and a rate
- **WHEN** a `PAYMENT_MANAGE` user opens the record-payment form
- **THEN** the reserve account is already chosen and the rate field holds the slip's rate

#### Scenario: Choosing cash asks nothing about accounts

- **WHEN** the user chooses cash
- **THEN** the main/reserve choice is not shown, and the form can be submitted without it

#### Scenario: An incomplete transfer cannot be submitted

- **GIVEN** the method is transfer and nothing has named an account
- **WHEN** the user looks at the confirm action
- **THEN** it is disabled, and no request is sent

#### Scenario: What was stated is shown when the payment is read

- **GIVEN** a payment recorded from the reserve account
- **WHEN** it is read back
- **THEN** the reserve-account choice is shown

### Requirement: The Actual Rate Starts From The Document's Locked Rate

The record-payment form SHALL pre-fill the actual exchange rate with the rate the document locked at
submit, and SHALL let the user change it before recording. What is submitted SHALL be what is
recorded: pre-filling is a starting point, not a default the server substitutes.

Finance confirms or corrects the rate the money actually converted at; retyping a figure the document
already carries is how a digit gets dropped.

#### Scenario: The rate is offered, not demanded

- **WHEN** a `PAYMENT_MANAGE` user opens the record-payment form for a document locked at a rate
- **THEN** the actual-rate field already holds that rate

#### Scenario: A corrected rate is what gets recorded

- **WHEN** the user changes the pre-filled rate and records the payment
- **THEN** the payment is recorded at the rate they submitted
