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

Every rolled-up MONEY figure the tree shows — a node's total and its available balance — SHALL be
computed over budgets whose `budget.status` is `ACTIVE` or `CLOSED`, and over no others. The count
of budgets beneath a node is not a money figure and SHALL keep counting all of them, because a
shared-budget mark reaches every budget at or beneath the node once it is in force. A budget in any other status SHALL contribute nothing to any ancestor's figure.
This is the same rule the `budget-period-reporting` capability states for every figure it reports,
and it SHALL be one declaration read by both, so that a report and the tree above it cannot state
different money. It SHALL be expressed as the set of statuses that ARE counted, never as the set
excluded: statuses outside every declared list are reachable in this system, and a deny-list would
admit them into a ceiling.

A budget that is not counted SHALL still appear in the tree, and SHALL be marked as not counted,
with its status named. It is not dropped: a `DRAFT` is a plan being written, a `REJECTED` is the
record of what a plan refused, and a tree that hid either would answer "what became of the budget I
proposed?" with silence. The mark SHALL use PrimeUI theme tokens so it reads in light and dark mode,
and SHALL carry a label from i18n at en/la/zh parity.

Where the tree renders a node holding exactly one budget and no child nodes AS that budget — one row
standing for both, because the plan line and the money at it are the same row in the reader's book —
that row SHALL follow the same rule: when its budget is not counted, the row is marked as not
counted and the node contributes nothing to its ancestors.

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

- **GIVEN** a category node with three `ACTIVE` budgets beneath it
- **WHEN** the tree presentation is shown
- **THEN** the category row shows the sum of those budgets' amounts

#### Scenario: A refused budget is not counted into its ancestors

- **GIVEN** a category node whose only budget is `REJECTED` for 30,000,000, left by a cancelled plan
- **WHEN** the tree presentation is shown
- **THEN** that category and every node above it show a total of zero

#### Scenario: A budget awaiting approval is not counted into its ancestors

- **GIVEN** a category node holding one `ACTIVE` budget of 12,000,000 and one `DRAFT` of 5,000,000
- **WHEN** the tree presentation is shown
- **THEN** the category row shows 12,000,000

#### Scenario: A closed budget is still counted

- **GIVEN** a category node holding one `CLOSED` budget
- **WHEN** the tree presentation is shown
- **THEN** that budget's amount is included in the category's total

#### Scenario: A status in no declared list is not counted

- **GIVEN** a budget whose status is neither `ACTIVE` nor `CLOSED` nor any other declared value
- **WHEN** the tree presentation is shown
- **THEN** it contributes nothing to any node's total

#### Scenario: An uncounted budget is shown rather than dropped

- **GIVEN** a node holding one `ACTIVE` budget and one `REJECTED` budget
- **WHEN** the tree presentation is shown
- **THEN** both rows are present, and the `REJECTED` row is marked as not counted with its status
  named

#### Scenario: A node standing for one uncounted budget is marked, not silently zeroed

- **GIVEN** a node with no child nodes whose single budget is `REJECTED`
- **WHEN** the tree presentation is shown
- **THEN** that row is marked as not counted, so its zero contribution is explained rather than read
  as a budget of nothing

#### Scenario: The reach of a mark still counts every budget beneath it

- **GIVEN** a node holding two `ACTIVE` budgets and three `DRAFT` budgets
- **WHEN** the screen states how many budgets a mark on that node would cover
- **THEN** it says five, because the mark shares the node itself and every budget at or beneath it
  once in force, while the node's money total shows only the two `ACTIVE` amounts

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
