## ADDED Requirements

### Requirement: Upload Company Profile Image
The system SHALL expose an authenticated endpoint, guarded by the `COMPANY_MANAGE`
permission code, that sets a company's 1:1 profile image (logo). The image bytes SHALL be
sent to the backend (multipart), which validates the mime type against the allow-list
(`image/png`, `image/jpeg`, `image/webp`) and enforces the size cap on the received bytes,
then writes them to object storage (S3/MinIO) server-side; the browser SHALL NOT PUT the
bytes directly to the bucket. Only the resulting object key SHALL be persisted on
`company.profile_image_path`; the raw bytes SHALL NOT be stored in the database. Reads SHALL
continue to return a short-lived presigned download URL for the current image, or null when
none is set.

#### Scenario: Admin sets a company logo
- **GIVEN** a user with `COMPANY_MANAGE`
- **WHEN** they post a PNG image to the company profile-image upload endpoint
- **THEN** the backend writes the bytes to object storage and sets `company.profile_image_path`
  to the stored object key
- **AND** the response returns a short-lived presigned URL for the new image
- **AND** no image bytes are stored in the database

#### Scenario: Oversized or disallowed company image is rejected
- **WHEN** a file exceeding the size cap or with a mime type not in the allow-list is posted
- **THEN** the request is rejected with a validation error and `company.profile_image_path`
  is unchanged and no object is written

#### Scenario: Upload requires COMPANY_MANAGE
- **GIVEN** a user without the `COMPANY_MANAGE` permission code
- **WHEN** they call the company profile-image upload endpoint
- **THEN** the request is rejected by the permission guard and no object is written
