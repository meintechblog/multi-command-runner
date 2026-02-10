#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_VERSION="1.1.3"

REPO_URL="${REPO_URL:-https://github.com/meintechblog/command-runner.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/command-runner}"
SERVICE_NAME="${SERVICE_NAME:-command-runner}"
APP_USER="${APP_USER:-command-runner}"
APP_GROUP="${APP_GROUP:-command-runner}"
HOST_BIND="${HOST_BIND:-0.0.0.0}"
PORT_BIND="${PORT_BIND:-8080}"
DATA_DIR="${DATA_DIR:-${INSTALL_DIR}/data}"
RUN_AS_ROOT="${RUN_AS_ROOT:-0}"
ENABLE_BASIC_AUTH="${ENABLE_BASIC_AUTH:-1}"

SERVICE_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${INSTALL_DIR}/.env"
generated_auth_password=""
effective_auth_user=""
effective_auth_password=""

log() {
  printf "%s [INFO] %s\n" "$(date '+%F %T')" "$*"
}

ok() {
  printf "%s [ OK ] %s\n" "$(date '+%F %T')" "$*"
}

warn() {
  printf "%s [WARN] %s\n" "$(date '+%F %T')" "$*"
}

fail() {
  printf "%s [FAIL] %s\n" "$(date '+%F %T')" "$*" >&2
  exit 1
}

run_as_app() {
  local cmd="$1"
  if [[ "${APP_USER}" == "root" ]]; then
    bash -lc "${cmd}"
  else
    runuser -u "${APP_USER}" -- bash -lc "${cmd}"
  fi
}

url_encode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -qE "^[[:space:]]*${key}=" "${file}"; then
    sed -i "s|^[[:space:]]*${key}=.*|${key}=${value}|" "${file}"
  else
    printf "%s=%s\n" "${key}" "${value}" >> "${file}"
  fi
}

on_error() {
  local line_no="$1"
  fail "Installer aborted at line ${line_no}."
}

trap 'on_error ${LINENO}' ERR

ensure_git_safe_directory() {
  local repo_dir="$1"
  if git -C "${repo_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi
  warn "Git safe.directory required for ${repo_dir}; adding it for root."
  git config --global --add safe.directory "${repo_dir}"
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Please run as root. Example: curl -fsSL <installer-url> | sudo bash"
fi

log "command-runner installer ${SCRIPT_VERSION} started."

if [[ "${RUN_AS_ROOT}" == "1" ]]; then
  APP_USER="root"
  APP_GROUP="root"
fi

command -v systemctl >/dev/null 2>&1 || fail "systemctl not found. This installer expects a systemd-based container."
command -v apt-get >/dev/null 2>&1 || fail "apt-get not found. This installer targets Debian/Ubuntu."

export DEBIAN_FRONTEND=noninteractive
log "Installing OS packages..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-pip python3-venv
ok "System packages installed."

if [[ "${APP_USER}" != "root" ]]; then
  if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
    log "Creating service group: ${APP_GROUP}"
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Creating service user: ${APP_USER}"
    useradd --system --gid "${APP_GROUP}" --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
fi

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  log "Updating existing repository in ${INSTALL_DIR}"
  ensure_git_safe_directory "${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" fetch --prune origin
  git -C "${INSTALL_DIR}" checkout "${REPO_BRANCH}"
  git -C "${INSTALL_DIR}" pull --ff-only origin "${REPO_BRANCH}"
elif [[ -d "${INSTALL_DIR}" && -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]]; then
  backup_dir="${INSTALL_DIR}.preinstall.$(date +%Y%m%d-%H%M%S)"
  warn "${INSTALL_DIR} exists and is not an empty git clone. Moving it to ${backup_dir}"
  mv "${INSTALL_DIR}" "${backup_dir}"
  log "Cloning repository to ${INSTALL_DIR}"
  git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
else
  log "Cloning repository to ${INSTALL_DIR}"
  git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}" "${DATA_DIR}"
if [[ "${APP_USER}" != "root" ]]; then
  chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"
fi

log "Setting up Python virtual environment and dependencies..."
run_as_app "cd '${INSTALL_DIR}' && python3 -m venv .venv && . .venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt"
ok "Python environment ready."

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${INSTALL_DIR}/.env.example" ]]; then
    cp "${INSTALL_DIR}/.env.example" "${ENV_FILE}"
  else
    : > "${ENV_FILE}"
  fi
fi

upsert_env "HOST" "${HOST_BIND}" "${ENV_FILE}"
upsert_env "PORT" "${PORT_BIND}" "${ENV_FILE}"
upsert_env "DATA_DIR" "${DATA_DIR}" "${ENV_FILE}"

if ! grep -qE "^[[:space:]]*COMMAND_RUNNER_SECRET_KEY=" "${ENV_FILE}"; then
  log "Generating COMMAND_RUNNER_SECRET_KEY..."
  secret_key="$(python3 -c 'import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
  printf "COMMAND_RUNNER_SECRET_KEY=%s\n" "${secret_key}" >> "${ENV_FILE}"
fi

