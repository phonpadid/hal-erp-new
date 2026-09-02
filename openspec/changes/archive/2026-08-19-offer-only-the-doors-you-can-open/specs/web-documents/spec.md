# web-documents

## ADDED Requirements

### Requirement: A Type Whose Authoring Screen This User Cannot Open Is Not Offered

Where a document type carries an `authoring_route`, the wizard SHALL determine whether the current
user may open that screen, and SHALL NOT let them choose the type when they may not. The
determination SHALL read the permission the destination route itself declares, so the card follows
the same guard that governs the screen.

Two unrelated things decide who sees the card and who may open the screen: the department mapping
decides the first, the route's permission decides the second. Nothing keeps them in step, so a user
can be offered a type whose screen refuses them — the navigation succeeds, the guard redirects them
away, and they arrive somewhere else with nothing said and nothing created. That is a worse outcome
than the dead-end it replaced, because it is immediate and silent: a user who does not know the
permission model cannot tell it from a misclick.

The required permission SHALL NOT be stored beside the document type. The route already declares it,
and a second copy is free to drift from the guard that enforces it.

An unreachable card SHALL be shown in a disabled state naming the permission required, rather than
hidden. A hidden card teaches nothing to a user who was told to raise that document and cannot find
it; a disabled one tells them what to ask for. The permission SHALL be named by its code, which is
what the system authorizes on and what an administrator can act on.

A disabled card SHALL remain reachable by keyboard and SHALL expose its disabled state to assistive
technology, so the reason can be read by every input method. Activating it SHALL do nothing.

When a type's `authoring_route` names a route that cannot be resolved, the type SHALL be treated as
reachable: the wizard keeps such a type in its own steps, so no other screen and no other permission
is involved.

A type with no `authoring_route` SHALL be unaffected — the wizard authors it, and the permissions
that govern it are the ones already checked for creating a document.

#### Scenario: A type whose screen the user cannot open is disabled

- **GIVEN** a document type routed to a screen whose permission the user does not hold
- **WHEN** the wizard renders its type cards
- **THEN** that card is shown disabled and names the permission required, and choosing it does
  nothing

#### Scenario: A type whose screen the user can open is offered normally

- **GIVEN** a routed document type whose destination permission the user holds
- **WHEN** the card is chosen
- **THEN** the wizard navigates to that screen as before

#### Scenario: An unresolvable route leaves the card enabled

- **GIVEN** a type whose `authoring_route` names no known route
- **WHEN** the wizard renders its type cards
- **THEN** the card is enabled, and choosing it advances the wizard's own steps

#### Scenario: A type the wizard authors itself is unaffected

- **GIVEN** a document type with no `authoring_route`
- **WHEN** the wizard renders its type cards
- **THEN** the card is enabled regardless of any screen's permissions

#### Scenario: The disabled card can still be read

- **WHEN** a keyboard user moves through the type cards
- **THEN** an unreachable card can be focused and reports itself as disabled, and activating it
  changes nothing
