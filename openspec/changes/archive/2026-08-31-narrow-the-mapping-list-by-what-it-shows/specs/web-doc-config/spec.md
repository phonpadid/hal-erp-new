## MODIFIED Requirements

### Requirement: Department Document Mapping

The web app SHALL let a `DOC_CONFIG_MANAGE` user map a department to a (document type → form
template + workflow), list the active company's mappings, and **edit an existing mapping** to
change its workflow, form template, and active state. A mapping makes that document type
creatable in that department. Edit input SHALL be validated client-side against a shared schema
mirroring the update DTO. When the server rejects a duplicate `(department, document type)` with
a conflict, the UI SHALL surface a clear message rather than a generic error. Edit affordances
SHALL require `DOC_CONFIG_MANAGE` and SHALL NOT alter company scope or the permission guard.

The list SHALL be narrowable by department, by document type and by active state, applied
server-side and composing with each other and with the search term. Each SHALL reset the list to its
first page.

The screen shows a department column, a document type column and an active column and offered no way
to narrow by any of them, so the question it exists to answer — which document types may this
department raise — could only be approached by guessing a word the department's name shares or by
reading every page. The columns a reader is shown are the dimensions they will try to narrow by.

The department options SHALL come from the departments that hold a mapping, not from the
organisation directory: that directory requires `DEPARTMENT_VIEW`, which a `DOC_CONFIG_MANAGE`
holder need not have, and a filter must never offer an option that yields nothing.

The active filter SHALL distinguish three states — unset, active, inactive — and SHALL NOT default
to active. "Show me the deactivated ones" is the question worth asking, and a control that hides
them by default cannot answer why a department lost a document type.

With a narrowing applied the screen SHALL state how many mappings it is showing out of how many
exist, so a narrowed list is not mistaken for the whole configuration. A filter can be left set and
forgotten in a way a search box cannot.

#### Scenario: Map a department to a document type

- **WHEN** the user maps a department to a document type with a template and workflow
- **THEN** the mapping appears in the list for the active company

#### Scenario: Edit a mapping's workflow

- **GIVEN** an existing mapping in the list
- **WHEN** the user opens its edit affordance, selects a different workflow, and saves
- **THEN** the mapping row reflects the new workflow

#### Scenario: Duplicate mapping surfaces a clear message

- **WHEN** the user tries to create a mapping for a department + document type that is already mapped
- **THEN** the UI shows a conflict message identifying the duplicate rather than a generic failure

#### Scenario: Narrow the list to one department

- WHEN a `DOC_CONFIG_MANAGE` user filters the mapping list by a department
- THEN only that department's mappings are shown, and the list returns to its first page

#### Scenario: Filters compose with each other and with search

- WHEN the user filters by a department and a document type and also types a search term
- THEN the list shows only the mappings matching all three

#### Scenario: The department options offer only departments that have a mapping

- WHEN the user opens the department filter
- THEN it offers the departments holding at least one mapping, and offers no option that would
  yield an empty list

#### Scenario: Deactivated mappings are not hidden by default

- GIVEN a company with a deactivated mapping
- WHEN a `DOC_CONFIG_MANAGE` user opens the mapping list without choosing an active filter
- THEN the deactivated mapping is shown alongside the active ones

#### Scenario: A narrowed list says what it is hiding

- WHEN any filter is applied
- THEN the screen states how many mappings are shown out of how many exist in the company
