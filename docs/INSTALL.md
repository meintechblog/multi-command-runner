# Installation & Deployment

This guide targets Debian/Ubuntu-based Linux (including LXC containers).

## Before You Start (Host vs Container vs User)

Use the commands in the correct place:

- `pveam ...` and `pct ...` commands run on the **Proxmox host node** (usually as `root`).
- App install commands run **inside the LXC container** (after `pct enter <CTID>`).

User context:

- The one-liner installer must run with **root privileges inside the container**.
- If you are already `root` in the container, use the root one-liner below.
- If you are logged in as a normal user with `sudo`, use the sudo-safe variant below.

Important:

- The installer creates a system service account `command-runner` for runtime by default.
- That account is not your interactive login account.
- After installation, the app runs as a `systemd` service automatically.

## Automated One-Liner Install (Fresh LXC)

Run this inside the new container as `root`:

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh | bash
```

If you are **not root** but have `sudo`, use this beginner-safe flow:

```bash
sudo apt-get update
sudo apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh -o /tmp/command-runner-install.sh
sudo bash /tmp/command-runner-install.sh
```

What this installer does automatically:

- installs required OS packages
- clones/updates repo to `/opt/command-runner`
- creates `.venv` and installs Python dependencies
- creates/updates `.env` including generated `COMMAND_RUNNER_SECRET_KEY`
- on fresh installs: asks whether HTTP Basic auth should be enabled
- if enabled: lets you set username/password interactively (password minimum: 8 characters)
- on updates: keeps existing auth values without interactive auth prompt
- installs/enables service and restarts `command-runner.service` (systemd)
- runs API health check and prints access URL/log commands

You can re-run the same one-liner later to apply updates from GitHub.
If the installer creates a new Basic-auth password, it is printed once at the end.

Browser auth note (important):

- Recommended: open the plain UI URL (for example `http://<LAN-IP>:8080`) and use the browser login prompt.
- Optional shortcut: `http://USER:PASSWORD@<LAN-IP>:8080/`
- Browser behavior differs by vendor: some open directly, others ignore URL credentials and still show the login prompt.

Optional overrides (example):

```bash
curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh | REPO_BRANCH=main PORT_BIND=8090 INSTALL_DIR=/opt/command-runner bash
```

Disable automatic Basic-auth bootstrap (not recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/meintechblog/command-runner/main/scripts/install.sh | ENABLE_BASIC_AUTH=0 bash
```

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
  --hostname command-runner-lxc \
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

Known-good Proxmox profile (real-world baseline):

- CPU: `1 vCPU`
- Memory: `512 MB RAM` + `512 MB swap`
- Disk: `4 GB` rootfs
- Networking: `eth0` via DHCP (plus optional second NIC for isolated mgmt/VLAN)
- Container mode: unprivileged, onboot enabled

When to scale up:

- Move to `2 vCPU` if you run multiple busy runners in parallel.
- Move to `1 GB RAM` if commands are heavier or logs/notifications are very active.
- Move to `8+ GB disk` if you keep long runner logs or large notification history.

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

Optional (recommended) HTTP Basic auth:

```env
COMMAND_RUNNER_AUTH_USER=admin
COMMAND_RUNNER_AUTH_PASSWORD=replace-with-strong-password
```

If both values are set, all UI/API routes require authentication.

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
