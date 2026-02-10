# command-runner

Web UI for running and monitoring shell commands as reusable runners.

## Quick Install (One-Liner)

Run inside the target Debian/Ubuntu container as `root`:

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh | bash
```

Re-running the same command also works as an update path (pull latest code + restart service).
On fresh installs, the installer asks whether HTTP Basic auth should be enabled.
If enabled, you can set username/password directly (password minimum: 8 characters).
On updates, existing auth state is kept (disabled stays disabled, enabled stays enabled) and no interactive auth prompt is shown.
If auth is enabled and no password exists, a secure password is generated and shown once.
You can disable auth bootstrap explicitly with `ENABLE_BASIC_AUTH=0` (not recommended).

## Quick Uninstall

Safe default uninstall (removes service + app directory, keeps data and service account):

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/uninstall.sh | bash
```

Full purge (also remove data and service account, non-interactive):

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/uninstall.sh | REMOVE_DATA=1 REMOVE_SYSTEM_ACCOUNT=1 FORCE=1 bash
```

## System Requirements (Short)

- Debian/Ubuntu Linux with `systemd` and `apt`
- Root privileges in the target container (or `sudo`)
- Outbound internet access to Debian mirrors and GitHub
- Baseline sizing for homelab/LXC: `1 vCPU`, `512 MB RAM`, `4 GB` disk

More installation details (including Proxmox LXC setup and sudo-safe install flow):

- `docs/INSTALL.md`
- `docs/INSTALL.md#0-proxmox-lxc-recommended-homelab-setup`

## Documentation

- Installation & deployment: `docs/INSTALL.md`
- Proxmox LXC setup guide: `docs/INSTALL.md#0-proxmox-lxc-recommended-homelab-setup`
- Security notes: `SECURITY.md`
- Changelog: `CHANGELOG.md`

## What It Does

- Manage multiple runners (name, command, schedule, cases, notifications)
- Clone a saved runner (creates a stored copy directly below the source)
- Run commands manually or on interval after each run finishes
- Show runner active duration while active (running/scheduled) (`hh:mm:ss`, unlimited hours)
- Stream live output via Server-Sent Events (SSE)
- Detect regex-based cases and trigger notifications
- Support semantic case states (`UP`, `DOWN`, `WARN`, `INFO`)
- Support alert controls per runner:
  - `Alert-Cooldown`
  - `Eskalation`
  - `Auto-Pause` after repeated failed runs
- Assign one or more notification services per runner
- Optional `Only updates` mode for notification targets
- Per-runner log files and live event feed
- Notification journal for send history / failures

## Security Warning

This app executes arbitrary shell commands (`bash -lc ...`) from the web UI.
Run it only in trusted/private environments and never expose it publicly without strong access controls.
Use Basic auth (`COMMAND_RUNNER_AUTH_USER` / `COMMAND_RUNNER_AUTH_PASSWORD`) and network restrictions.

## Requirements (Manual Run / Dev)

- Python 3.11+
- Linux environment with `bash`

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

Open:

- `http://127.0.0.1:8080`

## Configuration

Environment variables:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8080`)
- `DATA_DIR` (default: `./data`)
- `COMMAND_RUNNER_SECRET_KEY` (optional encryption key override)
- `COMMAND_RUNNER_AUTH_USER` + `COMMAND_RUNNER_AUTH_PASSWORD` (enable HTTP Basic auth when both are set)

Example:

```bash
HOST=0.0.0.0 PORT=8080 DATA_DIR=/opt/command-runner/data python -m app.main
```

## Data & Persistence

- App state is stored in SQLite (`data/app.db`)
- Runner runtime status is persisted (`data/runtime_status.json`)
- Runner logs are written as `data/run_<runner_id>.log`
- Notification credentials are stored encrypted at rest (Fernet, `enc:v1:` format)
- Encryption key source:
  - `COMMAND_RUNNER_SECRET_KEY` env var (recommended)
  - fallback: auto-generated `data/.credentials.key`

## Credential Handling

- API responses (`GET /api/state`) return masked credential values (`__SECRET_SET__`) instead of raw tokens
- Existing secrets remain unchanged unless explicitly overwritten in the UI
- The backend decrypts credentials only when needed for notification delivery/testing
- If encrypted credentials cannot be decrypted (wrong key), delivery for that service will fail until corrected

## Notification Behavior

- Services can be assigned per runner
- `Only updates` suppresses repeated identical notifications for a runner/service pair
- After 3 consecutive delivery failures, a notification service is auto-disabled
- Service status and counters are pushed live to the UI

## API (Main Endpoints)

- `GET /api/state` - load current app state
- `POST /api/state` - save app state
- `POST /api/clone_runner` - clone a runner (saved copy inserted below the source)
- `POST /api/run` - start a runner
- `POST /api/stop` - stop a runner
- `GET /api/events` - SSE event stream
- `GET /api/log/{runner_id}` - read runner log
- `DELETE /api/log/{runner_id}` - clear runner log
- `GET /api/notifications` - list notification journal entries
- `DELETE /api/notifications` - clear notification journal

## Development

Syntax check:

```bash
python3 -m py_compile app/main.py
```

## License

MIT License. See `LICENSE`.
