## MODIFIED Requirements

### Requirement: Shared validation schema seam

The project SHALL provide a shared location (e.g. a `shared/` package) for Zod schemas
so that a form's client-side schema and the corresponding backend DTO derive from a
single source of truth and do not drift. Every package that consumes those shared schemas
(the `shared` package itself, the backend, and the frontend) SHALL depend on the **same Zod
major version** so the schemas type-check identically everywhere and the frontend
type-check (`vue-tsc`) passes against the shared `zodResolver` forms.

#### Scenario: Client and server share one schema

- **WHEN** a validation rule is changed in the shared schema
- **THEN** both the frontend form and the backend DTO reflect the change without a
  separate edit on each side

#### Scenario: One Zod major across consumers

- **WHEN** the shared package, the backend, and the frontend resolve their `zod` dependency
- **THEN** they resolve to the same Zod major version, and `vue-tsc` type-checks the
  `zodResolver` forms without a version-mismatch error
