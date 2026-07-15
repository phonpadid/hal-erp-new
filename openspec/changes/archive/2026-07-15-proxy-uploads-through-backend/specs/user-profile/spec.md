## ADDED Requirements

### Requirement: Upload Own Profile Image
The system SHALL expose an authenticated endpoint that lets the signed-in user set their
own 1:1 profile image, resolving the user from the JWT and never from an id in the request
path. The image bytes SHALL be sent to the backend (multipart), which validates the mime
type against the allow-list (`image/png`, `image/jpeg`, `image/webp`) and enforces the size
cap on the received bytes, then writes them to object storage (S3/MinIO) server-side; the
browser SHALL NOT PUT the bytes directly to the bucket. Only the resulting object key SHALL
be persisted on `app_user.profile_image_path`; the raw bytes SHALL NOT be stored in the
database. The profile read SHALL continue to return a short-lived presigned download URL for
the current image, or null when none is set.

#### Scenario: User sets their profile image
- **WHEN** an authenticated user posts a PNG image to the profile-image upload endpoint
- **THEN** the backend writes the bytes to object storage and sets `app_user.profile_image_path`
  to the stored object key
- **AND** the response returns a short-lived presigned URL for the new image
- **AND** no image bytes are stored in the database

#### Scenario: Oversized or disallowed profile image is rejected
- **WHEN** the user posts a file exceeding the size cap or whose mime type is not in the
  allow-list
- **THEN** the request is rejected with a validation error and `app_user.profile_image_path`
  is unchanged and no object is written

#### Scenario: Profile image is private to the user
- **GIVEN** an authenticated user
- **WHEN** they upload a profile image
- **THEN** the image is associated with their own `app_user` resolved from the JWT, never
  from a path id, so a user can only set their own profile image
