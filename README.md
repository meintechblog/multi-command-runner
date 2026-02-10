# command-runner

Web UI for running and monitoring shell commands as reusable runners.

## Documentation

- Installation & deployment: `docs/INSTALL.md`
- Proxmox LXC setup guide: `docs/INSTALL.md#0-proxmox-lxc-recommended-homelab-setup`
- Security notes: `SECURITY.md`

## What It Does

- Manage multiple runners (name, command, schedule, cases, notifications)
- Run commands manually or on interval after each run finishes
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

## Requirements

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

## One-Liner Installer (Fresh Debian/LXC)

Run inside the target container as `root`:

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh | bash
```

If you use a non-root user with `sudo`, see `docs/INSTALL.md` for the sudo-safe variant.

Installer script location:

- `scripts/install.sh`

## Configuration

Environment variables:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8080`)
- `DATA_DIR` (default: `./data`)

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
