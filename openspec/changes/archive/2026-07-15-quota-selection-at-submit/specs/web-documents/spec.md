## ADDED Requirements

### Requirement: Create Wizard Quota Reservation Step

When the selected document type has `requires_quota = true`, the Create Document wizard SHALL
present a quota-reservation step (shown only for such types, driven by configuration) that lets the
requester build one or more reservations before Review. Each reservation SHALL capture a `quotaId`
and a quantity, matching the server's `QuotaReservationInput`; the step SHALL NOT collect a
beneficiary employee — the server resolves a personal quota's beneficiary to the requester
themselves. The quota choices SHALL be read from the requester-facing selectable quota read
(`GET /quotas/selectable`, authorized by `DOC_CREATE`), so a requester without `QUOTA_VIEW` can
still build reservations. Each reservation's advisory remaining balance SHALL be shown as read-only
guidance, and a personal quota MAY indicate that the reservation applies to the requester; the
client SHALL treat the server as authoritative and never perform quota writes itself. Quantities
SHALL be entered and carried as strings formatted by the quota's unit and SHALL NOT be coerced to a
JavaScript number. The step SHALL support adding and removing reservations, each remove control
carrying an accessible label. The step SHALL NOT be completable until at least one reservation has a
positive quantity.

#### Scenario: Quota step appears only for quota-controlled types
- **WHEN** the user selects a document type with `requires_quota = true`
- **THEN** the wizard shows a quota-reservation step before Review
- **AND WHEN** the selected type has `requires_quota = false`
- **THEN** no quota step is shown

#### Scenario: Building a reservation from the selectable quotas
- **WHEN** the requester is on the quota step of a `requires_quota` document
- **THEN** the quota picker is populated from the requester-facing selectable quota read and the
  requester can add a reservation with a `quotaId` and a positive quantity, without choosing an
  employee

#### Scenario: Advisory remaining is shown without blocking
- **WHEN** a reservation selects a quota whose remaining balance is available
- **THEN** the step shows the advisory remaining for guidance and still lets the user submit, with
  the server remaining authoritative

#### Scenario: Quota step cannot be completed without a valid reservation
- **WHEN** a `requires_quota` document has no reservation with a positive quantity
- **THEN** the quota step is marked as failing with the reason surfaced inline and the wizard does
  not advance to Review

## MODIFIED Requirements

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user cancel an
own document, reflecting the resulting status. When the document type has `requires_quota = true`,
the submit call SHALL include the `quotaReservations` the requester built (each with a `quotaId` and
`qty`) in the `POST /documents/:id/submit` body; for other types the body carries no reservations.
A quota-controlled draft SHALL be submitted through the wizard, which owns the reservation state;
the document-detail Submit affordance for a `requires_quota` draft SHALL route into the wizard's
quota/review step rather than submit an empty body. Server-side submit errors (over-budget,
over-quota, no quota reservation declared, no linked employee for a personal quota, missing field,
closed period, vendor/item not enabled) SHALL be surfaced to the user.

#### Scenario: Successful submit advances status

- **WHEN** a valid draft is submitted
- **THEN** the document moves out of DRAFT and the detail reflects the new status

#### Scenario: Quota-controlled submit includes reservations

- **WHEN** a valid `requires_quota` draft is submitted from the wizard
- **THEN** the submit request carries the `quotaReservations` array and the document moves out of
  DRAFT

#### Scenario: Server submit error is shown

- **WHEN** submit is rejected by the server (e.g. over budget, over quota, or no quota reservation
  declared)
- **THEN** the error message is shown and the document stays DRAFT

### Requirement: Create Wizard Review Summary

The Create Document wizard's final (Review) step SHALL present a complete, read-only summary of
exactly what will be submitted, derived from the same form state the editing steps bind so it
cannot drift from the submitted document. The summary SHALL show the document type; the document
currency and, when the currency differs from the company base currency, the advisory converted
base amount and a note that the rate is locked at submit; the selected vendor when the document
type requires a vendor; every dynamic field that is currently visible under its `condition_json`
with its label and value (and SHALL omit hidden conditional fields); the full list of line
items with each line's amount and a grand total; and, when the document type has
`requires_quota = true`, the list of quota reservations that will be submitted, each showing the
quota and the quantity. All monetary amounts SHALL be formatted using
the relevant currency's `decimal_places` and SHALL be carried as strings, never coerced to a
JavaScript number.

#### Scenario: Review summarizes a money document before submit
- **WHEN** a user reaches the Review step for a document type that carries amounts (e.g. a
  procurement type) with a vendor, visible fields, and several lines entered
- **THEN** the Review step shows the type, the currency, the vendor, each visible field's
  label and value, every line with its amount, and a grand total formatted by the currency's
  `decimal_places`

#### Scenario: Review lists the quota reservations before submit
- **WHEN** a user reaches the Review step for a `requires_quota` document with one or more
  reservations entered
- **THEN** the Review step lists each reservation's quota and quantity, matching what will be sent
  in `quotaReservations`

#### Scenario: Review hides conditional fields that are not visible
- **WHEN** a dynamic field is hidden by its `condition_json` at the time of review
- **THEN** that field does not appear in the Review summary

#### Scenario: Review shows the foreign-currency base preview
- **WHEN** the chosen document currency differs from the company base currency and an advisory
  rate is available
- **THEN** the Review step shows the converted base amount and indicates the rate is locked at
  submit; **AND WHEN** no advisory rate is available the preview is omitted without blocking
  submit
