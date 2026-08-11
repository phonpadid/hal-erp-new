## 1. Fill strength per theme

- [x] 1.1 Derive the active theme in `BudgetListView.vue` from the app's own signal — the `.dark` class on the document root, matching `darkModeSelector` in `main.ts` — not from a media query that could disagree with an explicit toggle
- [x] 1.2 Make the fill's mix percentage depend on that: keep the current strength in dark, use a stronger one in light, with the hue still coming from `utilColor` and the colour still built with `color-mix` from a token
- [x] 1.3 React to a theme change while the list is open, rather than reading the theme once on mount
- [x] 1.4 Confirm in the browser, in BOTH themes, that the fill separates from the track and the figures stay at full opacity — the measured light-mode row is `rgb(241, 245, 249)` and the dark one `rgb(30, 41, 59)`
- [x] 1.5 Test what decides the colour (which theme was read, which mix was chosen) rather than the resolved pixels — `color-mix` does not resolve in jsdom, so asserting the output there would pass while proving nothing

## 2. Row numbering within groups

- [x] 2.1 Number rows within their group in `BudgetListView.vue`, leaving `AppDataTable`'s flat numbering alone — every other screen that uses it is a flat list and is correct as it is
- [x] 2.2 Keep flat mode numbering continuously, since there are no groups to count within
- [x] 2.3 Test: a first group of seven is numbered 1‥7 and the next group starts at 1

## 3. Flat / grouped toggle

- [x] 3.1 Add the toggle to the budget list toolbar, grouped by default
- [x] 3.2 Hold the choice in the budgets store for the session; do not write a user preference — that is a separate feature with server-side storage and its own permissions
- [x] 3.3 Render flat mode from the same loaded rows with the group headers omitted: no refetch, no paging change, no difference in the figures
- [x] 3.4 Add toggle labels to `locales/{la,en,zh}`
- [x] 3.5 Test: grouped is the default; flat hides the headers; both modes list the same budgets with the same available; switching issues no additional request
- [x] 3.6 Test: the choice survives navigating away and back within the session

## 4. Verification

- [x] 4.1 Run the front-end suite and typecheck
- [x] 4.2 Drive the running app in both themes against the seeded ພະແນກ ບໍລິຫານ data: grouped and flat, light and dark, and read the computed colours rather than trusting the screenshot
- [x] 4.3 Record in design.md whichever answer review settles for the open question (whether the toggle belongs on the control-points list too)
- [x] 4.4 Collapse the row-group header row entirely in flat mode — PrimeVue still emits one for the single bucket, and hiding only its contents left an empty tinted band above the first budget
