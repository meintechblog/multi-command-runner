#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_VERSION="1.0.0"

SERVICE_NAME="${SERVICE_NAME:-command-runner}"
INSTALL_DIR="${INSTALL_DIR:-/opt/command-runner}"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env}"
DATA_DIR="${DATA_DIR:-}"
APP_USER="${APP_USER:-command-runner}"
APP_GROUP="${APP_GROUP:-command-runner}"

REMOVE_INSTALL_DIR_WAS_SET="${REMOVE_INSTALL_DIR+x}"
REMOVE_DATA_WAS_SET="${REMOVE_DATA+x}"
REMOVE_SYSTEM_ACCOUNT_WAS_SET="${REMOVE_SYSTEM_ACCOUNT+x}"
FORCE_WAS_SET="${FORCE+x}"

REMOVE_INSTALL_DIR="${REMOVE_INSTALL_DIR:-1}"
REMOVE_DATA="${REMOVE_DATA:-0}"
REMOVE_SYSTEM_ACCOUNT="${REMOVE_SYSTEM_ACCOUNT:-0}"
FORCE="${FORCE:-0}"

SERVICE_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

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

on_error() {
  local line_no="$1"
  fail "Uninstaller aborted at line ${line_no}."
}

trap 'on_error ${LINENO}' ERR

parse_bool() {
  local var_name="$1"
  local value="$2"
  case "$(printf "%s" "${value}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on) printf "1" ;;
    0|false|no|n|off|"") printf "0" ;;
    *)
      fail "Invalid value for ${var_name}: ${value}. Use one of: 1/0, true/false, yes/no."
      ;;
  esac
}

prompt_yes_no() {
  local question="$1"
  local default_choice="$2" # y or n
  local answer=""
  local suffix=""

  if [[ "${default_choice}" == "y" ]]; then
    suffix="(y/n, default: y)"
  else
    suffix="(y/n, default: n)"
  fi

  while true; do
    read -r -p "${question} ${suffix}: " answer < /dev/tty
    answer="${answer:-${default_choice}}"
    answer="$(printf "%s" "${answer}" | tr '[:upper:]' '[:lower:]')"
    case "${answer}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please answer with y or n." > /dev/tty ;;
    esac
  done
}

resolve_data_dir() {
  if [[ -z "${DATA_DIR}" && -f "${ENV_FILE}" ]]; then
    DATA_DIR="$(grep -E "^[[:space:]]*DATA_DIR=" "${ENV_FILE}" | tail -n 1 | cut -d'=' -f2- || true)"
  fi
  if [[ -z "${DATA_DIR}" ]]; then
    DATA_DIR="${INSTALL_DIR}/data"
  fi
}

assert_safe_remove_path() {
  local path_value="$1"
  local label="$2"
  if [[ -z "${path_value}" || "${path_value}" == "/" || "${path_value}" == "." || "${path_value}" == ".." ]]; then
    fail "Refusing to remove unsafe ${label} path: '${path_value}'"
  fi
}

configure_options() {
  if [[ "${FORCE}" == "1" ]]; then
    return
  fi
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    warn "No interactive TTY detected. Using default/specified uninstall options."
    return
  fi

  if [[ -z "${REMOVE_INSTALL_DIR_WAS_SET}" ]]; then
    if prompt_yes_no "Remove install directory (${INSTALL_DIR})?" "y"; then
      REMOVE_INSTALL_DIR="1"
    else
      REMOVE_INSTALL_DIR="0"
    fi
  fi

  if [[ -z "${REMOVE_DATA_WAS_SET}" ]]; then
    if prompt_yes_no "Remove data directory (${DATA_DIR})?" "n"; then
      REMOVE_DATA="1"
    else
      REMOVE_DATA="0"
    fi
  fi

  if [[ -z "${REMOVE_SYSTEM_ACCOUNT_WAS_SET}" ]]; then
    if prompt_yes_no "Remove service account (${APP_USER}:${APP_GROUP})?" "n"; then
      REMOVE_SYSTEM_ACCOUNT="1"
    else
      REMOVE_SYSTEM_ACCOUNT="0"
    fi
  fi

  if ! prompt_yes_no "Proceed with uninstall now?" "n"; then
    fail "Uninstall canceled by user."
  fi
}

remove_service() {
  if systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1 || [[ -f "${SERVICE_UNIT_PATH}" ]]; then
    log "Stopping and disabling ${SERVICE_NAME}.service"
    systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    systemctl disable "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    if [[ -f "${SERVICE_UNIT_PATH}" ]]; then
      rm -f "${SERVICE_UNIT_PATH}"
    fi
    systemctl daemon-reload
    systemctl reset-failed "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    ok "Service removed."
  else
    warn "Service ${SERVICE_NAME}.service not found. Skipping service removal."
  fi
}

