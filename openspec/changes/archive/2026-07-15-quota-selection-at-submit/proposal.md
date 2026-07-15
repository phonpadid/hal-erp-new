## Why

The backend submit endpoint already reserves quota from a `quotaReservations[]` array in the
`POST /documents/:id/submit` body, and rejects any `requires_quota` document that arrives without
one (`Quota-controlled document declares no quota reservations`). But the web app never sends that
array — it calls `docs.submit(id)` with an empty body — so **every quota-controlled document type is
impossible to submit from the UI today**. There is no screen where the user picks a quota, an
employee, and a quantity. This closes that gap.

## What Changes

- Add a **requester-facing quota read**: `GET /quotas/selectable` authorized by `DOC_CREATE`
  (mirroring `GET /budgets/selectable`), returning the active company's quotas with a `personal`
  flag (whether the quota is entitlement-scoped) and an advisory `remaining`. A document requester
  holds `DOC_CREATE`/`DOC_SUBMIT`, not the finance reads `QUOTA_VIEW` / `EMPLOYEE_MANAGE`, so the
  existing `GET /quotas` and `GET /employees` cannot populate the wizard.
- Add a **quota reservation step** to the create-document wizard, shown only when the selected
  document type has `requires_quota = true` (config-driven, invariant 7). It lets the requester add
  one or more reservations, each capturing a `quotaId` and a `qty`, with the quota's advisory
  `remaining` shown so over-quota is visible before the server rejects it (server stays
  authoritative). No employee picker: the beneficiary of a personal quota is always the requester.
- **Resolve the personal-quota beneficiary to the requester's own employee on the server** at
  submit. The submit reserve loop SHALL force `employee_id` to the submitter's linked employee for a
  personal (entitlement-scoped) quota — ignoring any client-supplied value — so one requester can
  never reserve against another employee's quota, and reject if the submitter has no linked
  employee. Pool quotas reserve with no employee.
- Wire the collected reservations into the submit call: `docs.submit(id, { quotaReservations })`,
  matching the existing `SubmitDocumentDto` / `QuotaReservationInput` contract.
- Mirror the backend guard client-side: block Submit for a `requires_quota` type until at least one
  reservation with a positive `qty` exists, and surface server submit errors (over-quota,
  no reservations) verbatim, consistent with how budget submit errors are shown today.
- The **create-wizard review summary** lists the quota reservations that will be submitted, so it
  cannot drift from what is sent.

The submit endpoint, `SubmitDocumentDto` / `QuotaReservationInput`, and `QuotaUsageService.reserve`
already exist. The backend work is limited to the requester-facing `selectable` read and the
server-side self-resolution of the personal-quota beneficiary; the rest is frontend wiring.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `quota-management`: add a requester-facing `GET /quotas/selectable` read (authorized by
  `DOC_CREATE`) returning quotas with a `personal` flag and advisory `remaining`.
- `document-engine`: submit SHALL resolve a personal-quota reservation's beneficiary to the
  submitter's own linked employee (self-only) and reject when the submitter has no employee.
- `web-documents`: the create/edit wizard and Submit action gain a quota-reservation step and pass
  `quotaReservations` to the submit call; the review summary and validation feedback cover quota.

## Impact

- **Backend**: `back/src/modules/quota/quota.controller.ts` + `quota.service.ts` (new `selectable`
  read, `DOC_CREATE`-authorized, with a batched `personal` flag from `quota_entitlement`);
  `back/src/modules/document/document-submit.service.ts` (resolve personal-quota beneficiary to the
  submitter's employee before `QuotaUsageService.reserve`). The submit DTO
  (`back/src/modules/document/dto/document.dto.ts`) and reserve service are otherwise unchanged.
- **Frontend**: `front-end/src/views/documents/CreateDocumentView.vue` (new wizard step + payload),
  a new quota-reservation editor component, `front-end/src/api/quotas.ts` (`selectable`),
  `front-end/src/api/documents.ts` + `stores/documents.ts` (`submit` passes `quotaReservations`),
  and `front-end/src/views/documents/DocumentDetailView.vue` (route a `requires_quota` draft into
  the wizard rather than submit an empty body).
- **Contract note**: there is no `document_type → quota` link table in the DBML, so the document
  type only declares *that* it needs a quota, not *which* one — the requester selects the quota(s)
  at submit. The UI must not assume a fixed quota per type.
- **Invariants**: touches the document-engine/quota-management boundary. Reserve-then-release
  (invariants 4–5) and permission-code authorization (invariant 5/6) are honored server-side; the
  client guard is UX only. No new `quota_usage` write path — the existing reserve loop is reused.
