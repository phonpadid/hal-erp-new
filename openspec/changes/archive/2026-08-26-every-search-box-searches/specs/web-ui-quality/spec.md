## ADDED Requirements

### Requirement: A List Control That Appears To Filter Filters The Whole List

A control a list screen offers for narrowing that list SHALL narrow the set the list is drawn from,
not the page that happens to be loaded, and SHALL NOT be rendered at all where nothing is wired to
it.

A list rendered from a server page holds a fraction of its data. A control bound to a client-side
filter over that fraction reports "no results" for a term that matches a hundred rows on the next
page, and a reader has no way to tell that from a term that matches nothing. Where the whole set IS
on the client — a table whose total is the length of its own array — client-side filtering is the
correct implementation and the requirement is satisfied by it.

A control rendered but wired to nothing is the worse case, because it costs the reader the attempt
before it costs them the answer. Fourteen list screens shipped one: each bound PrimeVue's
client-side `filters` to a table in `lazy` mode, where the binding is ignored outright. A shared
table component SHALL fail loudly, in development, when given filter bindings it will not apply,
so the next screen to make this mistake finds out at the component boundary rather than in a
browser.

#### Scenario: A term reaches rows beyond the loaded page

- **GIVEN** a server-paged list whose matching row is not on the page currently shown
- **WHEN** the reader searches for it
- **THEN** it is listed

#### Scenario: A term matching nothing says so

- **WHEN** the reader searches a server-paged list for a term no row matches
- **THEN** the list shows an empty result for that search, distinguishable from the unfiltered list

#### Scenario: A fully-loaded list may filter on the client

- **GIVEN** a list whose every row is already loaded
- **WHEN** the reader searches it
- **THEN** every matching row is shown, whether the filtering happened on the client or the server

#### Scenario: A view that shows the same data two ways offers the box only where it works

- **GIVEN** a screen whose grouping control switches between a server-paged table and a fully-loaded
  tree fed by its own request
- **WHEN** the reader switches to the view the term does not narrow
- **THEN** the search field is not rendered for that view

#### Scenario: An unwired filter binding is refused at the boundary

- **GIVEN** a shared table component running in a mode where client-side filter bindings are ignored
- **WHEN** a caller passes such bindings
- **THEN** development builds report it, naming the component and what to do instead
