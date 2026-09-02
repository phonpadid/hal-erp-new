## 1. Give finance the permission its job needs

- [x] 1.1 Grant `PAYMENT_VIEW` and `PAYMENT_MANAGE` to the seeded `FINANCE` and `FINANCE_HEAD`
  roles, and say in a comment which permissions were withheld and why — the omission is a decision,
  not an oversight, and the next person to read it will otherwise "fix" it.
- [x] 1.2 Apply it to the running dev database by re-running the seeder rather than by hand, and
  confirm first that the seeder creates only what is missing. It must not reset a password someone
  has since changed.
- [x] 1.3 Verify against the running server that the finance account reaches the unsettled
  worklist and can record a settlement end to end.

## 2. Let a choice field describe itself

- [x] 2.1 Return a dropdown's permitted values from the form read, parsed to an array of strings.
- [x] 2.2 Omit the key entirely when there is nothing readable to put in it — a key present with
  an undefined value is a different contract from an absent key, and the caller can tell.
- [x] 2.3 Leave every other form-facing read alone.

## 3. Prove it

- [x] 3.1 Assert a choice field carries its values and a free-text field carries no key at all.
- [x] 3.2 Assert an unparseable stored value omits the key and the rest of the form still returns.
- [x] 3.3 Read the live form through an external key and confirm all three dropdowns report their
  values.

## 4. Tell the caller

- [x] 4.1 Document the key, and say plainly not to copy the values into caller-side code — that
  drift is the reason the read exists.
