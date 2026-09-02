## 1. A job that can say no

- [x] 1.1 Add a `verify` job with its own Postgres service, and make `deploy` depend on it. The
  dependency is the whole point: a check that runs alongside the deploy has not gated anything.
- [x] 1.2 Give the job only database credentials. The deploy's SSH secrets have no business in a
  job that runs untrusted-by-default checks.

## 2. The four checks

- [x] 2.1 Run the backend suite against the service database.
- [x] 2.2 Create a second, empty database and run the migrations into it. It must be empty and it
  must not be the one the suite used — the suite leaves behind a schema built from the entities,
  which is exactly the thing the migrations are being checked against.
- [x] 2.3 Boot the real container against that migrated database.
- [x] 2.4 Run the frontend typecheck and suite.

## 3. Prove it without pushing

- [x] 3.1 Run the migrations into a fresh local database and confirm they produce the same table
  count as the deployed one.
- [x] 3.2 Run the schema comparison against that database and confirm it reports no drift.
- [x] 3.3 Boot-check against it.
- [x] 3.4 Run the frontend job locally and confirm it is green, so the new gate does not block
  every deploy on a pre-existing failure.
- [x] 3.5 Confirm an ambient database name wins over a `.env` file, or the checks would silently
  run against whatever that file names.
- [x] 3.6 Parse the workflow and confirm the job graph is what was intended.
