## 1. Make a declared set of values mean something

- [x] 1.1 Check a written value against its field's declared values before anything is stored, and
  refuse with a message naming both the rejected value and the accepted ones.
- [x] 1.2 Derive the rule from the field alone. If the diff mentions a document type code, stop —
  that is the per-type branching this system exists to avoid.
- [x] 1.3 Let an empty value through: clearing a field is not the same as choosing a bad value, and
  emptiness is the submit's business.
- [x] 1.4 Skip enforcement on a field whose declared values cannot be read, matching what the form
  read already does with the same data.

## 2. Stop offering a settlement that cannot be settled

- [x] 2.1 Reduce the claim form's settlement choices to the one the system can post.
- [x] 2.2 Teach the setup script to publish a new form version when a field's OPTIONS change, not
  only when a field is missing — a changed set is a changed form, and now that the set is enforced
  it decides what callers may send.
- [x] 2.3 Confirm documents already created keep the version they were created against.

## 3. Make a stranded document audible

- [x] 3.1 Separate "no applicable step" from the harmless failures that shared its catch.
- [x] 3.2 Report it at a severity that is on by default, naming the document, saying budget is held,
  and saying what to fix.
- [x] 3.3 Keep the failure from escaping into the emitter.

## 4. Decide the ceiling rather than carry it

- [x] 4.1 Decide: no per-claim ceiling. Record the reasoning where the caller reads it, not only in
  a commit message.
- [x] 4.2 Tell the caller the consequence honestly — a wrong amount holds budget until someone
  rejects it — and point at the cancel that releases it sooner.

## 5. Prove it

- [x] 5.1 Cover offered, unoffered, batch-atomicity, cleared, free-text and unreadable.
- [x] 5.2 Run the field tests against the unguarded code and confirm they fail.
- [x] 5.3 Cover the stranded report, its content, the quiet case, and that nothing escapes.
- [x] 5.4 Drive the live server: confirm the claim form offers one settlement, that the other is
  refused by name, and that the accepted one still writes.

## 6. Stop the suite failing for reasons that are not its own

- [x] 6.1 The two specs that clear `app_user` in their setup built no schema of their own, so a
  document row left in the shared test database by an earlier run held a foreign key and took
  eleven tests down with a message about neither signatures nor profile images. Give them their
  own schema, as every other DB-backed spec here already does.
- [x] 6.2 Say why in the file. A reader who sees a slower setup and no obvious reason will replace
  it with the faster call and reintroduce the failure.
