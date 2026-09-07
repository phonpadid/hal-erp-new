## ADDED Requirements

### Requirement: The Mapping List Can Be Narrowed By What It Shows

The read that lists a company's `dept_doc_type` mappings SHALL accept optional narrowing by
`department`, by `document_type`, and by `is_active`. Each SHALL be optional, SHALL have no default,
and SHALL compose with the existing search term and with one another.

Every narrowing SHALL be applied to the already company-scoped predicate and SHALL NOT replace it
(invariant 1). A department or document type belonging to another company SHALL therefore match
nothing, rather than reaching a mapping the active company cannot see — the same property that makes
the shared search helper safe to repeat across every list endpoint.

`is_active` SHALL NOT default to true. A list that silently hides deactivated mappings cannot answer
why a department lost a document type, which is one of the two questions this list exists for.

The list is paged, so narrowing belongs on the server: filtering the page a client happens to hold
would narrow a fraction of the set while presenting itself as having narrowed all of it.

#### Scenario: Narrow to one department
- GIVEN a company whose departments each map several document types
- WHEN the mapping list is read for one department
- THEN only that department's mappings are returned

#### Scenario: Narrow to one document type
- WHEN the mapping list is read for one document type
- THEN only the mappings of that type are returned, across every department that has one

#### Scenario: Narrowings compose with each other and with search
- WHEN the mapping list is read for a department and a document type together
- THEN only the mappings matching both are returned
- AND a search term applied at the same time narrows that result further

#### Scenario: A narrowing cannot cross a company
- GIVEN a department belonging to company B
- WHEN the mapping list is read in company A narrowed to that department
- THEN no mapping is returned, and no mapping of company B is reachable

#### Scenario: Deactivated mappings are returned unless excluded
- GIVEN a company with both active and deactivated mappings
- WHEN the mapping list is read with no active narrowing
- THEN both are returned
- AND reading it narrowed to inactive returns only the deactivated ones

#### Scenario: The total reported is the total that matches
- WHEN the mapping list is read with any narrowing applied
- THEN the reported total counts the mappings matching that narrowing, not every mapping in the
  company
