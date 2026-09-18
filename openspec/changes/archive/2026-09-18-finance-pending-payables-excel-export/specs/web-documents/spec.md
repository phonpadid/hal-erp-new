## ADDED Requirements

### Requirement: The List Exports Finance's Payables Sheet With The Current Filters

The documents list filter bar SHALL offer an **Export to Excel** action, shown to any `DOC_VIEW`
user, that downloads the payables workbook from `GET /documents/export/payables.xlsx` with the
filter bar's current values sent as the same query parameters the list uses. The action SHALL
carry no page parameters, since the workbook is the whole filtered set. When the filter bar has no
status selected the request SHALL send none, so the server's pending default applies; the button's
tooltip SHALL say so. While the download is in flight the button SHALL be disabled and show a
loading state; a failed download SHALL be reported through the toast layer, not swallowed. The
downloaded file SHALL be named `payables-<company code>-<yyyy-mm-dd>.xlsx`. Label and tooltip
SHALL be rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Export sends the current filters

- **GIVEN** the filter bar has `status=IN_APPROVAL` and a department selected
- **WHEN** the user clicks Export to Excel
- **THEN** the app requests the export with those two query parameters and no `page` / `limit`,
  and saves the response as an `.xlsx` file

#### Scenario: No status means the pending default

- **GIVEN** the filter bar has no status selected
- **WHEN** the user clicks Export to Excel
- **THEN** the request carries no `status` parameter

#### Scenario: A failed export is reported

- **WHEN** the export request fails
- **THEN** a toast explains the failure and the button returns to its enabled state
