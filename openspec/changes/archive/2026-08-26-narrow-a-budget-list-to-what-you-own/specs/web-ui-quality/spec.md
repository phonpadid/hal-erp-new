## ADDED Requirements

### Requirement: A Column A Reader Narrows By Is Offered As A Control

A list screen SHALL offer a control that narrows by any column whose values group its rows — a department, an owner, a status — where the list is long enough to page.

A search box does not answer this. Search finds *a* row whose text a reader partly remembers; a
filter shows *the set* a reader is responsible for. Free text cannot express "mine", and typing a
department's name into a search box matches rows whose own name contains it, not rows belonging to
it. Offering only search is what makes readers ask it to do a job it cannot, and conclude the screen
is broken when it will not.

Where the list is drawn from a server page, the control SHALL narrow the whole set, not the page
loaded — server-side, as a search term is. Where the client already holds every row, filtering on
the client IS filtering the whole set and satisfies this.

A screen SHALL state what an active filter is hiding: how many rows are shown against how many
exist. A filter, unlike a search term, can be set and then scrolled past — and a narrowed list that
does not say it is narrowed is indistinguishable from a complete one.

#### Scenario: A grouping column can be narrowed by

- **GIVEN** a paged list showing a column whose values group its rows
- **WHEN** a reader wants only the rows of one such value
- **THEN** the screen offers a control for it, and using it narrows the whole list

#### Scenario: Filters compose with search

- **GIVEN** a list with both a filter and a search box
- **WHEN** a reader sets the filter and types a term
- **THEN** the rows shown satisfy both, and the count reflects both

#### Scenario: A narrowed list says it is narrowed

- **GIVEN** a list with a filter active
- **WHEN** the reader looks at it
- **THEN** it states how many rows are shown out of how many exist

#### Scenario: An empty result is distinguishable from an empty list

- **GIVEN** a filter and a term that together match nothing
- **WHEN** the list renders
- **THEN** the reader can tell that the filters excluded everything, rather than that no rows exist
