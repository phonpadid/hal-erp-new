## ADDED Requirements

### Requirement: A passing web test run exits clean

The web test run SHALL exit zero whenever every test passes, so that the exit status is a usable
gate. An error raised outside an assertion — an unhandled rejection, a render error after a test
has completed — SHALL be treated as a failure of the suite, not as noise, and SHALL be repaired
rather than tolerated.

#### Scenario: Every test passes

- **WHEN** the web test script is run and no test fails
- **THEN** the run reports no errors and the process exits zero

### Requirement: A module mock covers the surface the component calls

A spec that replaces an API module SHALL provide every member the component under test calls, and
SHOULD build the replacement from the real module so that a member added later resolves to its
real implementation instead of `undefined`. A spec SHALL unmount what it mounts rather than
clearing the document while a mounted component is still live.

#### Scenario: The view calls an API member the spec did not name

- **GIVEN** a view whose `onMounted` calls an optional member of an API module
- **WHEN** a spec mounts that view behind a replaced module
- **THEN** the call resolves instead of throwing, and no unhandled rejection escapes the test

#### Scenario: A spec mounts a component that teleports a dialog

- **WHEN** a spec mounts such a component and the next test begins
- **THEN** the previous wrapper has been unmounted, taking its teleported nodes with it, and no
  component patches into a tree whose parent has been removed
