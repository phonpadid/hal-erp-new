## ADDED Requirements

### Requirement: The Line Editor Presents Budgets In The Structure They Have

The create wizard's budget control SHALL group the budgets it offers by the category their node
hangs under, using the category name the selectable read supplies, rather than presenting one flat
list ordered by code.

A department's budgets are a tree, and the leaves are named as if the branch were visible. Six
budgets reading `ງົບເດີນທາງ ພນ ບໍລິຫານ`, `… ພນ ບຸກຄະລາກອນ`, `… ພນ ມາດຕະຖານ` and so on differ by one
word and mean nothing apart; under their category, `ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ`, they are six
departments' travel budgets and the choice is obvious. The customer's largest department offers 92
such budgets in roughly 13 categories, and a requester scanning them flat is guessing.

Budgets whose node has no parent SHALL be offered under a single clearly-labelled group rather than
silently omitted or scattered.

The control SHALL remain filterable, and the filter SHALL match a category's name as well as a
budget's code and name, so typing a category narrows the list to its members. The filter input SHALL
carry a placeholder naming what can be typed — an unlabelled box beside a magnifier is the one
affordance that makes a long list usable, and it is invisible.

The control SHALL NOT display any budget amount, balance or ledger figure. The read behind it is
gated on `DOC_CREATE` rather than `BUDGET_VIEW` so a requester who may not read budget figures can
still raise a document; the grouping is what makes the choice legible without them.

#### Scenario: Budgets are grouped by their category

- **GIVEN** a department whose selectable budgets hang under several category nodes
- **WHEN** the requester opens the budget control on a line
- **THEN** the options appear under headings named for those categories, each budget under its own

#### Scenario: A category name distinguishes similarly-named budgets

- **GIVEN** several budgets whose names differ only by a trailing word, sharing one category
- **WHEN** the requester opens the budget control
- **THEN** they are shown together under that category's name

#### Scenario: A budget with no category is still offered

- **GIVEN** a selectable budget whose node has no parent
- **WHEN** the requester opens the budget control
- **THEN** it appears under a single labelled group for uncategorised budgets

#### Scenario: Typing a category narrows to its members

- **WHEN** the requester types a category's name into the control's filter
- **THEN** the budgets under that category are shown

#### Scenario: The filter says what it filters

- **WHEN** the budget control is opened
- **THEN** its filter input shows a placeholder describing what may be typed

#### Scenario: No figure is shown

- **WHEN** the budget control renders its options
- **THEN** no amount, balance or ledger figure appears for any budget
