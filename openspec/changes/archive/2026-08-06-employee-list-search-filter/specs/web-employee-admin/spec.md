## ADDED Requirements

### Requirement: Employee List Search and Filter Bar

The employee-admin screen SHALL provide a search field and a filter bar that narrow the
employee list by querying the server, so that they search the whole company registry rather
than only the rows of the page currently displayed. The screen SHALL NOT rely on client-side
table filtering, which cannot see beyond the loaded page.

Typing in the search field SHALL be debounced so that a burst of keystrokes issues one
request. The filter bar SHALL offer department, status, job level, and has-an-account, each
presented as a Select whose options come from data the screen already holds — the active
company's departments, the `EMPLOYEE_STATUSES` values, and the active company's active
`job_level` rows. A clear action SHALL reset the search term and every filter and reload the
unfiltered list.

Changing the search term or any filter SHALL reload the list from the first page, because the
result set changes size. Paging SHALL preserve the active search term and filters. Any action
that reloads the list after a mutation — edit, link, create-account, verify, unlink, or resign
— SHALL likewise preserve them, so the user is not returned to an unfiltered list after acting
on a row. The paginator SHALL reflect the filtered total.

When a search or filter matches nothing, the screen SHALL show its empty state rather than an
error. Filter controls SHALL be styled with theme tokens so they render correctly in both
light and dark mode.

#### Scenario: Searching narrows the list beyond the current page

- **GIVEN** an employee-admin list whose registry spans several pages
- **WHEN** an `EMPLOYEE_MANAGE` user types part of the name of an employee who is not on the
  displayed page
- **THEN** that employee appears in the list

#### Scenario: Typing issues one request

- **WHEN** the user types several characters in quick succession into the search field
- **THEN** the app issues a single list request after the user pauses, not one per keystroke

#### Scenario: Filter by department from the toolbar

- **WHEN** an `EMPLOYEE_MANAGE` user selects a department in the filter bar
- **THEN** the list reloads showing only employees of that department, and the paginator shows
  the filtered total

#### Scenario: Filter by account state

- **WHEN** an `EMPLOYEE_MANAGE` user filters to employees without a login account
- **THEN** only employees showing "no account" remain in the list

#### Scenario: Changing a filter returns to the first page

- **GIVEN** the user has paged to the third page of the list
- **WHEN** they change the status filter
- **THEN** the list reloads from the first page of the newly filtered set

#### Scenario: Paging preserves the active search

- **GIVEN** an active search term whose matches span more than one page
- **WHEN** the user moves to the next page
- **THEN** the search term is still applied and the next page of matches is shown

#### Scenario: Acting on a row preserves the filters

- **GIVEN** an active department filter
- **WHEN** the user edits an employee and saves, and the list reloads
- **THEN** the department filter is still applied and the search field still holds its term

#### Scenario: Clearing resets search and filters together

- **GIVEN** an active search term and one or more active filters
- **WHEN** the user activates the clear action
- **THEN** every filter and the search term are reset and the full company list is shown from
  the first page

#### Scenario: A search matching nothing shows the empty state

- **WHEN** the user searches for a term no employee in the active company matches
- **THEN** the screen shows its empty state, and no error is displayed

#### Scenario: Filters reset when the active company changes

- **GIVEN** an active search term and filters on the employee-admin screen
- **WHEN** the admin switches the active company
- **THEN** the list reloads for the new company, and no filter referencing the previous
  company's departments or job levels remains applied
