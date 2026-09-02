# web-documents

## ADDED Requirements

### Requirement: Choosing a Type Authored Elsewhere Goes There

The create wizard SHALL keep every type the department may raise in its card grid, including the
types whose content the generic form cannot author. Choosing a card whose type carries an
`authoring_route` SHALL navigate to that screen instead of advancing to the wizard's next step.

The grid is the inventory of what this department may raise, and a requester looking for leave looks
where documents are made. Omitting such a type would hide a capability that exists; continuing into
a generic form produces a document that cannot work.

When a type's `authoring_route` names a screen the client does not recognise, the wizard SHALL
continue into its own steps rather than dead-ending, so a misconfigured route degrades to today's
behaviour instead of a blank page.

#### Scenario: Leave goes to the leave screen

- **WHEN** a `DOC_CREATE` user chooses the leave card
- **THEN** they arrive at the leave request screen rather than the wizard's detail step

#### Scenario: A budget plan goes to the budget screen

- **WHEN** a user chooses the budget-plan card
- **THEN** they arrive at the screen that authors budget plans

#### Scenario: An unrecognised route falls back to the wizard

- **GIVEN** a type whose `authoring_route` names no known screen
- **WHEN** the card is chosen
- **THEN** the wizard advances to its own detail step

### Requirement: The Wizard Collects a Warehouse When the Type Requires One

When the chosen type is configured `requires_warehouse`, the wizard SHALL offer a selector of the
active company's warehouses, and SHALL send it as the document's warehouse on save. When the type's
`post_action` is `TRANSFER_STOCK` it SHALL additionally offer a destination warehouse, and the two
SHALL be required to differ.

Submit refuses a warehouse-requiring document that names none. Without these controls the refusal is
unanswerable: the message asks for a warehouse on a screen that has nowhere to put one, and the
document can only ever be a draft.

The wizard SHALL read `requires_warehouse` and `post_action` from the document-type payload rather
than inferring them from the type's code.

#### Scenario: A goods issue names a warehouse and submits

- **GIVEN** a document type with `requires_warehouse` true
- **WHEN** a user completes the wizard choosing a warehouse
- **THEN** the document is submitted rather than left as a draft

#### Scenario: A transfer asks for both ends

- **GIVEN** a type whose `post_action` is `TRANSFER_STOCK`
- **WHEN** the wizard renders its detail step
- **THEN** both a source and a destination warehouse are offered, and choosing the same one twice is
  rejected

#### Scenario: A type that needs no warehouse is not asked for one

- **GIVEN** a document type with `requires_warehouse` false
- **WHEN** the wizard renders its detail step
- **THEN** no warehouse selector is shown

### Requirement: The Wizard Collects an Employee When the Type Requires One

When the chosen type is configured `requires_employee`, the wizard SHALL offer a selector of the
active company's employees and SHALL send the choice as the document's related employee.

A promotion or resignation that names nobody is approvable and inert. The picker is what makes the
document say who it is about, so the post-action has a subject to act on.

#### Scenario: A promotion names its subject

- **GIVEN** a document type with `requires_employee` true
- **WHEN** the wizard renders its detail step
- **THEN** an employee selector is offered, and the chosen employee is carried on the document

#### Scenario: Submitting without an employee is refused

- **WHEN** such a document is submitted with no employee chosen
- **THEN** the submit is refused and the wizard says which field is missing

## MODIFIED Requirements

### Requirement: Create Wizard Document Type Selection

The Create Document wizard's first step SHALL let the user choose the document type from a set
of selectable cards — each showing the type's icon, name, and a short description — rather than a
bare dropdown. Exactly one card is selectable at a time, the selection SHALL be operable by
keyboard (focusable and activatable with Enter/Space) and expose its selected state to assistive
technology. When the chosen type carries money (category PROCUREMENT or FINANCE) the currency
picker SHALL remain available, and when the type is configured `requires_vendor` the vendor
picker SHALL remain available, both alongside the type selection. Choosing a type that carries an
`authoring_route` SHALL navigate to that screen instead of advancing the wizard. In edit mode the
type is fixed and the cards SHALL render in a read-only, non-interactive form. When the type list is
still loading, a skeleton placeholder SHALL be shown in place of the cards.

#### Scenario: Type is chosen from cards
- **WHEN** a user on the first step clicks or keyboard-activates a document-type card
- **THEN** that card becomes the single selected type, its selected state is exposed to
  assistive technology, and the wizard loads that type's configured form

#### Scenario: Money and vendor pickers stay inline
- **WHEN** the selected type carries money or is configured `requires_vendor`
- **THEN** the currency picker and/or the vendor picker render alongside the type cards

#### Scenario: Edit mode fixes the type
- **WHEN** the wizard is opened to edit an existing draft
- **THEN** the document type is shown read-only and cannot be changed

#### Scenario: A type authored elsewhere leaves the wizard
- **WHEN** the chosen type carries an `authoring_route`
- **THEN** the wizard navigates to that screen rather than loading its configured form
