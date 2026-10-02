## ADDED Requirements

### Requirement: The Rate Is Its Own Field, With Its Own Save

The transfer-slip panel SHALL let the rate be corrected and saved on its own, without attaching a
file, and SHALL show whether the figure on screen has been saved.

A field whose value only travels with a file upload is a field that accepts a correction and throws
it away — which is what happened to a rate finance had already typed, with nothing on screen to say
so. The control SHALL make the difference between "typed" and "stored" visible.

Attaching a slip SHALL continue to carry the rate shown, so the common case stays one action.

#### Scenario: A correction saves on its own

- **GIVEN** a document whose slip is already attached
- **WHEN** finance edits the rate and saves it
- **THEN** the rate is stored without a file being attached, and the screen shows it as saved

#### Scenario: An unsaved edit is visibly unsaved

- **GIVEN** finance has typed a rate different from the stored one
- **WHEN** they look at the panel
- **THEN** it shows the figure as not yet saved

### Requirement: The Panel States What Restating Will Do, Before It Is Done

The panel SHALL show what the stated rate will make the document worth, and what it will do to the
budget, before the rate is saved.

Restating changes the document's value and moves a budget reservation. Both are consequences the
person stating the rate is answerable for, and neither is visible from a number in a box. Where the
stated rate equals the document's current one, the panel SHALL say that instead of showing a change
of zero.

#### Scenario: The effect is shown before it is applied

- **GIVEN** a document worth one amount at its current rate
- **WHEN** finance types a different rate
- **THEN** the panel shows what the document will be worth at that rate before anything is saved

#### Scenario: An unchanged rate is stated as unchanged

- **WHEN** the rate typed equals the document's current rate
- **THEN** the panel says so rather than showing a nil change

### Requirement: The Rate Is Not Offered Where It Would Be Refused

The panel SHALL withdraw the rate control — and say why — when the document is past its last
approval, or already has a recorded payment.

The server refuses those cases, and a screen that offers an edit the server will refuse teaches
people that the screen lies. What was stated SHALL still be shown; only the ability to change it goes.

#### Scenario: A paid document shows the rate without offering to change it

- **GIVEN** a document whose payment is recorded
- **WHEN** the slip panel is opened
- **THEN** the stated rate is shown, the editable control is gone, and the reason is stated

#### Scenario: A document past its last approval is not offered the control

- **GIVEN** a `COMPLETED` document
- **WHEN** the slip panel is opened
- **THEN** the rate cannot be edited and the reason is stated
