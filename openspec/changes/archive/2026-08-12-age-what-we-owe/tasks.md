## 1. Ageing on the read

- [x] 1.1 `openPayables` resolves the company's day once, via `companyDay()` and `localDateIn`.
- [x] 1.2 Each row carries `daysOverdue` (0 when not yet due) and `bucket`.
- [x] 1.3 `NOT_DUE | D1_30 | D31_60 | D61_90 | D90_PLUS`, measured from the DUE date.
- [x] 1.4 `daysBetween` works on `YYYY-MM-DD` strings — no instants, no offsets.

## 2. The summary

- [x] 2.1 `payablesAgeing()` returns per-bucket total and count from the same derivation.
- [x] 2.2 Totals summed with `Money.add`.
- [x] 2.3 `GET /journal/open-payables/ageing` under `GL_VIEW`, declared beside the list. Route order
      checked: the controller has no parameterised route that could shadow it.

## 3. The client

- [x] 3.1 `OpenPayable` carries the two fields; `PayablesAgeing` and its api + store slot added.
      The store loads both in one `Promise.all`, so the rows and the bands are always the same read.
- [x] 3.2 `OpenPayablesView` shows the bands above the list and the band per row.
- [x] 3.3 No client-side bucket or lateness computation — the file's doc comment says so and the
      screen has nothing that could.
- [x] 3.4 i18n in `en`, `la`, `zh`.

## 4. Tests

- [x] 4.1 Forty days past due is `D31_60` with 40 days.
- [x] 4.2 A future due date is `NOT_DUE` with 0, asserted separately.
- [x] 4.3 A day past due is `D1_30`, pinning the lower boundary.
- [x] 4.4 The bands total to the whole liability.
- [x] 4.5 The company timezone is actually consulted.
      The first version compared the company day to the UTC day, which passes whenever the two
      coincide — most of the day. Rewritten to read `agedAt` under `Pacific/Kiritimati` (UTC+14) and
      `Pacific/Midway` (UTC-11): twenty-five hours apart, so their dates ALWAYS differ, and the case
      cannot pass by luck.
- [x] 4.6 Frontend: the bands render from the server's figures, and each row shows the band it was
      given.
- [x] 4.7 Negative check.
      Two of the first three breakages did NOT redden, and both were gaps in the tests rather than
      in the code: ageing from the invoice date was indistinguishable because the fixture's vendor
      had zero payment terms, so due date and invoice date were the same day; and the UTC-day
      substitution passed for the reason in 4.5. The fixture now gives its vendor 45-day terms, and
      after both fixes each breakage reddens — the invoice-date one across three cases.

## 5. Checks

- [x] 5.1 Backend 1428 passed / 36 skipped (was 1423); frontend 89 files / 779 tests (was 777);
      `nest build` and `typecheck` clean.
      `typecheck` caught a missing `PayablesAgeing` type import that the test run did not.
- [x] 5.2 `openspec validate --all` passes.
- [x] 5.3 `openspec/specs/**` untouched.
