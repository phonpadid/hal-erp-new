# Claim Integration Guide — for the claim system (B)

How the claim system submits a damaged-parcel claim to the ERP for approval and budget.

**Division of responsibility.** You own the case: intake, inspection, requesting more documents,
rejecting a claim, deciding whether the damage happened at a branch or the sorting centre, valuing
it, talking to the customer and closing the case. The ERP owns the money: who has to approve, the
budget, the accounting, and the transfer to the customer. Send only the cases that passed your
inspection, happened at the sorting centre, and already have a value.

Your validation step is not an approval. **Approval happens once, in the ERP** — it is the decision
to spend the company's money, and it is always made by a person. Do not build a second approval on
your side or the same claim will be signed twice.

**ERP finance makes the transfer, not you.** This was open in an earlier revision of this guide
and is now decided. You never move money for a claim: you send the payee's name, bank and account
number as field values, ERP finance transfers to them and records the payment with the slip
attached, and you read the result from `GET /documents/<id>/settlement`. Build no payout step on
your side, and do not treat `COMPLETED` as "paid" — it means "approved". The two are days apart.

Authentication and the general rules of API keys are in [external-api.md](./external-api.md). This
document is the claim flow specifically.

---

## The whole flow

```
 ①  POST /documents                     create the claim          → DRAFT
 ②  PUT  /documents/:id/fields          the claim's details
 ③  POST /documents/:id/attachments/upload   damage photos, bank details
 ④  POST /documents/:id/submit          hand it over              → IN_APPROVAL
 ⑤  (a person approves in the ERP)                                → COMPLETED
 ⑥  GET  /documents/:id                 poll for the outcome
```

Every request carries the key:

```http
Authorization: Api-Key ak_8f3d1a2b.<random>
```

You never send a company id. The key belongs to one company and cannot reach another.

---

## ① Create the claim

```http
POST /documents
Content-Type: application/json

{
  "documentTypeId": "<CLAIM type uuid>",
  "sourceType": "CLAIM",
  "sourceId": "CLM-B-8842",
  "totalAmount": "4500.00",
  "lines": [
    { "lineNo": 1, "description": "ค่าชดเชยพัสดุเสียหาย",
      "qty": "1", "unitPrice": "4500.00", "lineAmount": "4500.00" }
  ]
}
```

**`sourceType` + `sourceId` are the most important fields in this document.** They are your
idempotency key: `sourceId` is your own claim identifier, and the pair is unique per company. If a
request times out and you retry, you get **the same document back** — not a second one, and not a
second budget reservation.

The pair is all-or-nothing: sending one without the other is a `400` with
`code: "VALIDATION_FAILED"`, naming whichever half is missing.

The ERP treats `sourceId` as opaque — any format is fine. What it must be is:

| Property | Why |
|---|---|
| **unique** | it is the key; a value reused for a different claim returns the wrong document |
| **immutable** | it must still match on the retry, which may be minutes later |
| **already set before you submit** | a value assigned when the case *closes* is not available when the case is *created*, and idempotency would silently do nothing |

A human-facing document number that staff can edit, or that is assigned at the end of the case's
life, is the wrong field. Use a value your system generates when the case opens and never rewrites,
and keep your readable number separate.

**Response** — the created document:

```json
{ "id": "<uuid>", "docNo": "CLAIM-HAL-2026-0001", "status": "DRAFT", … }
```

Amounts are decimal **strings**, never JSON numbers. `"4500.00"`, not `4500.00`.

⚠️ **`lines` is not optional, even though the create succeeds without it.** A claim charges a
budget, and the budget is charged per line — a document with `totalAmount` and no lines is created
happily as a `DRAFT` and then refuses to submit with *"Budget-controlled document has no budgeted
lines"*. One line carrying the whole amount is enough. If you would rather add them separately,
`PUT /documents/<id>/lines` takes the same array.

### Discovering the type id and the form

Do this once at startup and cache it; refresh when the form's `version` changes.

```http
GET /documents/creatable-types
```

```json
[ { "id": "<uuid>", "code": "CLAIM", "name": "เคลมพัสดุเสียหาย", "category": "FINANCE",
    "requiresBudget": true, "requiresQuota": false, "requiresVendor": false,
    "requiresItem": false, "requiresPayee": false, "defaultGlAccount": "5300" } ]
```

The list depends on the department of the user your key is bound to. If `CLAIM` is missing, the
key's user is in the wrong department — that is a configuration problem on our side, not yours.

```http
GET /documents/types/<type uuid>/form
```

