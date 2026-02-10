# Installation & Deployment

This guide targets Debian/Ubuntu-based Linux (including LXC containers).

## 0) Proxmox LXC (Recommended Homelab Setup)

If you run `command-runner` on Proxmox, an unprivileged Debian 12 LXC is a good default.

Template (once per node):

```bash
pveam update
pveam available | grep debian-12-standard
pveam download local debian-12-standard_12.12-1_amd64.tar.zst
```

Create container (example based on your setup):

```bash
pct create 1030 \
  /var/lib/vz/template/cache/debian-12-standard_12.12-1_amd64.tar.zst \
  --hostname hydra-lxc \
  --password 'meinpasswort' \
  --cores 1 \
  --memory 512 \
  --swap 512 \
  --rootfs data:4 \
  --unprivileged 1 \
  --onboot 1 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp,type=veth \
  --net1 name=eth1,bridge=vmbr0,ip=10.28.45.2/24,type=veth \
  --start 1
```

Recommended reliability settings:

```bash
pct set 1030 --onboot 1
pct set 1030 --startup order=3,up=20,down=20
```

Enter container and continue with step 1 below:

```bash
pct enter 1030
```

Notes:

- If you do not need a second network interface, omit `--net1`.
- `--password` appears in shell history on the Proxmox host. Use a temporary value and change it immediately inside the container if needed.
- For stable operations, configure regular Proxmox backups (`vzdump`) for this CT.

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

## 6) Optional: Run as systemd Service (Recommended for Proxmox/LXC)

Create a dedicated service user (recommended):

```bash
if ! id -u command-runner >/dev/null 2>&1; then
  sudo useradd --system --home /opt/command-runner --shell /usr/sbin/nologin command-runner
fi
sudo chown -R command-runner:command-runner /opt/command-runner
```

Create `/etc/systemd/system/command-runner.service`:

```ini
[Unit]
Description=Command Runner Web App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/command-runner

EnvironmentFile=/opt/command-runner/.env
Environment=HOST=0.0.0.0
Environment=PORT=8080

ExecStart=/opt/command-runner/.venv/bin/python -m app.main

Restart=on-failure
RestartSec=3

# Important for clean SSE shutdown behavior:
KillSignal=SIGINT
TimeoutStopSec=5
KillMode=control-group
SendSIGKILL=yes

# Optional hardening:
# NoNewPrivileges=true
# PrivateTmp=true

User=command-runner
Group=command-runner

[Install]
WantedBy=multi-user.target
```

If you intentionally run as `root`, replace:

- `User=command-runner` with `User=root`
- `Group=command-runner` with `Group=root`

Enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now command-runner.service
sudo systemctl status command-runner.service
```

Useful checks:

```bash
sudo systemctl restart command-runner.service
sudo journalctl -u command-runner.service -f
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
