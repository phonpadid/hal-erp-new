# Claim Integration Guide — for the claim system (B)

How the claim system submits a damaged-parcel claim to the ERP for approval and budget.

**Division of responsibility.** You own the case: intake, inspection, requesting more documents,
rejecting a claim, deciding whether the damage happened at a branch or the sorting centre, and
valuing it. You also pay the customer and close the case. The ERP owns the numbers: who has to
approve, the budget, and the accounting. Send only the cases that passed your inspection, happened
at the sorting centre, and already have a value.

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
idempotency key: `sourceId` is your own claim number, and the pair is unique per company. If a
request times out and you retry, you get **the same document back** — not a second one, and not a
second budget reservation. Send them on every create, always the same value for the same claim,
and never reuse a value for a different claim.

The pair is all-or-nothing: sending one without the other is a `400`.

**Response** — the created document:

```json
{ "id": "<uuid>", "docNo": "CLM-HAL-2026-0042", "status": "DRAFT", … }
```

Amounts are decimal **strings**, never JSON numbers. `"4500.00"`, not `4500.00`.

### Discovering the type id and the form

Do this once at startup and cache it; refresh when the form's `version` changes.

```http
GET /documents/creatable-types
```

```json
[ { "id": "<uuid>", "code": "CLAIM", "name": "Damaged parcel claim",
    "requiresBudget": true, "requiresQuota": false, "requiresVendor": false,
    "requiresItem": false, "requiresPayee": false, "defaultGlAccount": "5210" } ]
```

The list depends on the department of the user your key is bound to. If `CLAIM` is missing, the
key's user is in the wrong department — that is a configuration problem on our side, not yours.

```http
GET /documents/types/<type uuid>/form
```

```json
{ "documentTypeId": "<uuid>", "formTemplateId": "<uuid>", "version": 1,
  "fields": [
    { "id": "<uuid>", "fieldName": "trackingNo", "fieldLabel": "เลขพัสดุ",
      "fieldType": "text", "isRequired": true, "sortOrder": 1 }
  ] }
```

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

If the budget is exhausted you get a `400` and **nothing is written** — the claim stays `DRAFT`.
That is a real business event on your side: it means this claim cannot proceed until the budget is
increased.

After this the claim's fields are **frozen**. What was approved is what was submitted.

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
{ "id": "<uuid>", "docNo": "CLM-HAL-2026-0042", "status": "COMPLETED",
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

⚠️ **`COMPLETED` means "approved", not "paid".** Finance records the transfer separately in the
ERP. If you need to know whether the money actually left, ask us — that state exists, and today it
is not exposed to you.

There is no webhook yet. Poll `GET /documents/<id>` at a rate that suits you; there is no state
that changes faster than a person can sign something.

---

## Errors

| Status | Meaning | What to do |
|---|---|---|
| `400` | validation failed, budget exhausted, or the document is in the wrong state | read the message; most are permanent, not worth retrying |
| `401` | key missing, wrong, revoked, expired — or its user lost access to the company | stop and tell us; retrying will not help |
| `403` | the endpoint is barred to keys (approval), or the bound user lacks the permission | stop and tell us |
| `404` | the id is not a document of this key's company | check the id |
| `5xx` | our side | **safe to retry** if you send the same `sourceId` — that is what it is for |

**Retry rule.** Only retry on `5xx` and on network failures, and always with the same
`sourceType`/`sourceId`. Retrying a `400` will fail the same way; retrying a create without the
source pair creates a duplicate claim and reserves the budget twice.

---

## Worked example

```
POST /documents            { sourceType:"CLAIM", sourceId:"CLM-B-8842",
                             documentTypeId:"…", totalAmount:"4500.00", lines:[…] }
                           → { id:"d1", docNo:"CLM-HAL-2026-0042", status:"DRAFT" }

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

1. the **API key** (issued against a user in the claim-intake department),
2. the **`documentTypeId`** for `CLAIM` — or read it from `/documents/creatable-types`,
3. the **base URL** and confirmation that it is HTTPS.

And agree with us on:

- who owns any per-claim ceiling (we do not model one — the ERP's control is the budget and the
  approval chain),
- what your branch / sorting-centre codes are, so they can be mapped later,
- what to do when a submit fails because the budget is exhausted.