remove_install_dir_if_requested() {
  if [[ "${REMOVE_INSTALL_DIR}" != "1" ]]; then
    log "Keeping install directory: ${INSTALL_DIR}"
    return
  fi

  assert_safe_remove_path "${INSTALL_DIR}" "INSTALL_DIR"
  if [[ -e "${INSTALL_DIR}" ]]; then
    log "Removing install directory: ${INSTALL_DIR}"
    rm -rf "${INSTALL_DIR}"
    ok "Install directory removed."
  else
    warn "Install directory not found: ${INSTALL_DIR}"
  fi
}

remove_data_dir_if_requested() {
  if [[ "${REMOVE_DATA}" != "1" ]]; then
    log "Keeping data directory: ${DATA_DIR}"
    return
  fi

  assert_safe_remove_path "${DATA_DIR}" "DATA_DIR"
  if [[ "${REMOVE_INSTALL_DIR}" == "1" && ( "${DATA_DIR}" == "${INSTALL_DIR}" || "${DATA_DIR}" == "${INSTALL_DIR}/"* ) ]]; then
    log "Data directory was inside install directory and is already removed."
    return
  fi

  if [[ -e "${DATA_DIR}" ]]; then
    log "Removing data directory: ${DATA_DIR}"
    rm -rf "${DATA_DIR}"
    ok "Data directory removed."
  else
    warn "Data directory not found: ${DATA_DIR}"
  fi
}

remove_service_account_if_requested() {
  if [[ "${REMOVE_SYSTEM_ACCOUNT}" != "1" ]]; then
    log "Keeping service account: ${APP_USER}:${APP_GROUP}"
    return
  fi

  if id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Removing user: ${APP_USER}"
    pkill -u "${APP_USER}" >/dev/null 2>&1 || true
    if userdel "${APP_USER}" >/dev/null 2>&1; then
      ok "User removed: ${APP_USER}"
    else
      warn "Could not remove user ${APP_USER}. Remove manually if needed."
    fi
  else
    warn "User not found: ${APP_USER}"
  fi

  if getent group "${APP_GROUP}" >/dev/null 2>&1; then
    log "Removing group: ${APP_GROUP}"
    if groupdel "${APP_GROUP}" >/dev/null 2>&1; then
      ok "Group removed: ${APP_GROUP}"
    else
      warn "Could not remove group ${APP_GROUP}. It may still be in use."
    fi
  else
    warn "Group not found: ${APP_GROUP}"
  fi
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Please run as root. Example: curl -fsSL <uninstall-url> | sudo bash"
fi

REMOVE_INSTALL_DIR="$(parse_bool "REMOVE_INSTALL_DIR" "${REMOVE_INSTALL_DIR}")"
REMOVE_DATA="$(parse_bool "REMOVE_DATA" "${REMOVE_DATA}")"
REMOVE_SYSTEM_ACCOUNT="$(parse_bool "REMOVE_SYSTEM_ACCOUNT" "${REMOVE_SYSTEM_ACCOUNT}")"
FORCE="$(parse_bool "FORCE" "${FORCE}")"

log "command-runner uninstaller ${SCRIPT_VERSION} started."
resolve_data_dir
configure_options

log "Selected options:"
log "  SERVICE_NAME=${SERVICE_NAME}"
log "  INSTALL_DIR=${INSTALL_DIR}"
log "  DATA_DIR=${DATA_DIR}"
log "  REMOVE_INSTALL_DIR=${REMOVE_INSTALL_DIR}"
log "  REMOVE_DATA=${REMOVE_DATA}"
log "  REMOVE_SYSTEM_ACCOUNT=${REMOVE_SYSTEM_ACCOUNT}"

cd /

remove_service
remove_install_dir_if_requested
remove_data_dir_if_requested
remove_service_account_if_requested

echo
echo "============================================================"
echo "command-runner uninstall completed."
echo "Service: ${SERVICE_NAME}.service removed (if present)."
if [[ "${REMOVE_INSTALL_DIR}" == "1" ]]; then
  echo "Install directory removed: ${INSTALL_DIR}"
else
  echo "Install directory kept: ${INSTALL_DIR}"
fi
if [[ "${REMOVE_DATA}" == "1" ]]; then
  echo "Data directory removed: ${DATA_DIR}"
else
  echo "Data directory kept: ${DATA_DIR}"
fi
if [[ "${REMOVE_SYSTEM_ACCOUNT}" == "1" ]]; then
  echo "Service account removal requested: ${APP_USER}:${APP_GROUP}"
else
  echo "Service account kept: ${APP_USER}:${APP_GROUP}"
fi
echo "============================================================"