if [[ "${ENABLE_BASIC_AUTH}" == "1" ]]; then
  current_auth_user="$(grep -E "^[[:space:]]*COMMAND_RUNNER_AUTH_USER=" "${ENV_FILE}" | tail -n 1 | cut -d'=' -f2- || true)"
  current_auth_pass="$(grep -E "^[[:space:]]*COMMAND_RUNNER_AUTH_PASSWORD=" "${ENV_FILE}" | tail -n 1 | cut -d'=' -f2- || true)"

  if [[ -z "${current_auth_user}" ]]; then
    current_auth_user="admin"
    upsert_env "COMMAND_RUNNER_AUTH_USER" "${current_auth_user}" "${ENV_FILE}"
  fi
  if [[ -z "${current_auth_pass}" ]]; then
    generated_auth_password="$(python3 -c 'import secrets,string; alphabet=string.ascii_letters + string.digits; print("".join(secrets.choice(alphabet) for _ in range(20)))')"
    upsert_env "COMMAND_RUNNER_AUTH_PASSWORD" "${generated_auth_password}" "${ENV_FILE}"
    current_auth_pass="${generated_auth_password}"
  fi
  effective_auth_user="${current_auth_user}"
  effective_auth_password="${current_auth_pass}"
else
  warn "Basic auth bootstrap disabled (ENABLE_BASIC_AUTH=0)."
fi

if [[ "${APP_USER}" != "root" ]]; then
  chown -R "${APP_USER}:${APP_GROUP}" "${DATA_DIR}"
  chown "${APP_USER}:${APP_GROUP}" "${ENV_FILE}"
fi

log "Writing systemd unit: ${SERVICE_UNIT_PATH}"
cat > "${SERVICE_UNIT_PATH}" <<EOF
[Unit]
Description=Command Runner Web App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}

EnvironmentFile=${ENV_FILE}
Environment=HOST=${HOST_BIND}
Environment=PORT=${PORT_BIND}

ExecStart=${INSTALL_DIR}/.venv/bin/python -m app.main

Restart=on-failure
RestartSec=3

KillSignal=SIGINT
TimeoutStopSec=5
KillMode=control-group
SendSIGKILL=yes

User=${APP_USER}
Group=${APP_GROUP}

[Install]
WantedBy=multi-user.target
EOF

log "Enabling and starting ${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

if ! systemctl is-active --quiet "${SERVICE_NAME}.service"; then
  systemctl status "${SERVICE_NAME}.service" --no-pager || true
  journalctl -u "${SERVICE_NAME}.service" -n 60 --no-pager || true
  fail "${SERVICE_NAME}.service failed to start."
fi
ok "${SERVICE_NAME}.service is active."

log "Waiting for API health check..."
health_ok="0"
health_curl_args=()
if [[ "${ENABLE_BASIC_AUTH}" == "1" && -n "${effective_auth_user}" && -n "${effective_auth_password}" ]]; then
  auth_token="$(printf "%s:%s" "${effective_auth_user}" "${effective_auth_password}" | base64 -w 0)"
  health_curl_args=(-H "Authorization: Basic ${auth_token}")
fi
for _ in $(seq 1 45); do
  if curl -fsS "${health_curl_args[@]}" "http://127.0.0.1:${PORT_BIND}/api/status" >/dev/null 2>&1; then
    health_ok="1"
    break
  fi
  sleep 1
done

if [[ "${health_ok}" != "1" ]]; then
  journalctl -u "${SERVICE_NAME}.service" -n 80 --no-pager || true
  fail "Service started but health endpoint did not respond in time."
fi

ok "Health check successful."

host_ips="$(hostname -I 2>/dev/null | xargs || true)"
lan_urls=()
if [[ -n "${host_ips}" ]]; then
  for ip in ${host_ips}; do
    if [[ "${ip}" != "127.0.0.1" ]]; then
      lan_urls+=("http://${ip}:${PORT_BIND}")
    fi
  done
fi

echo
echo "============================================================"
echo "command-runner installation completed successfully."
echo "Service: ${SERVICE_NAME}.service"
echo "Install dir: ${INSTALL_DIR}"
echo "Data dir: ${DATA_DIR}"
echo "URL (local): http://127.0.0.1:${PORT_BIND}"
echo "------------------------------------------------------------"
echo "WEB UI ACCESS (IMPORTANT)"
echo "From inside container: http://127.0.0.1:${PORT_BIND}"
if [[ ${#lan_urls[@]} -gt 0 ]]; then
  echo "From your LAN browser (use one of these):"
  for url in "${lan_urls[@]}"; do
    echo "  -> ${url}"
  done
else
  echo "LAN IP not detected automatically. Check with: hostname -I"
fi
echo "------------------------------------------------------------"
if [[ "${ENABLE_BASIC_AUTH}" == "1" && -n "${effective_auth_user}" ]]; then
  echo "WEB UI AUTH (BASIC)"
  echo "Username: ${effective_auth_user}"
  if [[ -n "${generated_auth_password}" ]]; then
    echo "Password (generated now): ${generated_auth_password}"
    echo "IMPORTANT: Save this password now. It is only shown once."
  else
    echo "Password: existing value from ${ENV_FILE} is used."
  fi
  echo "Recommended login flow (works across browsers):"
  echo "  1) Open one of the UI URLs above (without credentials in URL)"
  echo "  2) Enter username/password in the browser auth prompt"
  if [[ -n "${effective_auth_password}" ]]; then
    encoded_auth_user="$(url_encode "${effective_auth_user}")"
    encoded_auth_password="$(url_encode "${effective_auth_password}")"
    echo "Direct login URL (optional, browser-dependent):"
    echo "  Some browsers open directly, others ignore URL credentials and show the auth prompt."
    echo "  -> http://${encoded_auth_user}:${encoded_auth_password}@127.0.0.1:${PORT_BIND}/"
    if [[ ${#lan_urls[@]} -gt 0 ]]; then
      for url in "${lan_urls[@]}"; do
        lan_host_port="${url#http://}"
        echo "  -> http://${encoded_auth_user}:${encoded_auth_password}@${lan_host_port}/"
      done
    fi
  fi
  echo "------------------------------------------------------------"
fi
echo "Logs: journalctl -u ${SERVICE_NAME}.service -f"
echo "============================================================"
