# web-inventory Specification

## Purpose
The Vue inventory area for the active company: what each warehouse holds, what is reserved
against it, what it is worth, and how it got that way. Balances and movement history are read-only
views over the stock ledger, with every movement linking back to the approval that produced it;
warehouse configuration and the stock document forms are the write surfaces. Quantities and costs
are decimal strings end to end — never a JS number — and all navigation and controls are gated by
`INV_*` permission codes as a UX-only guard, with the server remaining authoritative.

## Requirements

### Requirement: On-Hand Stock View

The web app SHALL let an `INV_VIEW` user see current stock for the active company as a filterable table of `(item, warehouse)` rows showing `qty_on_hand`, `qty_reserved`, available quantity, `avg_cost`, and `total_value`. The view SHALL offer a warehouse filter and a text filter over item code and name, and SHALL make reserved-versus-available visually distinct, because "10 on hand of which 8 are spoken for" is the number that decides whether a requester can issue. Quantities SHALL be formatted to four decimal places and costs and values to the currency's `decimal_places`; both SHALL be read as decimal strings and MUST NOT be parsed into a JS number. The view SHALL be reachable only when the active-company context carries `INV_VIEW`, as a UX-only guard with the server remaining authoritative.

#### Scenario: Stock is listed for the active company

- **WHEN** an `INV_VIEW` user opens the stock view
- **THEN** on-hand rows for the active company are listed, and switching the active company changes what is shown

#### Scenario: Available is distinguished from on-hand

- **GIVEN** an item with `qty_on_hand` 10 and `qty_reserved` 8
- **WHEN** its row is displayed
- **THEN** both figures and the available quantity 2 are shown distinctly

#### Scenario: The view is hidden without the permission code

- **WHEN** a user whose active company lacks `INV_VIEW` loads the app
- **THEN** the stock navigation entry is not shown

### Requirement: Stock Movement History

The web app SHALL let an `INV_VIEW` user open a per-item movement history showing each `stock_txn` row with its date, `txn_type`, warehouse, quantity, `unit_cost`, the document that caused it, and a running balance. The history SHALL link each row to its source document where one exists, so a surprising balance can be traced to the approval that produced it. It SHALL be filterable by warehouse and date range, paged rather than unbounded, and SHALL present `RESERVE` and `RELEASE` rows visibly distinct from rows that moved on-hand quantity, since they change only what is available.

#### Scenario: History shows a running balance

- **WHEN** the user opens an item's movement history
- **THEN** each movement is listed with its type, quantity, cost, and the balance after it

#### Scenario: A movement links to its document

- **GIVEN** a movement caused by an approved issue document
- **WHEN** its row is displayed
- **THEN** it links to that document

#### Scenario: Reservations are visually distinct

- **WHEN** the history contains `RESERVE` and `ISSUE` rows
- **THEN** the reservation rows are marked as not having changed on-hand quantity

### Requirement: Warehouse Administration

The web app SHALL let an `INV_MANAGE` user list, create, edit, and deactivate the active company's warehouses, with `code`, `name`, and `is_active`. The form SHALL use `@primevue/forms` with a `zodResolver` schema mirroring the backend DTO, and SHALL surface a duplicate-code conflict as a field error on `code` rather than a generic failure. Deactivation SHALL be presented as deactivation, never deletion, and SHALL require confirmation. Warehouse controls SHALL be shown only when the active-company context carries `INV_MANAGE`.

#### Scenario: Create a warehouse

- **WHEN** an `INV_MANAGE` user submits a valid code and name
- **THEN** the warehouse appears in the active company's list

#### Scenario: Duplicate code is a field error

- **GIVEN** a warehouse with code `MAIN` already exists in the active company
- **WHEN** the user submits another with code `MAIN`
- **THEN** the form shows a field error on `code` and no warehouse is created

#### Scenario: Deactivation is confirmed, not deletion

- **WHEN** the user deactivates a warehouse
- **THEN** a confirmation is required and the warehouse is shown as inactive rather than removed

### Requirement: Stock Document Forms

The web app SHALL render the issue, adjustment, and transfer document forms from the document engine's configuration rather than from hardcoded per-type screens, offering a warehouse selector when the type's `requires_warehouse` is true and a destination warehouse when its `post_action` is `TRANSFER_STOCK`. The line editor SHALL offer only items whose `is_stock_tracked` is true and which are enabled for the active company, and SHALL show each selected item's available quantity in the chosen warehouse beside the quantity input, so a shortage is visible before submit rather than as a server rejection. An adjustment line SHALL require a direction and the document a reason. The client SHALL warn when a requested quantity exceeds available, and SHALL still submit and surrender to the server's decision, because availability can change between render and submit.

#### Scenario: Available quantity is shown while entering a line

- **WHEN** the user picks a stock-tracked item and a warehouse on an issue document
- **THEN** that item's available quantity in that warehouse is displayed beside the quantity input

#### Scenario: Only tracked items are offered

- **WHEN** the user opens the item picker on a stock document
- **THEN** items whose `is_stock_tracked` is false are not offered

#### Scenario: Transfer collects both warehouses

- **WHEN** the user opens a document whose type `post_action` is `TRANSFER_STOCK`
- **THEN** the form collects a source and a destination warehouse, both from the active company

#### Scenario: Over-request is warned but still submitted

- **GIVEN** an item with available quantity 3
- **WHEN** the user enters 5 and submits
- **THEN** the client warns about the shortfall, submits, and reports the server's rejection

### Requirement: Inventory UI Presentation Standards

The web app SHALL source all inventory chrome — table headings, movement type labels, filter placeholders, empty states, confirmation copy, and validation messages — from i18n with en/la parity, and SHALL style it with PrimeUI theme tokens via `tailwindcss-primeui` and PrimeIcons, with no hardcoded colors, so it renders correctly in light and dark mode. Tables SHALL be paged rather than rendering an unbounded row set, and long lists SHALL be confined to a scroll region so a company with many items does not produce an unusable page.

#### Scenario: Every label has both locales

- **WHEN** the app is switched between en and la
- **THEN** every inventory label, movement type, and message is translated with no missing key

#### Scenario: Dark mode renders correctly

- **WHEN** the app is viewed in dark mode
- **THEN** inventory views use theme tokens and remain legible with no hardcoded colors

#### Scenario: Large stock lists stay usable

- **GIVEN** a company with many stock-tracked items
- **WHEN** the stock view is opened
- **THEN** rows are paged and the page does not scroll horizontally
