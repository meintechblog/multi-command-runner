# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Pending

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
