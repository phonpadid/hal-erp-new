## Context

Five slices have built a module in which nothing can be edited. The punch ledger is append-only,
the daily projection is derived, and the two documents that draw on them — leave and overtime —
add facts rather than change them. That was deliberate, and it leaves one obvious hole: a punch
that is simply wrong.

`attendance-capture` anticipated this. It gave every event a `corrects_event_id` and a comment
saying a wrong punch is superseded by a new row naming it. Nothing has written that column since,
because the row always had somewhere to go — what was missing was the authority to write it.

The structural pattern is by now well-worn: a document, an owning endpoint, rules enforced at the
capability's own boundary, and a listener that recomputes after the approval commits. This slice
should reuse all of it. What it must think about carefully is the one thing genuinely new — what
"superseded" means to everything that reads the ledger.

## Goals / Non-Goals

**Goals:**

- Let a wrong punch be fixed without anyone editing or deleting a ledger row.
- Make the correction auditable: who asked, who approved, what it replaced, and what the original
  said — all still readable afterwards.
- Give `INCOMPLETE` days a remedy, which is what the daily slice said this would be for.
- Make the daily computation read a corrected ledger correctly, which means teaching it to skip
  what has been superseded.
- Bound how far back a correction may reach, so a closed period cannot be reopened forever.

**Non-Goals:**

- No editing of `attendance_day`. It is a projection; the way to change it is to change the ledger
  and recompute.
- No bulk correction. One request, one day, one employee — a tool that rewrites a month of
  attendance in one approval is a tool for covering something up.
- No auto-correction of `INCOMPLETE` days ("assume they left at shift end"). The daily design
  raised that as a possible policy flag and it remains out of scope: guessing an exit time and
  recording it as fact is exactly what the ledger exists to prevent.
- No period close, no payroll export, no frontend.

## Decisions

### 1. Supersession has to mean something to the reader, or the ledger double-counts

This is the decision the slice turns on, and it is a change to a capability already shipped.

`attendance_event.corrects_event_id` has existed since the capture slice, but nothing reads it.
The moment a corrective row exists, the day's punch collection sees **both** rows:

```
08:02 IN   (original, wrong — should have been 09:02)
09:02 IN   (corrective, corrects_event_id -> the 08:02 row)
        │
        └─ First/Last takes 08:02 as the day's first punch
           The correction changes nothing. Worse: nothing says it failed.
```

So the daily computation must skip any event that a later row supersedes. That is the only change
to how a day is computed in this slice, and without it the whole feature is decorative.

Stating the rule precisely: an event is **superseded** when some other event's `corrects_event_id`
names it. Superseded events remain in the ledger, remain readable, and are excluded from the
first/last selection. They are the audit trail; they are not the record of what happened.

### 2. Removal is supersession too, not a delete

The ledger cannot delete, so "this punch should not exist" has to be expressed as an insert. A
removal is a corrective row that names its target and is itself marked as carrying no time.

Two ways to express that were considered:

| | approach | verdict |
|---|---|---|
| A | a `VOID` value in `attendance_direction` | pollutes an enum that answers "in or out" with a value that is neither |
| B | a nullable `voids` boolean on the corrective row | a second flag meaning almost what `corrects_event_id` already means |
| C | a corrective row whose `corrects_event_id` is set and which the collection skips as well as its target | no new column, no enum change |

**C.** A corrective row that supersedes a target and is itself excluded is exactly a removal, and
the shape already exists: `time_correction.kind` says what was requested, and the resulting event
is written accordingly. The ledger stays a ledger of punches; the *reason* lives on the correction
document where a human wrote it.

Consequence to state plainly: a removal's corrective row is inserted with the same instant as its
target so it belongs to the same shift day, and the collection skips both. A reader looking at the
raw ledger sees the original, sees the row that voided it, and can tell the story.

### 3. A correction names a shift day, not an instant

A person says "my Tuesday is wrong". The projection thinks in shift days. The punches a day
consumes are collected by the shift window, which may cross midnight. Phrasing the request as a
date range of instants would put the burden of the window arithmetic on the requester and would
let them name a range that spans no day the system recognises.

So `time_correction` carries `shift_date` and, for a change or removal, the `attendance_event` it
targets — which the requester picks from that day's punches rather than describing by time.

### 4. Approval writes the event; the request does not