```json
{ "documentTypeId": "<uuid>", "formTemplateId": "<uuid>", "version": 2,
  "fields": [
    { "id": "<uuid>", "fieldName": "trackingNo", "fieldLabel": "เลขพัสดุ",
      "fieldType": "text", "isRequired": true, "sortOrder": 2 },
    { "id": "<uuid>", "fieldName": "claimKind", "fieldLabel": "พัสดุหายหรือเสียหาย",
      "fieldType": "dropdown", "isRequired": true, "sortOrder": 3,
      "options": ["LOST", "DAMAGED"] }
  ] }
```

Read the version from the response rather than pinning it — it is already at 2, because
`claimKind` was added after the first draft of this guide, and it will move again.

A `dropdown` field carries `options`: the values that field will accept. Send one of them
verbatim. The key is absent on every other field type, so treat its presence as the signal that a
field is a choice rather than free text — and do not copy the values into your own code, because
that is the drift this read exists to prevent.

**Guaranteed: a field `id` never changes without `version` changing.** A published form template is
frozen — adding or editing a field on it is rejected, and the only way to change the form is to
publish a new version. So caching the `fieldName → id` map and refreshing when `version` moves is
safe; there is no path by which an id shifts underneath a stable version.

---

## ② Fill in the claim's details

```http
PUT /documents/<id>/fields
Content-Type: application/json

[ { "formFieldId": "<uuid from the form>", "value": "TH12345678" },
  { "formFieldId": "<uuid>", "value": "4500.00" },
  { "formFieldId": "<uuid>", "value": "COD" } ]
```

`204 No Content` on success.

⚠️ **`formFieldId` is the field's UUID, not its name.** Map `fieldName → id` from the form you
fetched in ①. If someone publishes a new form template the ids change, which is what `version` is
for — refresh when it moves.

### What to send

| Field | Why it matters |
|---|---|
| tracking number, cause, COD or not | the claim's identity |
| `claimKind`: `LOST` or `DAMAGED` | required. One document type covers both today, so this is the only thing that tells them apart — see below |
| the amount you assessed | the ERP does not re-value anything |
| your branch / sorting-centre code | reporting now; possibly per-branch budgets later |
| the payee's name, bank and account number | finance reads these to make the transfer |
| your own claim reference | so a human can trace it back to your system |

The ERP does not know your customers or your employees. Whatever identifies the claimant must
travel as field values — there is nothing to look up on our side.

---

## ③ Attach the evidence

```http
POST /documents/<id>/attachments/upload
Content-Type: multipart/form-data

file=@damage-1.jpg
```

One call per file. Send the damage photos and, if you have it, the payee's QR code or a screenshot
of the account details — the approver sees them when deciding, and finance uses them to pay.

---

## ④ Submit

```http
POST /documents/<id>/submit
Content-Type: application/json

{}
```

This is the moment money is committed:

- the budget is **reserved** for the amount,
- the exchange rate is locked,
- the claim goes to whoever has to approve it, chosen by amount.

If the budget is exhausted you get a `400` and **nothing is written** — the whole submit is one
transaction, so the document survives intact as a `DRAFT` with all its fields and attachments.

**Do not create the claim again.** Keep the document id, put your case in a "waiting for budget"
state, and call `POST /documents/<id>/submit` again once the budget has been topped up. Re-creating
would be harmless only because of your `sourceId` — but re-submitting is the intended path.

After a successful submit the claim is **frozen**: its field values, its lines and its payee can no
longer be changed. What an approver signs is what takes effect, so `PUT /:id/fields` and
`PUT /:id/lines` answer `400 INVALID_STATE` on a document that has left `DRAFT`.

The supported way to change a submitted claim is to have it **returned** — an approver sends it
back, it becomes a `DRAFT` again, you edit it and submit it, and the whole chain approves what it
now says.

**Attachments are not frozen.** Uploading evidence works at any status, because an approver asking
for another photo is part of deciding, and a photo cannot change what the document says.

---

## ⑤ A person approves

There is no auto-approval. Every claim is approved by a human in the ERP, through the chain
configured for its amount — small claims may need one signature, large ones several.

Your key **cannot** approve, reject or delegate. That bar is on the key itself, not on
permissions, so it cannot be lifted by granting anything.

---

## ⑥ Read the outcome

```http
GET /documents/<id>
```

```json
{ "id": "<uuid>", "docNo": "CLAIM-HAL-2026-0001", "status": "COMPLETED",
  "totalAmount": "4500.00", "approvedAt": "2026-07-27T09:14:00.000Z" }
```

