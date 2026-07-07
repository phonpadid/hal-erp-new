## ADDED Requirements

### Requirement: Application Shell

The web app SHALL render authenticated pages inside an application shell with a topbar (logo, menu
toggle, locale switch, dark-mode toggle, theme configurator, profile/logout), a collapsible
sidebar menu, and a content area. The active-company switch and the notification bell SHALL be
present in the topbar.

#### Scenario: Authenticated pages render in the shell

- **WHEN** a signed-in user opens any in-app route
- **THEN** the page renders inside the topbar + sidebar shell

#### Scenario: Logout from the topbar

- **WHEN** the user activates logout in the topbar
- **THEN** the session ends and they are returned to login

### Requirement: Permission-Gated Navigation

The sidebar menu SHALL show only the navigation entries whose permission code the active company
grants (UX only; the server still enforces). The menu replaces the previous header nav.

#### Scenario: Entry hidden without permission

- **WHEN** a signed-in user lacks a navigation entry's permission code
- **THEN** that entry is not shown in the sidebar

### Requirement: Theme and Locale Switching

The web app SHALL let the user change the theme (preset, primary colour, surface, dark mode, menu
mode) via the configurator and switch the locale, applying the change immediately.

#### Scenario: Changing a colour applies immediately

- **WHEN** the user picks a different primary colour in the configurator
- **THEN** the UI updates to that colour without a reload

### Requirement: Per-User Settings Sync

The web app SHALL load the signed-in user's saved settings on session restore and apply the theme
and locale, and SHALL auto-save changes (debounced, sending only changed fields). If the settings
API is unavailable, the app SHALL fall back to defaults without blocking use.

#### Scenario: Saved settings apply on next sign-in

- **WHEN** a user who previously chose a theme signs in again
- **THEN** that theme and locale are applied on load

#### Scenario: A change is persisted

- **WHEN** the user changes a setting
- **THEN** the change is saved for their account shortly after
