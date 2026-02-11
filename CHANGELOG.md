# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Pending

## [2.2.0] - 2026-02-11

### Changed

- Project/product naming was fully updated from `command-runner` to `multi-command-runner`.
- GitHub repository references now point to `meintechblog/multi-command-runner`.
- Installer/uninstaller defaults were renamed:
  - service: `multi-command-runner`
  - install dir: `/opt/multi-command-runner`
  - runtime user/group: `multi-command-runner`
- Environment variable names were renamed to:
  - `MULTI_COMMAND_RUNNER_SECRET_KEY`
  - `MULTI_COMMAND_RUNNER_AUTH_USER`
  - `MULTI_COMMAND_RUNNER_AUTH_PASSWORD`
- UI title and export filenames now use `multi-command-runner`.

## [2.1.10] - 2026-02-10

### Changed

- Language switch is now a single DE/EN toggle button in the top-right corner.

## [2.1.9] - 2026-02-10

### Added

- UI language switch (DE/EN) in the top header.
- English UI translations (including the Info modal).

## [2.1.8] - 2026-02-10

### Changed

- Save buttons are now disabled (greyed out) when there are no unsaved changes.

## [2.1.7] - 2026-02-10

### Fixed

- Runner parameter lock now applies while the runner is active (running or scheduled), matching the UI "Stop" state.

## [2.1.6] - 2026-02-10

### Changed

- Runner config fields are locked while the runner is active; only runner notification assignment stays editable.
- Runner notification toggles renamed to "Ein/Aus" and "Updates only".
- Runner start (`Run`) is blocked while the runner has unsaved edits (Bearbeitungsmodus).

## [2.1.5] - 2026-02-10

### Fixed

- Runner duration display now stays visible while a runner is active (running or scheduled), instead of disappearing after a short run.

## [2.1.4] - 2026-02-10

### Added

- Runner runtime duration display while running (`hh:mm:ss`, unlimited hours).

## [2.1.3] - 2026-02-10

### Added

- Central collapse/expand toggle for the runners section (persisted in UI state).

### Changed

- Runner section label renamed to "Runners".
- Empty notification journal no longer shows a placeholder line.

## [2.1.2] - 2026-02-10

### Added

- "Events leeren" button (clears the events output panel immediately).

### Changed

- "Journal leeren" now triggers immediately (no confirmation prompt).

## [2.1.1] - 2026-02-10

### Added

- Runner clone action (`Clone`) to create a stored copy directly below the source runner.
- Subtle dirty-state highlighting for runner and notification service cards and name fields.

### Changed

- Save buttons for runners and notification services are now in the header action row.
- Runner status output now uses the full line on mobile (no unnecessary truncation).
- Creating a runner via `+ Runner` now immediately persists the runner.

## [2.1.0] - 2026-02-10

### Added

- Optional built-in HTTP Basic auth for UI/API via environment variables.
- Import safety limits (payload size, runner count, case count, total runner cap).
- SSE subscriber cap to reduce memory pressure.
- Output ring buffer limit per runner execution.
- Stronger ID/type validation for runner/case/notification profile data.
- `pip-audit` in CI for dependency vulnerability checks.

### Changed

- Security dependencies upgraded:
  - `fastapi` 0.128.6
  - `uvicorn` 0.40.0
  - `jinja2` 3.1.6
  - `pydantic` 2.12.5
  - `cryptography` 46.0.4
- Installer now bootstraps Basic auth credentials by default and shows generated password once.
- Installer health check now supports auth-enabled setups.

## [2.0.2] - 2026-02-10

### Added

- Credential encryption at rest for notification service secrets (`enc:v1` / Fernet).
- Masked secret placeholders in API state responses.
- Proxmox LXC installation guidance.
- One-liner installer (`scripts/install.sh`) with service setup and health check.
- UI improvements: notification dock/layout/status handling, collapsible sections, dirty-state feedback.

### Changed

- Runtime config refresh now applies to active/scheduled runners without manual restart.
- Notification service failure handling and status counters improved.
- Documentation and repo structure expanded (installation, security, usage notes).