`GET /documents/<id>/detail` returns the header plus field values, lines and attachments.

### Statuses

| Status | Meaning | What you do |
|---|---|---|
| `DRAFT` | created, not submitted | finish filling it in |
| `SUBMITTED` | submitted, routing starting | wait |
| `IN_APPROVAL` | waiting for someone to sign | wait |
| `COMPLETED` | **fully approved** | tell the customer; the payout is arranged in the ERP |
| `REJECTED` | an approver refused it | tell the customer; the budget was released automatically |
| `CANCELLED` | withdrawn before approval | — |

⚠️ **`COMPLETED` means "approved", not "paid".** The transfer is recorded separately — see below.

### Has it actually been paid?

```http
GET /documents/<id>/settlement
```

```json
{ "settlementType": "CASH", "settledAt": "2026-07-27", "reference": "TXN-9001" }
```

`404` while the claim has been approved but not yet paid. That is the normal answer for a while,
not an error — **poll `GET /documents/<id>` for status and ask this once it reads `COMPLETED`**,
rather than polling the settlement itself.

Readable with your existing key: it needs `DOC_VIEW`, the same permission that reads the document.

**What it does not return, and will not:** the transfer slip, the person who recorded it, and any
internal note. The slip is our audit record and the recorder is our accountability record; you
asked for a date and a reference so you can tell your customer, and that is the contract. Do not
plan around getting the file.

### Sent back for correction

An approver can return a claim instead of rejecting it. There is **no `RETURNED` status**: the
document goes back to `DRAFT`, and its budget reservation is released immediately.

```
   IN_APPROVAL ──approver returns it──▶ DRAFT   + budget released
                                          │
                                    fix it, submit again
                                          │
                                    reserves again, routes from the first step
```

⚠️ **A returned claim looks exactly like one that was never submitted.** Both read `DRAFT`, and
polling `GET /documents/<id>` cannot tell them apart. If your case is in a "waiting for approval"
state and the document reads `DRAFT`, it was returned — read `/approval-log` for the `RETURN` entry
and the approver's remark, which is what you tell your own team to fix.

There is no webhook. Poll `GET /documents/<id>` at a rate that suits you; nothing here changes
faster than a person can sign something.

### Why a claim was rejected, and by whom

`GET /documents/<id>` carries the status but not the reason. The full history is its own endpoint:

```http
GET /documents/<id>/approval-log
```

It returns every action taken on the document in order. It is append-only, so you get the whole
trail rather than only the last word. Readable with your key.

```json
[ { "id": "<uuid>", "stepNo": 1, "action": "APPROVE",
    "remark": "ตรวจสอบแล้ว เสียหายจริง", "actedAt": "2026-07-27T09:56:51.401Z",
    "approver": { "id": "<uuid>", "username": "dept_head" },
    "delegatedFrom": null } ]
```

`action` is one of `APPROVE`, `REJECT`, `RETURN`, `DELEGATE`, `ESCALATE`. `delegatedFrom` is the
approver who delegated, or `null` when the approver acted in their own right.

**An approver is a username and an id — nothing more.** You are reading our staff directory
through a keyhole on purpose; the fields above are the whole contract and no account detail will
appear beside them.

This is also the only way to see that a claim was **returned** rather than never submitted — see
"Sent back for correction" above.

A claim you rejected during your own inspection never reached the ERP at all, so the two kinds of
rejection are never confused: one has a document with a log, the other has no document.

---

## Attaching more evidence later

An approver may ask for another photo while the claim is waiting to be signed. That works:

```http
POST /documents/<id>/attachments/upload
```

is allowed at **any** status. The field values, the lines and the payee all freeze at submit;
evidence does not.

---

## Cancelling a claim

```http
POST /documents/<id>/cancel
```

| | |
|---|---|
| **Allowed with your key?** | Yes — unlike approval, this is not barred to keys |
| **Permission** | `DOC_CANCEL`, on the user your key is bound to — tell us if it is missing |
| **Up to which status?** | `DRAFT`, `SUBMITTED`, `IN_APPROVAL` — you can cancel while it is waiting for a signature |
| **Who may cancel?** | only the document's creator, which is your key's user, so every document you created is yours to cancel |
| **Is the budget released?** | Yes, automatically and in full — budget, quota and stock holds all release, and calling twice does not release twice |
| **Already cancelled?** | the call succeeds and does nothing |

Use it when the customer withdraws, or when you find out after submitting that the claim should not
have been filed.

---

## Errors