A correction document in DRAFT or IN_APPROVAL has changed nothing. Only full approval inserts the
corrective `attendance_event`, stamped `source = MANUAL` with `recorded_by` set to the approving
user rather than the requester.

`recorded_by` naming the approver rather than the requester is deliberate: capture's spec already
says the set of rows with a non-null `recorded_by` is exactly the set of hand-entered punches, and
the accountable party for a corrective punch is whoever authorised it. The requester is recorded
on the document, where the reason is too.

### 5. Recompute after the approval commits, and never roll it back

Identical to leave, for identical reasons, and reusing the same `approval.outcome` seam: the
approval is a human decision that must not be discarded because a derived number could not be
written. A failure is logged, and the day stays findable by comparing `attendance_day.computed_at`
to `document.approved_at`.

Worth noting rather than re-deriving: this is the second listener on that event. The first checks
for a leave request and returns if there is none; this one does the same for a correction. Neither
knows about the other, which is the property that made the event seam right in the first place.

### 6. The backdating window is configuration on `company`

How far back a correction may reach is a policy, and it differs by company. It goes on `company`
for the same reason `timezone` and the overtime ceiling did: a single scalar that every path
needs, with no other home yet.

Its real purpose arrives with period close, which does not exist. Until then it stops a correction
reopening arbitrarily old attendance, which is the weaker but still useful half of the same idea.

### 7. Transactions and locking

**This slice writes no `budget_txn` and no `quota_usage` rows, and issues no document numbers.**
A correction consumes no allowance — it fixes a fact.

The event insert and the correction's status change commit together, so a correction cannot be
recorded as approved without its punch existing. Beyond that this slice needs no new lock: there
is no read-then-write on contended state. Two corrections targeting the same event would both
supersede it, which is harmless — the collection skips a superseded event once regardless of how
many rows name it, and the second correction's own row is the one that stands.

That last point is worth a test rather than an assumption.

## Risks / Trade-offs

- **Teaching the daily computation to skip superseded events changes a shipped behaviour** →
  Mitigated by there being no superseded events in existence: nothing has ever written
  `corrects_event_id`, so every current day computes identically. The change is inert until this
  slice's own documents start using it, which makes it about as safe as such a change can be.

- **A chain of corrections (A superseded by B, B superseded by C) must resolve to C** → Handled by
  excluding any event that is named by any other, which drops both A and B without needing to walk
  the chain in order. Worth a test, because the naive "skip the target of the newest row" would
  leave B standing.

- **`recorded_by` pointing at the approver, not the requester** → Deliberate (decision 4) but it
  means the ledger alone does not say who asked. The document does, and the two are joined by
  `time_correction.document_id`. Someone reading only `attendance_event` sees who authorised it,
  which is the accountability that matters for a hand-entered punch.

- **No bulk correction** → A supervisor fixing a whole team's misconfigured day must raise a
  document each. Intentional friction: the alternative is one approval that rewrites a month.

- **A removal's corrective row carries a direction it does not mean** → It has to carry something,
  and inventing a `VOID` direction pollutes an enum that answers a different question (decision 2).
  The row is excluded from collection, so the value is never read; a comment on the column says so.

## Migration Plan

1. **Forward migration**, additive only: create `time_correction` with foreign keys to `company`,
   `document` (unique), `employee`, and a nullable `attendance_event` target; add
   `company.correction_window_days`.
2. **Update `erp_approval_system.dbml`**.
3. **Seed** a correction document type and a window for the demo company.
4. No backfill. No existing event is superseded, so every existing day computes exactly as before —
   the supersession filter is inert until this slice writes the first corrective row.

**Rollback:** drop the table and the column. The supersession filter would remain in the daily
computation, but with nothing writing `corrects_event_id` it has nothing to exclude, so the
projection behaves as it does today.

## Open Questions

- Should a correction be allowed to target an event that is itself corrective? Chaining is handled
  (see risks) and there is no reason to forbid it, but it is worth deciding rather than discovering.
- Should the window be measured from the shift day being corrected, or from the day the request is
  raised? This design assumes the former — "you may correct the last N days" — which is what the
  phrase means to a person.
- Whether an approved correction should notify the employee whose attendance changed. The
  notification capability exists; whether attendance changes warrant one is a policy call nobody
  has made.
