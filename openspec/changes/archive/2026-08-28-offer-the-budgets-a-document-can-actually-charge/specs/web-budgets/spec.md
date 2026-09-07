## MODIFIED Requirements

### Requirement: The Budget List Reads as a Tree

The budgets list SHALL show each budget's node `code` alongside its name, and SHALL be able to
present budgets under the tree their nodes describe — department, then category, then line — rather
than only as a flat table. A category row SHALL show the rolled-up total of the budgets beneath it,
so the figure a department head recognises from their own plan is on screen.

Their plan is authored as a tree and every control point will be placed on one of its nodes. A list
that shows only budgets gives an administrator no way to see the node they are about to govern, and
no way to check that a subtree sums to what they approved.

A category row SHALL be legible as structure rather than as an allocation: it is a node, it holds no
money of its own, and the figure against it is a total of what lies beneath.

The tree SHALL let a `BUDGET_MANAGE` user mark a node as carrying shared budget, and SHALL show
which nodes are marked and which are shared because an ancestor is. This is the screen that already
renders the plan hierarchy, so it is the screen where a decision about a subtree can be seen before
it is made; the document form SHALL NOT offer it.

Before a node is marked, the screen SHALL make plain how much it covers — a mark on a department
root shares that whole department's money, while a mark on one category shares only that category.
The count of budgets beneath a node is already on this screen; the consequence of the mark SHALL be
visible at the moment of the decision rather than discovered afterwards from a picker offering more
than anyone intended.

#### Scenario: A budget shows its node's code

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** each row shows the code of the node its money sits at, and its name

#### Scenario: The list can be shown as a tree

- **WHEN** the user switches the list to its tree presentation
- **THEN** budgets appear under their nodes, and a budget at a root node appears at the root

#### Scenario: A category shows the total beneath it

- **GIVEN** a category node with three budgets beneath it
- **WHEN** the tree presentation is shown
- **THEN** the category row shows the sum of those budgets' amounts

#### Scenario: A category is not mistaken for an allocation

- **WHEN** a category row is rendered
- **THEN** its figure is marked as a total of what lies beneath it rather than shown as though
  someone had allocated that amount to the category itself

#### Scenario: Amounts stay strings

- **WHEN** any budget amount or rolled-up total is rendered
- **THEN** it is formatted from a string/Decimal using the currency's decimal places, never from a
  JS number

#### Scenario: A node can be marked as shared from the tree

- **GIVEN** a `BUDGET_MANAGE` user viewing the tree presentation
- **WHEN** they mark a node as carrying shared budget
- **THEN** the node is marked, and the budgets beneath it are shared

#### Scenario: Inherited sharing is shown as inherited

- **GIVEN** a node whose ancestor is marked as shared
- **WHEN** the tree presentation is shown
- **THEN** that node is shown as shared through its ancestor, distinguishably from one marked itself

#### Scenario: Marking is not offered without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` views the tree presentation
- **THEN** no affordance to mark a node is offered to them

#### Scenario: The reach of a mark is visible before it is made

- **WHEN** a `BUDGET_MANAGE` user is about to mark a node
- **THEN** the screen states how many budgets the mark would cover