| Status | Meaning | What to do |
|---|---|---|
| `400` | validation failed, budget exhausted, or the document is in the wrong state | branch on the `code` field — see below |
| `401` | key missing, wrong, revoked, expired — or its user lost access to the company | stop and tell us; retrying will not help |
| `403` | the endpoint is barred to keys (approval), or the bound user lacks the permission | stop and tell us |
| `404` | the id is not a document of this key's company | check the id |
| `5xx` | our side | **safe to retry** if you send the same `sourceId` — that is what it is for |

**Retry rule.** Only retry on `5xx` and on network failures, and always with the same
`sourceType`/`sourceId`. Retrying a `400` will fail the same way; retrying a create without the
source pair creates a duplicate claim and reserves the budget twice.

### Telling the three kinds of `400` apart

They mean completely different things to a caller:

```
   payload is wrong        → a bug in the integration. Fix it. Never retry.
   budget exhausted        → a business event. Hold the case, tell someone, submit again later.
   document is in the      → you sent something that no longer applies. Skip it.
     wrong state
```

Every error response carries a **`code`** for exactly this. Branch on it; never on `message`, which
contains ids and amounts and which we are free to reword.

**Budget exhausted** — hold the case, tell someone, submit the same document again later:

```json
{
  "statusCode": 400,
  "message": "Over budget: 4500.00 requested, 1200.00 available on budget 8f3d1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
  "error": "Bad Request",
  "code": "BUDGET_EXCEEDED"
}
```

**Payload wrong** — a bug in the integration; never retry. Note `message` is an array here:

```json
{
  "statusCode": 400,
  "message": [
    "settledAt must be a valid ISO 8601 date string",
    "settlementType should not be empty"
  ],
  "error": "Bad Request",
  "code": "VALIDATION_FAILED"
}
```

**Wrong state** — the operation no longer applies; skip it:

```json
{
  "statusCode": 400,
  "message": "Document 3f2a9c1e-7b4d-4a2f-9e1c-5d8b3a6f0c27 is not in DRAFT",
  "error": "Bad Request",
  "code": "INVALID_STATE"
}
```

There is also `QUOTA_EXCEEDED`, the same shape as `BUDGET_EXCEEDED` for a quota rather than a
budget. Claims do not use quota, so you should never see it.

**These four codes are the contract.** Every other response carries a code derived from its HTTP
status — `BAD_REQUEST`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`. Those are a
convenience, not a promise: a case that later earns a name will stop returning its generic. Do not
build behaviour on them.

---

## Worked example

```
POST /documents            { sourceType:"CLAIM", sourceId:"CLM-B-8842",
                             documentTypeId:"…", totalAmount:"4500.00", lines:[…] }
                           → { id:"d1", docNo:"CLAIM-HAL-2026-0001", status:"DRAFT" }

PUT  /documents/d1/fields  [ {formFieldId:"f1", value:"TH12345678"},
                             {formFieldId:"f2", value:"4500.00"}, … ]      → 204

POST /documents/d1/attachments/upload   file=damage-1.jpg                  → 201
POST /documents/d1/attachments/upload   file=payee-qr.png                  → 201

POST /documents/d1/submit  {}          → budget reserved, status IN_APPROVAL

… a person approves …

GET  /documents/d1                     → { status:"COMPLETED", approvedAt:"…" }
```

A timeout anywhere in this sequence is recoverable: repeat the `POST /documents` with the same
`sourceId` and you will be handed `d1` again.

---

## Before you start

Ask us for:

1. the **API key** (issued against a user in the claim-intake department, holding `DOC_CREATE`,
   `DOC_SUBMIT`, `DOC_VIEW` and `DOC_CANCEL`),
2. the **base URL** and confirmation that it is HTTPS,
3. the **`documentTypeId`** for `CLAIM` — though `/documents/creatable-types` returns it, so this
   is a convenience rather than a dependency.

And agree with us on:

- who owns any per-claim ceiling (the ERP does not model one — its controls are the budget and the
  approval chain),
- what your branch / sorting-centre codes are, so they can be mapped later,
- what to do when a submit fails because the budget is exhausted.

### Lost parcels and damaged parcels

This was open in an earlier revision and is now decided: **one document type covers both**, and you
say which by sending `claimKind` as `LOST` or `DAMAGED`. It is required, so every claim is labelled
from the first one.

That labelling is the point. If accounting later decides the two are different expenses, the split
is a second document type carrying the other one — you would send a different `documentTypeId` and
change nothing else — and the claims filed before that day are already separable, because you told
us which each one was. Send an honest value even though nothing branches on it today.
