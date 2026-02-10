# Installation & Deployment

This guide targets Debian/Ubuntu-based Linux (including LXC containers).

## 1) System Packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

## 2) Clone Repository

```bash
git clone git@github.com:meintechblog/command-runner.git
cd command-runner
```

## 3) Python Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4) Runtime Configuration

Create `.env` from example:

```bash
cp .env.example .env
```

Minimal values:

```env
HOST=127.0.0.1
PORT=8080
DATA_DIR=/opt/command-runner/data
```

Optional (recommended) explicit secret for credential encryption:

```env
COMMAND_RUNNER_SECRET_KEY=replace-with-strong-random-secret
```

If `COMMAND_RUNNER_SECRET_KEY` is not set, the app auto-creates `data/.credentials.key`.

## 5) Start Manually

```bash
source .venv/bin/activate
set -a
source .env
set +a
python -m app.main
```

Open `http://HOST:PORT`.

## 6) Optional: Run as systemd Service

Create `/etc/systemd/system/command-runner.service`:

```ini
[Unit]
Description=command-runner
After=network.target

[Service]
Type=simple
User=command-runner
WorkingDirectory=/opt/command-runner
EnvironmentFile=/opt/command-runner/.env
ExecStart=/opt/command-runner/.venv/bin/python -m app.main
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now command-runner
sudo systemctl status command-runner
```

## 7) Upgrade Procedure

```bash
cd /opt/command-runner
git pull --rebase
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart command-runner
```

## 8) Backup Hints

Important data to back up:

- `data/app.db`
- `data/runtime_status.json`
- `data/.credentials.key` (if used)
- `.env` (if `COMMAND_RUNNER_SECRET_KEY` is set there)
