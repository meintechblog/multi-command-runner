"""
multi-command-runner

- Multiple runners (add/collapse), each: name, command, cases, logging toggle, scheduler.
- Scheduler: if interval>0, reruns interval seconds AFTER finishing; run count 1..100 or infinite.
- Live output via SSE per runner.
- Stop cancels the scheduler (even if currently waiting) and kills a running process group.
- Cases: regex per output line; each match sends Pushover (only if token+user key are set).
- Fallback: if any case has empty pattern AND empty message_template => on finish send last non-empty line.
- Persistent config in SQLite (data/app.db)
- Per-runner log file: data/run_<runner_id>.log (enabled by checkbox)
- Log file endpoint: /api/log/<runner_id> (opens in new tab)
- Pushover test endpoint.

Security warning: running arbitrary shell commands from a web UI is dangerous.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import queue
import re
import base64
import binascii
import hashlib
import hmac
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, ValidationError, field_validator


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data"))).resolve()
DB_PATH = DATA_DIR / "app.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MASKED_SECRET = "__SECRET_SET__"
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
MAX_IMPORT_BYTES = max(16_384, int(os.environ.get("MAX_IMPORT_BYTES", "1048576")))
MAX_IMPORTED_RUNNERS = max(1, int(os.environ.get("MAX_IMPORTED_RUNNERS", "100")))
MAX_TOTAL_RUNNERS = max(MAX_IMPORTED_RUNNERS, int(os.environ.get("MAX_TOTAL_RUNNERS", "500")))
MAX_CASES_PER_RUNNER = max(1, int(os.environ.get("MAX_CASES_PER_RUNNER", "200")))
MAX_SSE_SUBSCRIBERS = max(1, int(os.environ.get("MAX_SSE_SUBSCRIBERS", "100")))
MAX_OUTPUT_LINES_PER_RUN = max(200, int(os.environ.get("MAX_OUTPUT_LINES_PER_RUN", "5000")))

AUTH_USER = os.environ.get("MULTI_COMMAND_RUNNER_AUTH_USER", "").strip()
AUTH_PASSWORD = os.environ.get("MULTI_COMMAND_RUNNER_AUTH_PASSWORD", "").strip()
AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)
if (AUTH_USER and not AUTH_PASSWORD) or (AUTH_PASSWORD and not AUTH_USER):
    print("WARN: Incomplete auth config (MULTI_COMMAND_RUNNER_AUTH_USER/PASSWORD). Basic auth is disabled.")


def _valid_safe_id(value: str) -> bool:
    return bool(SAFE_ID_RE.fullmatch(str(value or "")))


def _sanitize_entity_id(value: Any, prefix: str) -> str:
    s = str(value or "").strip()
    if _valid_safe_id(s):
        return s
    return _new_id(prefix)


def _extract_basic_auth_credentials(request: Request) -> Optional[Tuple[str, str]]:
    header = request.headers.get("authorization", "")
    if not header.startswith("Basic "):
        return None
    token = header[6:].strip()
    if not token:
        return None
    try:
        decoded = base64.b64decode(token.encode("ascii"), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    username, password = decoded.split(":", 1)
    return username, password


def _is_authorized_request(request: Request) -> bool:
    if not AUTH_ENABLED:
        return True
    creds = _extract_basic_auth_credentials(request)
    if creds is None:
        return False
    username, password = creds
    return hmac.compare_digest(username, AUTH_USER) and hmac.compare_digest(password, AUTH_PASSWORD)


class CredentialCipher:
    """
    Encrypt/decrypt notification credentials at rest.
    - Key source priority:
      1) MULTI_COMMAND_RUNNER_SECRET_KEY env var
      2) DATA_DIR/.credentials.key (auto-created on first start)
    - Stored format: enc:v1:<fernet-token>
    """

    PREFIX = "enc:v1:"

    def __init__(self, data_dir: Path) -> None:
        self._fernet: Optional[Fernet] = None
        self._enabled = False
        self._source = "disabled"
        self._init_fernet(data_dir)

    @staticmethod
    def _build_fernet(secret: str) -> Fernet:
        # Accept either a valid Fernet key or an arbitrary passphrase.
        raw = secret.encode("utf-8")
        try:
            return Fernet(raw)
        except Exception:
            derived = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
            return Fernet(derived)

    def _init_fernet(self, data_dir: Path) -> None:
        env_secret = os.environ.get("MULTI_COMMAND_RUNNER_SECRET_KEY", "").strip()
        if env_secret:
            self._fernet = self._build_fernet(env_secret)
            self._enabled = True
            self._source = "env"
            return

        key_file = data_dir / ".credentials.key"
        try:
            if not key_file.exists():
                key_file.write_text(Fernet.generate_key().decode("ascii"), encoding="utf-8")
                try:
                    os.chmod(key_file, 0o600)
                except Exception:
                    pass

            file_secret = key_file.read_text(encoding="utf-8").strip()
            if not file_secret:
                return
            self._fernet = self._build_fernet(file_secret)
            self._enabled = True
            self._source = "file"
        except Exception as e:
            print(f"WARN: Could not initialize credential cipher: {e}")
            self._enabled = False
            self._source = "disabled"

    @property
    def enabled(self) -> bool:
        return self._enabled and self._fernet is not None

    @property
    def source(self) -> str:
        return self._source

    def encrypt(self, value: str) -> str:
        s = str(value or "")
        if not s:
            return ""
        if s.startswith(self.PREFIX):
            return s
        if not self.enabled:
            return s
        assert self._fernet is not None
        token = self._fernet.encrypt(s.encode("utf-8")).decode("ascii")
        return f"{self.PREFIX}{token}"

    def decrypt(self, value: str) -> str:
        s = str(value or "")
        if not s:
            return ""
        if not s.startswith(self.PREFIX):
            return s
        if not self.enabled:
            print("WARN: Encrypted credential found but cipher is disabled.")
            return ""
        assert self._fernet is not None
        token = s[len(self.PREFIX):]
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except InvalidToken:
            print("ERROR: Could not decrypt credential (invalid token).")
            return ""
        except Exception as e:
            print(f"ERROR: Could not decrypt credential: {e}")
            return ""


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex}"


def _next_clone_name(base_name: str, existing_names: Iterable[str], fallback: str) -> str:
    base = str(base_name or "").strip() or fallback
    existing = {str(name or "").strip().casefold() for name in existing_names}

    first = f"{base} (Kopie)"
    if first.casefold() not in existing:
        return first

    i = 2
    while True:
        candidate = f"{base} (Kopie {i})"
        if candidate.casefold() not in existing:
            return candidate
        i += 1


def _safe_runner_id(runner_id: str) -> str:
    rid = re.sub(r"[^a-zA-Z0-9_-]+", "_", runner_id).strip("_")
    return rid or "runner"


def runner_log_path(runner_id: str) -> Path:
    rid = _safe_runner_id(runner_id)
    return DATA_DIR / f"run_{rid}.log"


def ensure_runner_log_file(runner_id: str) -> Path:
    p = runner_log_path(runner_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.touch(exist_ok=True)
    return p


def ensure_logs_for_runners(runners: Iterable[Any]) -> None:
    for runner in runners:
        runner_id = ""
        if isinstance(runner, dict):
            runner_id = str(runner.get("id", "")).strip()
        else:
            runner_id = str(getattr(runner, "id", "")).strip()
        if runner_id:
            ensure_runner_log_file(runner_id)


RUNTIME_STATUS_PATH = DATA_DIR / "runtime_status.json"


def load_runtime_status() -> Dict[str, Dict[str, str]]:
    """Load persisted runtime status (last_case and last_case_ts) from JSON file."""
    if not RUNTIME_STATUS_PATH.exists():
        print(f"INFO: Runtime status file does not exist yet: {RUNTIME_STATUS_PATH}")
        return {}
    try:
        with open(RUNTIME_STATUS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"INFO: Loaded runtime status with {len(data)} entries")
            return data
    except Exception as e:
        print(f"ERROR loading runtime status from {RUNTIME_STATUS_PATH}: {e}")
        return {}


def save_runtime_status(status: Dict[str, Dict[str, str]]) -> None:
    """Save runtime status (last_case and last_case_ts) to JSON file."""
    try:
        with open(RUNTIME_STATUS_PATH, "w", encoding="utf-8") as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"ERROR saving runtime status to {RUNTIME_STATUS_PATH}: {e}")


DEFAULT_STATE: Dict[str, Any] = {
    "notify_profiles": [],
    "runners": [
        {
            "id": "runner1",
            "name": "Passwort-Check-Demo",
            "command": """\
if [ $((RANDOM % 2)) -eq 0 ]; then
  echo "passwort: beispielpasswort"
else
  echo "passwort nicht gefunden"
fi
""".strip(),
            "logging_enabled": True,
            "schedule": {"hours": 0, "minutes": 0, "seconds": 0},
            "max_runs": 1,
            "alert_cooldown_s": 300,
            "alert_escalation_s": 1800,
            "failure_pause_threshold": 5,
            "notify_profile_ids": [],
            "notify_profile_updates_only": [],
            "cases": [
                {"id": "case_pw", "pattern": r"passwort:\s*(?P<pw>\S+)", "message_template": "Passwort: {pw}", "state": ""},
                {"id": "case_nf", "pattern": r"passwort nicht gefunden", "message_template": "Passwort nicht gefunden", "state": ""},
            ],
        },
        {
            "id": "runner_ping_192_168_3_1",
            "name": "Ping 192.168.3.1 Demo",
            "command": "curl -sS --max-time 2 http://192.168.3.1 >/dev/null && echo OK || echo FAIL",
            "logging_enabled": True,
            "schedule": {"hours": 0, "minutes": 0, "seconds": 5},
            "max_runs": -1,
            "alert_cooldown_s": 300,
            "alert_escalation_s": 1800,
            "failure_pause_threshold": 5,
            "notify_profile_ids": [],
            "notify_profile_updates_only": [],
            "cases": [
                {"id": "case_ping_ok", "pattern": r"OK", "message_template": "192.168.3.1 ist erreichbar", "state": ""},
                {"id": "case_ping_fail", "pattern": r"FAIL", "message_template": "192.168.3.1 ist NICHT erreichbar", "state": ""},
            ],
        }
    ],
    "runner_groups": [],
    "runner_layout": [
        {"type": "runner", "id": "runner1"},
        {"type": "runner", "id": "runner_ping_192_168_3_1"},
    ],
}


class CaseRule(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("case_"))
    pattern: str = ""
    message_template: str = ""
    state: str = ""  # Optional semantic state like UP/DOWN/WARN/INFO

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _valid_safe_id(value):
            raise ValueError("Invalid case id format")
        return value


class ScheduleConfig(BaseModel):
    hours: int = 0
    minutes: int = 0
    seconds: int = 0


class PushoverConfig(BaseModel):
    user_key: str = ""
    api_token: str = ""


class NotifyProfile(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("notify_"))
    name: str = "Pushover"
    type: str = "pushover"  # Currently only "pushover"
    active: bool = True
    failure_count: int = 0
    sent_count: int = 0
    config: PushoverConfig = Field(default_factory=PushoverConfig)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _valid_safe_id(value):
            raise ValueError("Invalid notification profile id format")
        return value

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        t = str(value or "").strip().lower()
        if t != "pushover":
            raise ValueError("Unsupported notification profile type")
        return t


class RunnerConfig(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("runner_"))
    name: str = "Runner"
    command: str = ""
    logging_enabled: bool = True
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    max_runs: int = 1  # 1..100, -1 => infinite
    alert_cooldown_s: int = 300
    alert_escalation_s: int = 1800
    failure_pause_threshold: int = 5
    cases: List[CaseRule] = Field(default_factory=list)
    notify_profile_ids: List[str] = Field(default_factory=list)
    notify_profile_updates_only: List[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _valid_safe_id(value):
            raise ValueError("Invalid runner id format")
        return value

    @field_validator("notify_profile_ids", "notify_profile_updates_only")
    @classmethod
    def validate_notify_profile_ids(cls, values: List[str]) -> List[str]:
        cleaned: List[str] = []
        for value in values:
            s = str(value or "").strip()
            if not _valid_safe_id(s):
                raise ValueError("Invalid notification profile reference id")
            cleaned.append(s)
        return cleaned


class RunnerGroupConfig(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("group_"))
    name: str = "Group"
    runner_ids: List[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _valid_safe_id(value):
            raise ValueError("Invalid runner group id format")
        return value

    @field_validator("runner_ids")
    @classmethod
    def validate_runner_ids(cls, values: List[str]) -> List[str]:
        cleaned: List[str] = []
        for value in values:
            s = str(value or "").strip()
            if not _valid_safe_id(s):
                raise ValueError("Invalid runner reference id")
            cleaned.append(s)
        return cleaned


class RunnerLayoutItem(BaseModel):
    type: str = "runner"  # runner | group
    id: str = ""

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        t = str(value or "").strip().lower()
        if t not in {"runner", "group"}:
            raise ValueError("Invalid layout item type")
        return t

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid layout item id format")
        return s


class AppState(BaseModel):
    notify_profiles: List[NotifyProfile] = Field(default_factory=list)
    runners: List[RunnerConfig] = Field(default_factory=list)
    runner_groups: List[RunnerGroupConfig] = Field(default_factory=list)
    runner_layout: List[RunnerLayoutItem] = Field(default_factory=list)
    # Legacy fields for migration
    pushover_user_key: str = ""
    pushover_api_token: str = ""


class PushoverTestRequest(BaseModel):
    profile_id: str = ""
    message: str = ""

    @field_validator("profile_id")
    @classmethod
    def validate_profile_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if s and not _valid_safe_id(s):
            raise ValueError("Invalid profile id format")
        return s


class RunRequest(BaseModel):
    state: AppState
    runner_id: str

    @field_validator("runner_id")
    @classmethod
    def validate_runner_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid runner id format")
        return s


class StopRequest(BaseModel):
    runner_id: str

    @field_validator("runner_id")
    @classmethod
    def validate_runner_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid runner id format")
        return s


class GroupRunRequest(BaseModel):
    state: AppState
    group_id: str

    @field_validator("group_id")
    @classmethod
    def validate_group_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid group id format")
        return s


class GroupStopRequest(BaseModel):
    group_id: str

    @field_validator("group_id")
    @classmethod
    def validate_group_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid group id format")
        return s


class CloneRunnerRequest(BaseModel):
    runner_id: str

    @field_validator("runner_id")
    @classmethod
    def validate_runner_id(cls, value: str) -> str:
        s = str(value or "").strip()
        if not _valid_safe_id(s):
            raise ValueError("Invalid runner id format")
        return s


class StateStore:
    def __init__(self, db_path: Path) -> None:
        self._lock = threading.Lock()
        self._cipher = CredentialCipher(DATA_DIR)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)"
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notification_journal (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              runner_id TEXT NOT NULL,
              profile_id TEXT NOT NULL,
              profile_name TEXT NOT NULL,
              delivery TEXT NOT NULL,
              title TEXT NOT NULL,
              message TEXT NOT NULL,
              error TEXT
            )
            """
        )
        self._conn.commit()
        if self._cipher.enabled:
            print(f"INFO: Credential encryption enabled ({self._cipher.source}).")
        else:
            print("WARN: Credential encryption is disabled; credentials are stored as plain text.")
        if self._get_raw_json() is None:
            self.save(DEFAULT_STATE)
        self._migrate_encrypt_existing_credentials()

    def _get_raw_json(self) -> Optional[str]:
        cur = self._conn.execute("SELECT json FROM state WHERE id=1")
        row = cur.fetchone()
        return row[0] if row else None

    def _migrate_encrypt_existing_credentials(self) -> None:
        if not self._cipher.enabled:
            return
        with self._lock:
            raw = self._get_raw_json()
            if raw is None:
                return
            try:
                state = self._merge_defaults(json.loads(raw))
            except Exception:
                return

            changed = False
            for np in state.get("notify_profiles", []) or []:
                cfg = np.get("config") or {}
                for key in ("user_key", "api_token"):
                    val = str(cfg.get(key, "") or "")
                    if not val or val == MASKED_SECRET:
                        continue
                    if val.startswith(self._cipher.PREFIX):
                        continue
                    cfg[key] = self._cipher.encrypt(val)
                    changed = True
                np["config"] = cfg

            if changed:
                payload = json.dumps(state, ensure_ascii=False)
                self._conn.execute(
                    "INSERT INTO state (id, json) VALUES (1, ?) "
                    "ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                    (payload,),
                )
                self._conn.commit()
                print("INFO: Migrated plaintext notification credentials to encrypted storage.")

    def _decode_sensitive_inplace(self, state: Dict[str, Any]) -> Dict[str, Any]:
        for np in state.get("notify_profiles", []) or []:
            cfg = np.get("config") or {}
            cfg["user_key"] = self._cipher.decrypt(str(cfg.get("user_key", "") or ""))
            cfg["api_token"] = self._cipher.decrypt(str(cfg.get("api_token", "") or ""))
            np["config"] = cfg
        return state

    def _encode_sensitive_inplace(self, state: Dict[str, Any]) -> Dict[str, Any]:
        for np in state.get("notify_profiles", []) or []:
            cfg = np.get("config") or {}
            user_key = str(cfg.get("user_key", "") or "")
            api_token = str(cfg.get("api_token", "") or "")
            if user_key and user_key != MASKED_SECRET:
                cfg["user_key"] = self._cipher.encrypt(user_key)
            if api_token and api_token != MASKED_SECRET:
                cfg["api_token"] = self._cipher.encrypt(api_token)
            np["config"] = cfg
        return state

    @staticmethod
    def _mask_sensitive_for_client(state: Dict[str, Any]) -> Dict[str, Any]:
        client_state = json.loads(json.dumps(state, ensure_ascii=False))
        for np in client_state.get("notify_profiles", []) or []:
            cfg = np.get("config") or {}
            cfg["user_key"] = MASKED_SECRET if str(cfg.get("user_key", "") or "") else ""
            cfg["api_token"] = MASKED_SECRET if str(cfg.get("api_token", "") or "") else ""
            np["config"] = cfg
        return client_state

    @staticmethod
    def _resolve_masked_profile_secrets(
        incoming_state: Dict[str, Any],
        existing_state: Dict[str, Any],
    ) -> Dict[str, Any]:
        prev_by_id: Dict[str, Dict[str, Any]] = {}
        for np in existing_state.get("notify_profiles", []) or []:
            prev_by_id[str(np.get("id", ""))] = np

        for np in incoming_state.get("notify_profiles", []) or []:
            npid = str(np.get("id", ""))
            cfg = np.get("config") or {}
            prev_cfg = (prev_by_id.get(npid) or {}).get("config") or {}
            for key in ("user_key", "api_token"):
                val = str(cfg.get(key, "") or "")
                if val == MASKED_SECRET:
                    cfg[key] = str(prev_cfg.get(key, "") or "")
            np["config"] = cfg
        return incoming_state

    def _load_unlocked(self, *, mask_for_client: bool = False) -> Dict[str, Any]:
        raw = self._get_raw_json()
        if raw is None:
            # Avoid deadlock by performing direct insert here instead of calling self.save()
            base = self._merge_defaults(dict(DEFAULT_STATE))
            to_store = self._encode_sensitive_inplace(json.loads(json.dumps(base, ensure_ascii=False)))
            payload = json.dumps(to_store, ensure_ascii=False)
            self._conn.execute(
                "INSERT INTO state (id, json) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                (payload,),
            )
            self._conn.commit()
            loaded = base
        else:
            try:
                loaded = self._merge_defaults(json.loads(raw))
            except json.JSONDecodeError:
                loaded = self._merge_defaults(dict(DEFAULT_STATE))

        self._decode_sensitive_inplace(loaded)
        if mask_for_client:
            return self._mask_sensitive_for_client(loaded)
        return loaded

    def load(self) -> Dict[str, Any]:
        with self._lock:
            return self._load_unlocked(mask_for_client=False)

    def load_for_client(self) -> Dict[str, Any]:
        with self._lock:
            return self._load_unlocked(mask_for_client=True)

    def save(self, state: Dict[str, Any]) -> None:
        with self._lock:
            incoming = self._merge_defaults(json.loads(json.dumps(state, ensure_ascii=False)))

            existing = self._load_unlocked(mask_for_client=False)
            self._resolve_masked_profile_secrets(incoming, existing)
            self._encode_sensitive_inplace(incoming)

            payload = json.dumps(incoming, ensure_ascii=False)
            self._conn.execute(
                "INSERT INTO state (id, json) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                (payload,),
            )
            self._conn.commit()

    def get_notify_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._load_unlocked(mask_for_client=False)

            for profile in data.get("notify_profiles", []):
                if profile.get("id") == profile_id:
                    return dict(profile)
        return None

    def append_notification_journal(
        self,
        *,
        ts: str,
        runner_id: str,
        profile_id: str,
        profile_name: str,
        delivery: str,
        title: str,
        message: str,
        error: str = "",
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO notification_journal
                (ts, runner_id, profile_id, profile_name, delivery, title, message, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ts,
                    runner_id,
                    profile_id,
                    profile_name,
                    delivery,
                    title,
                    message,
                    error,
                ),
            )
            # Keep journal bounded
            self._conn.execute(
                """
                DELETE FROM notification_journal
                WHERE id NOT IN (
                  SELECT id FROM notification_journal ORDER BY id DESC LIMIT 5000
                )
                """
            )
            self._conn.commit()

    def list_notification_journal(
        self,
        *,
        limit: int = 200,
        runner_id: str = "",
        profile_id: str = "",
        delivery: str = "",
    ) -> List[Dict[str, Any]]:
        lim = max(1, min(1000, int(limit)))
        conditions: List[str] = []
        params: List[Any] = []
        if runner_id.strip():
            conditions.append("runner_id = ?")
            params.append(runner_id.strip())
        if profile_id.strip():
            conditions.append("profile_id = ?")
            params.append(profile_id.strip())
        if delivery.strip():
            conditions.append("delivery = ?")
            params.append(delivery.strip())

        where_sql = ""
        if conditions:
            where_sql = "WHERE " + " AND ".join(conditions)

        with self._lock:
            cur = self._conn.execute(
                f"""
                SELECT ts, runner_id, profile_id, profile_name, delivery, title, message, COALESCE(error, '')
                FROM notification_journal
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params + [lim]),
            )
            rows = cur.fetchall()

        result: List[Dict[str, Any]] = []
        for row in rows:
            result.append(
                {
                    "ts": row[0],
                    "runner_id": row[1],
                    "profile_id": row[2],
                    "profile_name": row[3],
                    "delivery": row[4],
                    "title": row[5],
                    "message": row[6],
                    "error": row[7],
                }
            )
        return result

    def clear_notification_journal(self) -> int:
        with self._lock:
            cur = self._conn.execute("DELETE FROM notification_journal")
            self._conn.commit()
            return int(cur.rowcount or 0)

    def record_notify_delivery_result(
        self,
        profile_id: str,
        *,
        success: bool,
        failure_threshold: int = 3,
    ) -> Dict[str, Any]:
        """
        Update per-profile consecutive delivery failures.
        - success=True  => reset failure_count to 0
        - success=False => increment failure_count, auto-disable when threshold reached
        """
        with self._lock:
            raw = self._get_raw_json()
            if raw is None:
                data = self._merge_defaults(dict(DEFAULT_STATE))
            else:
                try:
                    data = self._merge_defaults(json.loads(raw))
                except json.JSONDecodeError:
                    data = self._merge_defaults(dict(DEFAULT_STATE))

            profile = next((p for p in data.get("notify_profiles", []) if p.get("id") == profile_id), None)
            if profile is None:
                return {"found": False}

            profile["active"] = bool(profile.get("active", True))
            try:
                profile["failure_count"] = max(0, int(profile.get("failure_count", 0)))
            except Exception:
                profile["failure_count"] = 0
            try:
                profile["sent_count"] = max(0, int(profile.get("sent_count", 0)))
            except Exception:
                profile["sent_count"] = 0

            changed = False
            auto_disabled = False

            if success:
                profile["sent_count"] += 1
                changed = True
                if profile["failure_count"] != 0:
                    profile["failure_count"] = 0
                    changed = True
            else:
                profile["failure_count"] += 1
                changed = True
                if profile["active"] and profile["failure_count"] >= max(1, int(failure_threshold)):
                    profile["active"] = False
                    auto_disabled = True

            if changed:
                payload = json.dumps(self._merge_defaults(data), ensure_ascii=False)
                self._conn.execute(
                    "INSERT INTO state (id, json) VALUES (1, ?) "
                    "ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                    (payload,),
                )
                self._conn.commit()

            return {
                "found": True,
                "profile_id": profile.get("id", profile_id),
                "profile_name": profile.get("name", profile_id),
                "active": bool(profile.get("active", True)),
                "failure_count": int(profile.get("failure_count", 0)),
                "sent_count": int(profile.get("sent_count", 0)),
                "auto_disabled": auto_disabled,
            }

    @staticmethod
    def _merge_defaults(data: Dict[str, Any]) -> Dict[str, Any]:
        merged = json.loads(json.dumps(DEFAULT_STATE, ensure_ascii=False))
        merged.update({k: v for k, v in data.items() if v is not None})

        # Migration: Convert legacy global Pushover keys to default profile
        if (merged.get("pushover_user_key") or merged.get("pushover_api_token")) and not merged.get("notify_profiles"):
            default_profile = {
                "id": "notify_default",
                "name": "Pushover (Standard)",
                "type": "pushover",
                "config": {
                    "user_key": merged.get("pushover_user_key", ""),
                    "api_token": merged.get("pushover_api_token", ""),
                },
            }
            merged["notify_profiles"] = [default_profile]
            # Assign to all runners that don't have profiles yet
            for r in merged.get("runners", []):
                if not r.get("notify_profile_ids"):
                    r["notify_profile_ids"] = ["notify_default"]

        notify_profiles = merged.get("notify_profiles") or []
        if not isinstance(notify_profiles, list):
            notify_profiles = []
        sane_notify_profiles: List[Dict[str, Any]] = []
        seen_notify_ids: set[str] = set()
        for np in notify_profiles:
            if not isinstance(np, dict):
                continue
            npid = _sanitize_entity_id(np.get("id", ""), "notify_")
            while npid in seen_notify_ids:
                npid = _new_id("notify_")
            seen_notify_ids.add(npid)

            sane_np = dict(np)
            sane_np["id"] = npid
            sane_np.setdefault("name", "Pushover")
            sane_np["type"] = "pushover"
            sane_np.setdefault("active", True)
            sane_np.setdefault("failure_count", 0)
            sane_np.setdefault("sent_count", 0)
            sane_np["active"] = bool(sane_np.get("active", True))
            try:
                sane_np["failure_count"] = max(0, int(sane_np.get("failure_count", 0)))
            except Exception:
                sane_np["failure_count"] = 0
            try:
                sane_np["sent_count"] = max(0, int(sane_np.get("sent_count", 0)))
            except Exception:
                sane_np["sent_count"] = 0
            sane_np.pop("snoozed_until", None)
            sane_np.setdefault("config", {"user_key": "", "api_token": ""})
            if not isinstance(sane_np["config"], dict):
                sane_np["config"] = {"user_key": "", "api_token": ""}
            sane_np["config"]["user_key"] = str(sane_np["config"].get("user_key", "") or "")
            sane_np["config"]["api_token"] = str(sane_np["config"].get("api_token", "") or "")
            sane_notify_profiles.append(sane_np)
        merged["notify_profiles"] = sane_notify_profiles

        runners = merged.get("runners") or []
        if not isinstance(runners, list):
            runners = []
        sane_runners: List[Dict[str, Any]] = []
        seen_runner_ids: set[str] = set()
        for r in runners:
            if not isinstance(r, dict):
                continue
            rid = _sanitize_entity_id(r.get("id", ""), "runner_")
            while rid in seen_runner_ids:
                rid = _new_id("runner_")
            seen_runner_ids.add(rid)

            sane_runner = dict(r)
            sane_runner["id"] = rid
            sane_runner.setdefault("name", "Runner")
            sane_runner.setdefault("command", "")
            sane_runner.setdefault("logging_enabled", True)
            sane_runner.setdefault("schedule", {"hours": 0, "minutes": 0, "seconds": 0})
            sane_runner.setdefault("max_runs", 1)
            sane_runner.setdefault("alert_cooldown_s", 300)
            sane_runner.setdefault("alert_escalation_s", 1800)
            sane_runner.setdefault("failure_pause_threshold", 5)
            sane_runner.setdefault("cases", [])
            sane_runner.setdefault("notify_profile_ids", [])
            sane_runner.setdefault("notify_profile_updates_only", [])
            try:
                sane_runner["alert_cooldown_s"] = max(0, int(sane_runner.get("alert_cooldown_s", 300)))
            except Exception:
                sane_runner["alert_cooldown_s"] = 300
            try:
                sane_runner["alert_escalation_s"] = max(0, int(sane_runner.get("alert_escalation_s", 1800)))
            except Exception:
                sane_runner["alert_escalation_s"] = 1800
            try:
                sane_runner["failure_pause_threshold"] = max(0, int(sane_runner.get("failure_pause_threshold", 5)))
            except Exception:
                sane_runner["failure_pause_threshold"] = 5
            sane_runner.pop("snoozed_until", None)
            sane_runner["notify_profile_ids"] = [
                str(v).strip()
                for v in (sane_runner.get("notify_profile_ids") or [])
                if _valid_safe_id(str(v).strip())
            ]
            sane_runner["notify_profile_updates_only"] = [
                str(v).strip()
                for v in (sane_runner.get("notify_profile_updates_only") or [])
                if _valid_safe_id(str(v).strip())
            ]

            raw_cases = sane_runner.get("cases", []) or []
            if not isinstance(raw_cases, list):
                raw_cases = []
            sane_cases: List[Dict[str, Any]] = []
            seen_case_ids: set[str] = set()
            for c in raw_cases:
                if not isinstance(c, dict):
                    continue
                cid = _sanitize_entity_id(c.get("id", ""), "case_")
                while cid in seen_case_ids:
                    cid = _new_id("case_")
                seen_case_ids.add(cid)
                sane_case = dict(c)
                sane_case["id"] = cid
                sane_case["pattern"] = str(sane_case.get("pattern", "") or "")
                sane_case["message_template"] = str(sane_case.get("message_template", "") or "")
                sane_case.setdefault("state", "")
                sane_case["state"] = normalize_case_state(sane_case.get("state", ""))
                sane_cases.append(sane_case)
            sane_runner["cases"] = sane_cases
            sane_runners.append(sane_runner)

        valid_notify_ids = {np.get("id") for np in sane_notify_profiles if _valid_safe_id(str(np.get("id", "")))}
        for r in sane_runners:
            r["notify_profile_ids"] = [
                pid for pid in dict.fromkeys(r.get("notify_profile_ids", [])) if pid in valid_notify_ids
            ]
            r["notify_profile_updates_only"] = [
                pid for pid in dict.fromkeys(r.get("notify_profile_updates_only", [])) if pid in r["notify_profile_ids"]
            ]
        merged["runners"] = sane_runners

        valid_runner_ids = {r["id"] for r in sane_runners}

        raw_groups = merged.get("runner_groups") or []
        if not isinstance(raw_groups, list):
            raw_groups = []
        sane_groups: List[Dict[str, Any]] = []
        seen_group_ids: set[str] = set()
        assigned_runner_ids: set[str] = set()
        for group in raw_groups:
            if not isinstance(group, dict):
                continue
            gid = _sanitize_entity_id(group.get("id", ""), "group_")
            while gid in seen_group_ids:
                gid = _new_id("group_")
            seen_group_ids.add(gid)

            runner_ids: List[str] = []
            for raw_runner_id in (group.get("runner_ids") or []):
                rid = str(raw_runner_id or "").strip()
                if not _valid_safe_id(rid):
                    continue
                if rid not in valid_runner_ids:
                    continue
                if rid in assigned_runner_ids:
                    continue
                if rid in runner_ids:
                    continue
                runner_ids.append(rid)
                assigned_runner_ids.add(rid)

            sane_groups.append(
                {
                    "id": gid,
                    "name": str(group.get("name", "Group") or "Group"),
                    "runner_ids": runner_ids,
                }
            )
        merged["runner_groups"] = sane_groups

        grouped_runner_ids: set[str] = set()
        for group in sane_groups:
            for rid in group.get("runner_ids", []):
                grouped_runner_ids.add(rid)

        raw_layout = merged.get("runner_layout")
        sane_layout: List[Dict[str, str]] = []
        seen_layout_runners: set[str] = set()
        seen_layout_groups: set[str] = set()
        valid_group_ids = {g["id"] for g in sane_groups}
        if isinstance(raw_layout, list):
            for item in raw_layout:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get("type", "") or "").strip().lower()
                item_id = str(item.get("id", "") or "").strip()
                if item_type == "runner":
                    if item_id not in valid_runner_ids:
                        continue
                    if item_id in grouped_runner_ids:
                        continue
                    if item_id in seen_layout_runners:
                        continue
                    seen_layout_runners.add(item_id)
                    sane_layout.append({"type": "runner", "id": item_id})
                elif item_type == "group":
                    if item_id not in valid_group_ids:
                        continue
                    if item_id in seen_layout_groups:
                        continue
                    seen_layout_groups.add(item_id)
                    sane_layout.append({"type": "group", "id": item_id})

        for r in sane_runners:
            rid = r["id"]
            if rid in grouped_runner_ids or rid in seen_layout_runners:
                continue
            sane_layout.append({"type": "runner", "id": rid})
            seen_layout_runners.add(rid)

        for g in sane_groups:
            gid = g["id"]
            if gid in seen_layout_groups:
                continue
            sane_layout.append({"type": "group", "id": gid})
            seen_layout_groups.add(gid)

        merged["runner_layout"] = sane_layout
        return merged


class EventBroker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: Dict[str, queue.Queue] = {}
        self._max_subscribers = MAX_SSE_SUBSCRIBERS

    def subscribe(self) -> Tuple[str, queue.Queue]:
        sub_id = uuid.uuid4().hex
        q: queue.Queue = queue.Queue(maxsize=7000)
        with self._lock:
            if len(self._subs) >= self._max_subscribers:
                raise RuntimeError("Too many connected event-stream clients")
            self._subs[sub_id] = q
        return sub_id, q

    def unsubscribe(self, sub_id: str) -> None:
        with self._lock:
            self._subs.pop(sub_id, None)

    def publish(self, event: Dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subs.values())
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def normalize_case_state(value: str) -> str:
    s = (value or "").strip().upper()
    if s in {"UP", "DOWN", "WARN", "INFO"}:
        return s
    return ""


def append_run_log_file(log_file: Path, runner_name: str, command: str, exit_code: Optional[int], output: str, stopped: bool) -> None:
    ts = now_iso()
    header = [
        "",
        "=" * 80,
        f"timestamp: {ts}",
        f"runner: {runner_name}",
        f"command: {command}",
        f"exit_code: {exit_code}",
        f"stopped: {stopped}",
        "-" * 80,
    ]
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as f:
        f.write("\n".join(header) + "\n")
        f.write(output)
        if not output.endswith("\n"):
            f.write("\n")


def _clamp_pushover_message(msg: str) -> str:
    msg = msg.strip()
    return msg[:1024] if len(msg) > 1024 else msg


def send_pushover_checked(user_key: str, api_token: str, message: str, title: str) -> Dict[str, Any]:
    if not user_key.strip() or not api_token.strip():
        raise ValueError("Missing pushover_user_key or pushover_api_token")
    message = _clamp_pushover_message(message)
    if not message:
        raise ValueError("Empty message")

    payload = urllib.parse.urlencode(
        {"token": api_token.strip(), "user": user_key.strip(), "message": message, "title": title}
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://api.pushover.net/1/messages.json",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"raw": body}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"HTTP {e.code}: {body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: {e}") from e


def render_template_message(template: str, m: re.Match) -> str:
    mapping: Dict[str, Any] = {"match": m.group(0)}
    for i, g in enumerate(m.groups(), start=1):
        mapping[f"g{i}"] = g
    mapping.update(m.groupdict())
    try:
        return template.format_map(mapping)
    except Exception:
        return template


@dataclass(frozen=True)
class CompiledCase:
    pattern: str
    regex: re.Pattern
    message_template: str
    state: str  # UP/DOWN/WARN/INFO or ""


@dataclass(frozen=True)
class NotifyTarget:
    profile_id: str
    profile_name: str
    only_updates: bool
    active: bool
    user_key: str
    api_token: str


@dataclass(frozen=True)
class RunnerRuntimeConfig:
    runner_id: str
    runner_name: str
    command: str
    logging_enabled: bool
    interval_s: int
    max_runs: int  # -1 => infinite
    alert_cooldown_s: int
    alert_escalation_s: int
    failure_pause_threshold: int
    send_last_line_on_finish: bool
    cases: List[CompiledCase]
    notify_targets: List[NotifyTarget]


class NotificationWorker:
    def __init__(self, broker: EventBroker, store: StateStore) -> None:
        self._broker = broker
        self._store = store
        self._q: queue.Queue = queue.Queue(maxsize=7000)
        self._last_sent_message: Dict[Tuple[str, str], str] = {}
        threading.Thread(target=self._run, daemon=True).start()

    def enqueue(self, *, targets: List[NotifyTarget], message: str, title: str, runner_id: str, pattern: str) -> None:
        for target in targets:
            if not target.active:
                continue
            # If not fully configured, do not trigger and do not error.
            if not (target.user_key.strip() and target.api_token.strip()):
                continue
            try:
                self._q.put_nowait((target.profile_id, target.profile_name, bool(target.only_updates), message, title, runner_id, pattern))
            except queue.Full:
                self._broker.publish(
                    {"type": "case_error", "runner_id": runner_id, "pattern": pattern, "error": "Notification queue full (dropped)."}
                )

    def _run(self) -> None:
        while True:
            profile_id, profile_name, only_updates, message, title, runner_id, pattern = self._q.get()

            profile = self._store.get_notify_profile(profile_id)
            if not profile:
                continue
            if not bool(profile.get("active", True)):
                continue
            if profile.get("type") != "pushover":
                continue
            config = profile.get("config", {}) or {}
            user_key = str(config.get("user_key", ""))
            api_token = str(config.get("api_token", ""))
            if not (user_key.strip() and api_token.strip()):
                continue

            dedupe_key = (runner_id, profile_id)
            if only_updates and self._last_sent_message.get(dedupe_key, "") == message:
                continue

            ts = now_iso()
            try:
                send_pushover_checked(user_key, api_token, message, title=title)
                self._last_sent_message[dedupe_key] = message
                result = self._store.record_notify_delivery_result(profile_id, success=True)
                self._store.append_notification_journal(
                    ts=ts,
                    runner_id=runner_id,
                    profile_id=profile_id,
                    profile_name=result.get("profile_name", profile_name),
                    delivery="success",
                    title=title,
                    message=message,
                    error="",
                )
                if result.get("found"):
                    self._broker.publish(
                        {
                            "type": "notify_profile_status",
                            "runner_id": runner_id,
                            "profile_id": profile_id,
                            "profile_name": result.get("profile_name", profile_name),
                            "active": result.get("active", True),
                            "failure_count": result.get("failure_count", 0),
                            "sent_count": result.get("sent_count", 0),
                            "delivery": "success",
                            "title": title,
                            "message": message,
                            "ts": ts,
                        }
                    )
            except Exception as e:
                err = str(e)
                result = self._store.record_notify_delivery_result(profile_id, success=False, failure_threshold=3)
                self._store.append_notification_journal(
                    ts=ts,
                    runner_id=runner_id,
                    profile_id=profile_id,
                    profile_name=result.get("profile_name", profile_name),
                    delivery="error",
                    title=title,
                    message=message,
                    error=err,
                )
                if result.get("found"):
                    self._broker.publish(
                        {
                            "type": "notify_profile_status",
                            "runner_id": runner_id,
                            "profile_id": profile_id,
                            "profile_name": result.get("profile_name", profile_name),
                            "active": result.get("active", True),
                            "failure_count": result.get("failure_count", 0),
                            "sent_count": result.get("sent_count", 0),
                            "delivery": "error",
                            "reason": err,
                            "auto_disabled": bool(result.get("auto_disabled", False)),
                            "title": title,
                            "message": message,
                            "ts": ts,
                        }
                    )
                self._broker.publish(
                    {"type": "case_error", "runner_id": runner_id, "pattern": pattern, "error": f"Pushover failed: {err}"}
                )
                if result.get("auto_disabled"):
                    self._broker.publish(
                        {
                            "type": "notify_profile_auto_disabled",
                            "profile_id": profile_id,
                            "profile_name": profile_name,
                            "failure_count": result.get("failure_count", 3),
                            "sent_count": result.get("sent_count", 0),
                            "reason": err,
                            "ts": ts,
                        }
                    )


class RunnerManager:
    def __init__(self, broker: EventBroker, notifier: NotificationWorker) -> None:
        self._broker = broker
        self._notifier = notifier
        self._lock = threading.Lock()
        self._procs: Dict[str, subprocess.Popen] = {}
        self._started_ts: Dict[str, str] = {}
        self._active_ts: Dict[str, str] = {}
        self._outputs: Dict[str, List[str]] = {}
        self._last_line: Dict[str, str] = {}
        self._stopped: Dict[str, bool] = {}
        self._timers: Dict[str, threading.Timer] = {}
        self._remaining: Dict[str, Optional[int]] = {}
        self._run_count: Dict[str, int] = {}  # Track run count for infinite runners
        self._cfg: Dict[str, RunnerRuntimeConfig] = {}
        self._last_case: Dict[str, str] = {}
        self._last_case_ts: Dict[str, str] = {}
        self._alert_state: Dict[str, str] = {}
        self._last_alert_notify_ts: Dict[str, float] = {}
        self._consecutive_failures: Dict[str, int] = {}
        self._paused_due_failures: Dict[str, bool] = {}
        self._last_exit_code: Dict[str, int] = {}
        self._last_finish_ts: Dict[str, str] = {}
        self._max_output_lines = MAX_OUTPUT_LINES_PER_RUN

        # Load persisted runtime status
        runtime_status = load_runtime_status()
        for runner_id, data in runtime_status.items():
            self._last_case[runner_id] = data.get("last_case", "")
            self._last_case_ts[runner_id] = data.get("last_case_ts", "")

    def _append_output_line_locked(self, runner_id: str, line: str) -> None:
        lines = self._outputs.setdefault(runner_id, [])
        lines.append(line)
        overflow = len(lines) - self._max_output_lines
        if overflow > 0:
            del lines[:overflow]

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            snap: Dict[str, Any] = {}
            rids = (
                set(self._cfg.keys())
                | set(self._outputs.keys())
                | set(self._procs.keys())
                | set(self._started_ts.keys())
                | set(self._active_ts.keys())
                | set(self._timers.keys())
                | set(self._consecutive_failures.keys())
                | set(self._paused_due_failures.keys())
                | set(self._last_exit_code.keys())
                | set(self._last_finish_ts.keys())
            )
            for rid in rids:
                proc = self._procs.get(rid)
                running = proc is not None and proc.poll() is None
                snap[rid] = {
                    "running": running,
                    "stopped": bool(self._stopped.get(rid, False)),
                    "started_ts": self._started_ts.get(rid, ""),
                    "active_ts": self._active_ts.get(rid, ""),
                    "tail": "".join((self._outputs.get(rid) or [])[-200:]),
                    "remaining": self._remaining.get(rid),
                    "run_count": self._run_count.get(rid, 0),  # Current run count for infinite runners
                    "scheduled": rid in self._timers,
                    "last_case": self._last_case.get(rid, ""),
                    "last_case_ts": self._last_case_ts.get(rid, ""),
                    "consecutive_failures": int(self._consecutive_failures.get(rid, 0)),
                    "paused": bool(self._paused_due_failures.get(rid, False)),
                    "last_exit_code": self._last_exit_code.get(rid),
                    "last_finish_ts": self._last_finish_ts.get(rid, ""),
                }
            return snap

    def get_runner_status(self, runner_id: str) -> Dict[str, Any]:
        return self.snapshot().get(runner_id, {})

    def refresh_runtime_configs(self, state: AppState) -> None:
        """
        Re-compile and apply runtime configs for currently managed runners.
        This lets scheduler/running runners pick up changed notification options
        without manual restart.
        """
        with self._lock:
            managed_ids = list(self._cfg.keys())

        if not managed_ids:
            return

        refreshed: Dict[str, RunnerRuntimeConfig] = {}
        for rid in managed_ids:
            try:
                refreshed[rid] = compile_runner_cfg(state, rid, self._broker)
            except HTTPException:
                # Runner may have been removed from state.
                continue
            except Exception as e:
                self._broker.publish(
                    {"type": "case_error", "runner_id": rid, "pattern": "__refresh__", "error": f"Config refresh failed: {e}"}
                )

        if not refreshed:
            return

        with self._lock:
            for rid, cfg in refreshed.items():
                self._cfg[rid] = cfg

    def _save_runtime_status(self) -> None:
        """Persist runtime status (last_case and last_case_ts) to disk."""
        with self._lock:
            status = {}
            for runner_id in set(self._last_case.keys()) | set(self._last_case_ts.keys()):
                status[runner_id] = {
                    "last_case": self._last_case.get(runner_id, ""),
                    "last_case_ts": self._last_case_ts.get(runner_id, ""),
                }
            save_runtime_status(status)

    def stop(self, runner_id: str) -> None:
        proc: Optional[subprocess.Popen]
        with self._lock:
            # cancel future runs even if currently waiting
            t = self._timers.pop(runner_id, None)
            if t:
                t.cancel()
            proc = self._procs.get(runner_id)
            self._stopped[runner_id] = True
            self._paused_due_failures[runner_id] = False
            # Reset run count so next manual start begins at 1
            self._run_count[runner_id] = 0

        self._broker.publish({"type": "status", "runner_id": runner_id, "status": "stopping", "ts": now_iso()})

        if proc is None or proc.poll() is not None:
            with self._lock:
                self._started_ts.pop(runner_id, None)
                self._active_ts.pop(runner_id, None)
            self._broker.publish({"type": "status", "runner_id": runner_id, "status": "stopped", "ts": now_iso()})
            return

        self._terminate_clean(proc)

    def start(self, cfg: RunnerRuntimeConfig, reset_schedule: bool = True) -> None:
        started_ts = ""
        active_ts = ""
        current_run_count = 0
        current_remaining: Optional[int] = None
        with self._lock:
            if reset_schedule:
                t = self._timers.pop(cfg.runner_id, None)
                if t:
                    t.cancel()

            proc = self._procs.get(cfg.runner_id)
            if proc is not None and proc.poll() is None:
                raise HTTPException(status_code=409, detail="Runner already running")

            self._cfg[cfg.runner_id] = cfg
            self._outputs[cfg.runner_id] = []
            self._last_line[cfg.runner_id] = ""
            self._stopped[cfg.runner_id] = False
            self._paused_due_failures[cfg.runner_id] = False

            if reset_schedule:
                self._remaining[cfg.runner_id] = None if cfg.max_runs == -1 else int(cfg.max_runs)
                # Reset run count when manually starting a runner
                self._run_count[cfg.runner_id] = 1
                self._consecutive_failures[cfg.runner_id] = 0
            else:
                # Increment run count for all runners (scheduled runs)
                self._run_count[cfg.runner_id] = self._run_count.get(cfg.runner_id, 0) + 1

            rem = self._remaining.get(cfg.runner_id)
            if rem is not None:
                if rem <= 0:
                    return
                self._remaining[cfg.runner_id] = rem - 1

            self._procs[cfg.runner_id] = subprocess.Popen(
                ["bash", "-lc", cfg.command],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                start_new_session=True,
            )

            started_ts = now_iso()
            self._started_ts[cfg.runner_id] = started_ts
            # Manual starts always begin a new "active" session.
            active_ts = started_ts
            self._active_ts[cfg.runner_id] = active_ts
            current_run_count = self._run_count.get(cfg.runner_id, 0)
            current_remaining = self._remaining.get(cfg.runner_id)

        self._broker.publish({"type": "status", "runner_id": cfg.runner_id, "status": "started", "ts": started_ts, "active_ts": active_ts, "run_count": current_run_count, "remaining": current_remaining})
        threading.Thread(target=self._reader_thread, args=(cfg.runner_id,), daemon=True).start()

    def _schedule_next(self, runner_id: str) -> bool:
        interval_s = 0
        with self._lock:
            cfg = self._cfg.get(runner_id)
            if cfg is None or cfg.interval_s <= 0:
                return False
            if self._stopped.get(runner_id, False):
                return False
            if self._paused_due_failures.get(runner_id, False):
                return False
            rem = self._remaining.get(runner_id)
            if rem is not None and rem <= 0:
                return False
            if runner_id in self._timers:
                return False
            interval_s = cfg.interval_s
            t = threading.Timer(cfg.interval_s, self._scheduled_start, args=(runner_id,))
            t.daemon = True
            self._timers[runner_id] = t
            t.start()
        self._broker.publish({"type": "status", "runner_id": runner_id, "status": "scheduled", "in_s": interval_s, "ts": now_iso()})
        return True

    def _scheduled_start(self, runner_id: str) -> None:
        started_ts = ""
        active_ts = ""
        current_run_count = 0
        current_remaining: Optional[int] = None
        with self._lock:
            self._timers.pop(runner_id, None)
            if self._stopped.get(runner_id, False):
                return
            if self._paused_due_failures.get(runner_id, False):
                return
            cfg = self._cfg.get(runner_id)
            if cfg is None:
                return
            rem = self._remaining.get(runner_id)
            if rem is not None:
                if rem <= 0:
                    return
                self._remaining[runner_id] = rem - 1
            # Increment run count for all runners
            self._run_count[runner_id] = self._run_count.get(runner_id, 0) + 1
            proc = self._procs.get(runner_id)
            if proc is not None and proc.poll() is None:
                return
            self._outputs[runner_id] = []
            self._last_line[runner_id] = ""
            self._stopped[runner_id] = False
            self._procs[runner_id] = subprocess.Popen(
                ["bash", "-lc", cfg.command],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                start_new_session=True,
            )
            current_run_count = self._run_count.get(runner_id, 0)
            current_remaining = self._remaining.get(runner_id)
            started_ts = now_iso()
            self._started_ts[runner_id] = started_ts
            # Scheduled runs should not reset the active session timestamp.
            active_ts = self._active_ts.get(runner_id) or started_ts
            self._active_ts.setdefault(runner_id, active_ts)

        self._broker.publish({"type": "status", "runner_id": runner_id, "status": "started", "ts": started_ts, "active_ts": active_ts, "run_count": current_run_count, "remaining": current_remaining})
        threading.Thread(target=self._reader_thread, args=(runner_id,), daemon=True).start()

    @staticmethod
    def _terminate_clean(proc: subprocess.Popen) -> None:
        for sig, wait_s in ((signal.SIGINT, 1.5), (signal.SIGTERM, 2.0), (signal.SIGKILL, 0.0)):
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                return
            if wait_s <= 0:
                return
            deadline = time.time() + wait_s
            while time.time() < deadline:
                if proc.poll() is not None:
                    return
                time.sleep(0.05)

    def _resolve_stateful_notification(self, cfg: RunnerRuntimeConfig, case_state: str, message: str) -> Optional[str]:
        state = normalize_case_state(case_state)
        if not state:
            return message

        now_ts = time.time()
        with self._lock:
            prev_state = self._alert_state.get(cfg.runner_id, "")
            last_notify_ts = float(self._last_alert_notify_ts.get(cfg.runner_id, 0.0))
            changed = state != prev_state

            if changed:
                self._alert_state[cfg.runner_id] = state
                self._last_alert_notify_ts[cfg.runner_id] = now_ts
                if prev_state in {"DOWN", "WARN"} and state == "UP":
                    return f"RECOVERY: {message}"
                return message

            # Unchanged state: only escalate unhealthy states.
            if state in {"DOWN", "WARN"}:
                cooldown_s = max(0, int(cfg.alert_cooldown_s))
                escalation_s = max(0, int(cfg.alert_escalation_s))
                elapsed = now_ts - last_notify_ts
                if elapsed < cooldown_s:
                    return None
                if escalation_s <= 0 or elapsed >= escalation_s:
                    self._last_alert_notify_ts[cfg.runner_id] = now_ts
                    return f"ESCALATION ({state}): {message}"
            return None

    def _reader_thread(self, runner_id: str) -> None:
        with self._lock:
            proc = self._procs.get(runner_id)
            start_cfg = self._cfg.get(runner_id)

        if proc is None or proc.stdout is None or start_cfg is None:
            return

        try:
            for line in proc.stdout:
                s = line.strip()
                with self._lock:
                    self._append_output_line_locked(runner_id, line)
                    if s:
                        self._last_line[runner_id] = s
                self._broker.publish({"type": "output", "runner_id": runner_id, "line": line})
                self._match_line_and_notify(runner_id, line)
        finally:
            exit_code = proc.wait()
            finished_ts = now_iso()
            with self._lock:
                output = "".join(self._outputs.get(runner_id) or [])
                stopped = bool(self._stopped.get(runner_id, False))
                last_line = self._last_line.get(runner_id, "")
                current_cfg = self._cfg.get(runner_id) or start_cfg
                self._procs.pop(runner_id, None)
                self._started_ts.pop(runner_id, None)
                self._last_exit_code[runner_id] = int(exit_code)
                self._last_finish_ts[runner_id] = finished_ts

            if current_cfg.logging_enabled:
                # Command in log header should reflect the command that was actually started.
                append_run_log_file(
                    runner_log_path(runner_id),
                    current_cfg.runner_name,
                    start_cfg.command,
                    exit_code,
                    output,
                    stopped,
                )

            # Empty case (pattern+template empty) triggers last-line notification at run end.
            if current_cfg.send_last_line_on_finish:
                msg = last_line if last_line else "(no output)"
                ts = now_iso()
                with self._lock:
                    self._last_case[runner_id] = msg
                    self._last_case_ts[runner_id] = ts

                self._save_runtime_status()
                self._broker.publish({"type": "case_match", "runner_id": runner_id, "pattern": "__on_finish__", "message": msg, "ts": ts})

                if current_cfg.notify_targets:
                    self._notifier.enqueue(
                        targets=current_cfg.notify_targets,
                        message=msg,
                        title=f"{current_cfg.runner_name} (last line)",
                        runner_id=runner_id,
                        pattern="__on_finish__",
                    )

            pause_now = False
            consecutive_failures = 0
            with self._lock:
                if not stopped:
                    if int(exit_code) == 0:
                        self._consecutive_failures[runner_id] = 0
                    else:
                        self._consecutive_failures[runner_id] = int(self._consecutive_failures.get(runner_id, 0)) + 1
                        threshold = max(0, int(current_cfg.failure_pause_threshold))
                        if threshold > 0 and self._consecutive_failures[runner_id] >= threshold:
                            self._paused_due_failures[runner_id] = True
                            self._stopped[runner_id] = True
                            t = self._timers.pop(runner_id, None)
                            if t:
                                t.cancel()
                            pause_now = True
                consecutive_failures = int(self._consecutive_failures.get(runner_id, 0))

            self._broker.publish(
                {
                    "type": "status",
                    "runner_id": runner_id,
                    "status": "finished",
                    "exit_code": exit_code,
                    "stopped": stopped,
                    "consecutive_failures": consecutive_failures,
                    "ts": finished_ts,
                }
            )
            if pause_now:
                with self._lock:
                    self._active_ts.pop(runner_id, None)
                self._broker.publish(
                    {
                        "type": "status",
                        "runner_id": runner_id,
                        "status": "paused",
                        "reason": "auto_pause_failures",
                        "consecutive_failures": consecutive_failures,
                        "threshold": int(current_cfg.failure_pause_threshold),
                        "ts": now_iso(),
                    }
                )
                return
            scheduled = self._schedule_next(runner_id)
            if not scheduled:
                with self._lock:
                    self._active_ts.pop(runner_id, None)

    def _match_line_and_notify(self, runner_id: str, line: str) -> None:
        with self._lock:
            cfg = self._cfg.get(runner_id)
        if cfg is None:
            return

        for c in cfg.cases:
            for m in c.regex.finditer(line):
                msg = render_template_message(c.message_template, m)
                ts = now_iso()
                with self._lock:
                    self._last_case[cfg.runner_id] = msg
                    self._last_case_ts[cfg.runner_id] = ts

                # Persist runtime status to disk
                self._save_runtime_status()

                # Always publish for UI
                self._broker.publish(
                    {
                        "type": "case_match",
                        "runner_id": cfg.runner_id,
                        "pattern": c.pattern,
                        "message": msg,
                        "state": c.state,
                        "ts": ts,
                    }
                )

                # Only notify if targets configured
                notify_message = self._resolve_stateful_notification(cfg, c.state, msg)
                if cfg.notify_targets and notify_message:
                    self._notifier.enqueue(
                        targets=cfg.notify_targets,
                        message=notify_message,
                        title=cfg.runner_name,
                        runner_id=cfg.runner_id,
                        pattern=c.pattern,
                    )


@dataclass
class GroupSequenceRuntime:
    group_id: str
    group_name: str
    runner_ids: List[str]
    started_ts: str
    stop_event: threading.Event
    thread: Optional[threading.Thread] = None
    current_runner_id: str = ""
    current_index: int = 0
    completed_count: int = 0


class GroupSequenceManager:
    def __init__(self, runner_manager: RunnerManager, broker: EventBroker) -> None:
        self._runner_manager = runner_manager
        self._broker = broker
        self._lock = threading.Lock()
        self._active: Dict[str, GroupSequenceRuntime] = {}
        self._snapshot: Dict[str, Dict[str, Any]] = {}

    def snapshot(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return json.loads(json.dumps(self._snapshot, ensure_ascii=False))

    def _publish_group_status(
        self,
        *,
        group_id: str,
        group_name: str,
        status: str,
        runner_ids: List[str],
        current_runner_id: str = "",
        current_index: int = 0,
        completed_count: int = 0,
        started_ts: str = "",
        finished_ts: str = "",
        error: str = "",
    ) -> None:
        event = {
            "type": "group_status",
            "group_id": group_id,
            "group_name": group_name,
            "status": status,
            "runner_ids": list(runner_ids),
            "current_runner_id": current_runner_id,
            "current_index": int(current_index),
            "completed_count": int(completed_count),
            "total_count": len(runner_ids),
            "started_ts": started_ts,
            "finished_ts": finished_ts,
            "error": error,
            "ts": now_iso(),
        }
        with self._lock:
            self._snapshot[group_id] = dict(event)
        self._broker.publish(event)

    def _get_group_for_run(self, state: AppState, group_id: str) -> Tuple[RunnerGroupConfig, List[str]]:
        return resolve_group_for_state(state, group_id)

    def start_group(self, state: AppState, group_id: str) -> None:
        group, runner_ids = self._get_group_for_run(state, group_id)
        with self._lock:
            if group_id in self._active:
                raise HTTPException(status_code=409, detail="Group sequence already running")

        runtime_snapshot = self._runner_manager.snapshot()
        busy = [
            rid
            for rid in runner_ids
            if bool((runtime_snapshot.get(rid) or {}).get("running"))
            or bool((runtime_snapshot.get(rid) or {}).get("scheduled"))
        ]
        if busy:
            raise HTTPException(
                status_code=409,
                detail=f"Group contains active/scheduled runners: {', '.join(busy)}",
            )

        run = GroupSequenceRuntime(
            group_id=group.id,
            group_name=group.name,
            runner_ids=runner_ids,
            started_ts=now_iso(),
            stop_event=threading.Event(),
        )
        run.thread = threading.Thread(target=self._run_group, args=(run, state), daemon=True)
        with self._lock:
            self._active[group.id] = run
        self._publish_group_status(
            group_id=run.group_id,
            group_name=run.group_name,
            status="started",
            runner_ids=run.runner_ids,
            current_runner_id="",
            current_index=0,
            completed_count=0,
            started_ts=run.started_ts,
        )
        assert run.thread is not None
        run.thread.start()

    def stop_group(self, group_id: str, runner_ids: List[str], group_name: str = "") -> None:
        runtime: Optional[GroupSequenceRuntime]
        with self._lock:
            runtime = self._active.get(group_id)
            if runtime is not None:
                runtime.stop_event.set()

        stop_runner_ids = list(runner_ids)
        if runtime is not None and not stop_runner_ids:
            stop_runner_ids = list(runtime.runner_ids)

        group_label = group_name or (runtime.group_name if runtime else group_id)
        if runtime is not None:
            self._publish_group_status(
                group_id=group_id,
                group_name=group_label,
                status="stopping",
                runner_ids=runtime.runner_ids,
                current_runner_id=runtime.current_runner_id,
                current_index=runtime.current_index,
                completed_count=runtime.completed_count,
                started_ts=runtime.started_ts,
            )

        for rid in stop_runner_ids:
            self._runner_manager.stop(rid)

        if runtime is None:
            self._publish_group_status(
                group_id=group_id,
                group_name=group_label,
                status="stopped",
                runner_ids=stop_runner_ids,
                current_runner_id="",
                current_index=0,
                completed_count=0,
                finished_ts=now_iso(),
            )

    def _finish_run(
        self,
        run: GroupSequenceRuntime,
        *,
        status: str,
        error: str = "",
    ) -> None:
        finished_ts = now_iso()
        self._publish_group_status(
            group_id=run.group_id,
            group_name=run.group_name,
            status=status,
            runner_ids=run.runner_ids,
            current_runner_id=run.current_runner_id,
            current_index=run.current_index,
            completed_count=run.completed_count,
            started_ts=run.started_ts,
            finished_ts=finished_ts,
            error=error,
        )
        with self._lock:
            current = self._active.get(run.group_id)
            if current is run:
                self._active.pop(run.group_id, None)

    def _run_group(self, run: GroupSequenceRuntime, state: AppState) -> None:
        try:
            for idx, runner_id in enumerate(run.runner_ids, start=1):
                if run.stop_event.is_set():
                    self._finish_run(run, status="stopped")
                    return

                run.current_runner_id = runner_id
                run.current_index = idx
                self._publish_group_status(
                    group_id=run.group_id,
                    group_name=run.group_name,
                    status="running",
                    runner_ids=run.runner_ids,
                    current_runner_id=run.current_runner_id,
                    current_index=run.current_index,
                    completed_count=run.completed_count,
                    started_ts=run.started_ts,
                )

                try:
                    cfg = compile_runner_cfg(state, runner_id, self._broker)
                    self._runner_manager.start(cfg, reset_schedule=True)
                except HTTPException as e:
                    self._finish_run(run, status="error", error=f"Could not start runner {runner_id}: {e.detail}")
                    return
                except Exception as e:
                    self._finish_run(run, status="error", error=f"Could not start runner {runner_id}: {e}")
                    return

                while True:
                    if run.stop_event.is_set():
                        self._runner_manager.stop(runner_id)
                        self._finish_run(run, status="stopped")
                        return
                    st = self._runner_manager.get_runner_status(runner_id)
                    if not bool(st.get("running")) and not bool(st.get("scheduled")):
                        break
                    time.sleep(0.2)

                st = self._runner_manager.get_runner_status(runner_id)
                run.completed_count = idx
                self._publish_group_status(
                    group_id=run.group_id,
                    group_name=run.group_name,
                    status="running",
                    runner_ids=run.runner_ids,
                    current_runner_id=run.current_runner_id,
                    current_index=run.current_index,
                    completed_count=run.completed_count,
                    started_ts=run.started_ts,
                )

                last_exit_code = st.get("last_exit_code")
                stopped = bool(st.get("stopped"))
                paused = bool(st.get("paused"))
                failed = paused or stopped or (last_exit_code is not None and int(last_exit_code) != 0)
                if failed:
                    if paused:
                        error = f"Runner {runner_id} paused"
                    elif stopped:
                        error = f"Runner {runner_id} stopped"
                    else:
                        error = f"Runner {runner_id} failed (exit={last_exit_code})"
                    self._finish_run(run, status="error", error=error)
                    return

            self._finish_run(run, status="finished")
        except Exception as e:
            self._finish_run(run, status="error", error=f"Group sequence crashed: {e}")


def compile_runner_cfg(state: AppState, runner_id: str, broker: EventBroker) -> RunnerRuntimeConfig:
    runner = next((r for r in state.runners if r.id == runner_id), None)
    if runner is None:
        raise HTTPException(status_code=404, detail="Runner not found")

    interval_s = max(
        0,
        int(runner.schedule.hours) * 3600
        + int(runner.schedule.minutes) * 60
        + int(runner.schedule.seconds),
    )

    send_last_line = any(
        (not (c.pattern or "").strip()) and (not (c.message_template or "").strip())
        for c in runner.cases
    )

    compiled: List[CompiledCase] = []
    for c in runner.cases:
        pattern = (c.pattern or "").strip()
        tmpl = (c.message_template or "").strip()
        case_state = normalize_case_state(getattr(c, "state", ""))
        if not pattern and not tmpl:
            continue
        if not pattern or not tmpl:
            continue
        try:
            rx = re.compile(pattern, flags=re.MULTILINE)
        except re.error as e:
            broker.publish({"type": "case_error", "runner_id": runner_id, "pattern": pattern, "error": f"Invalid regex: {e}"})
            continue
        compiled.append(CompiledCase(pattern=pattern, regex=rx, message_template=tmpl, state=case_state))

    max_runs = int(runner.max_runs)
    if max_runs != -1:
        max_runs = max(1, min(100, max_runs))

    # Resolve notify profiles
    notify_targets: List[NotifyTarget] = []
    updates_only_ids = set(runner.notify_profile_updates_only or [])
    for profile_id in runner.notify_profile_ids:
        profile = next((p for p in state.notify_profiles if p.id == profile_id), None)
        if profile and profile.type == "pushover":
            notify_targets.append(
                NotifyTarget(
                    profile_id=profile.id,
                    profile_name=profile.name,
                    only_updates=profile.id in updates_only_ids,
                    active=bool(profile.active),
                    user_key=profile.config.user_key,
                    api_token=profile.config.api_token,
                )
            )

    return RunnerRuntimeConfig(
        runner_id=runner.id,
        runner_name=(runner.name or runner.id).strip() or runner.id,
        command=runner.command,
        logging_enabled=bool(runner.logging_enabled),
        interval_s=interval_s,
        max_runs=max_runs,
        alert_cooldown_s=max(0, int(runner.alert_cooldown_s)),
        alert_escalation_s=max(0, int(runner.alert_escalation_s)),
        failure_pause_threshold=max(0, int(runner.failure_pause_threshold)),
        send_last_line_on_finish=send_last_line,
        cases=compiled,
        notify_targets=notify_targets,
    )


def resolve_group_for_state(state: AppState, group_id: str) -> Tuple[RunnerGroupConfig, List[str]]:
    group = next((g for g in state.runner_groups if g.id == group_id), None)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    valid_runner_ids = {r.id for r in state.runners}
    runner_ids = [rid for rid in group.runner_ids if rid in valid_runner_ids]
    if not runner_ids:
        raise HTTPException(status_code=400, detail="Group has no runners")
    return group, runner_ids


store = StateStore(DB_PATH)
ensure_logs_for_runners(store.load().get("runners", []))
broker = EventBroker()
notifier = NotificationWorker(broker, store)
rm = RunnerManager(broker, notifier)
gsm = GroupSequenceManager(rm, broker)

app = FastAPI(title="multi-command-runner", version="2.2.0")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

if AUTH_ENABLED:
    print("INFO: HTTP Basic auth is enabled.")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not AUTH_ENABLED:
        return await call_next(request)

    if request.url.path.startswith("/static/"):
        return await call_next(request)

    if _is_authorized_request(request):
        return await call_next(request)

    return JSONResponse(
        {"detail": "Unauthorized"},
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="multi-command-runner"'},
    )


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    app_js = BASE_DIR / "static" / "app.js"
    style_css = BASE_DIR / "static" / "style.css"
    asset_version = int(max(app_js.stat().st_mtime, style_css.stat().st_mtime))
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "asset_version": asset_version,
            "app_version": app.version,
        },
    )


@app.get("/api/state", response_class=JSONResponse)
def get_state() -> JSONResponse:
    return JSONResponse(store.load_for_client())


@app.post("/api/state", response_class=JSONResponse)
def save_state(state: AppState) -> JSONResponse:
    store.save(state.model_dump())
    current = AppState.model_validate(store.load())
    ensure_logs_for_runners(current.runners)
    rm.refresh_runtime_configs(current)
    return JSONResponse({"ok": True})


@app.get("/api/status", response_class=JSONResponse)
def status() -> JSONResponse:
    return JSONResponse(rm.snapshot())


@app.get("/api/notifications", response_class=JSONResponse)
def list_notifications(
    limit: int = 200,
    runner_id: str = "",
    profile_id: str = "",
    delivery: str = "",
) -> JSONResponse:
    rows = store.list_notification_journal(
        limit=limit,
        runner_id=runner_id,
        profile_id=profile_id,
        delivery=delivery,
    )
    return JSONResponse({"items": rows})


@app.delete("/api/notifications", response_class=JSONResponse)
def clear_notifications() -> JSONResponse:
    deleted = store.clear_notification_journal()
    return JSONResponse({"ok": True, "deleted": deleted})


@app.post("/api/run", response_class=JSONResponse)
def run(req: RunRequest) -> JSONResponse:
    # Validate requested runner against incoming state before persisting.
    compile_runner_cfg(req.state, req.runner_id, broker)

    store.save(req.state.model_dump())
    current = AppState.model_validate(store.load())
    ensure_logs_for_runners(current.runners)
    rm.refresh_runtime_configs(current)
    cfg = compile_runner_cfg(current, req.runner_id, broker)
    rm.start(cfg, reset_schedule=True)
    return JSONResponse({"ok": True})


@app.post("/api/stop", response_class=JSONResponse)
def stop(req: StopRequest) -> JSONResponse:
    rm.stop(req.runner_id)
    return JSONResponse({"ok": True})


@app.post("/api/group/run", response_class=JSONResponse)
def run_group(req: GroupRunRequest) -> JSONResponse:
    # Validate requested group against incoming state before persisting.
    resolve_group_for_state(req.state, req.group_id)

    store.save(req.state.model_dump())
    current = AppState.model_validate(store.load())
    ensure_logs_for_runners(current.runners)
    rm.refresh_runtime_configs(current)
    resolve_group_for_state(current, req.group_id)
    gsm.start_group(current, req.group_id)
    return JSONResponse({"ok": True})


@app.post("/api/group/stop", response_class=JSONResponse)
def stop_group(req: GroupStopRequest) -> JSONResponse:
    current = AppState.model_validate(store.load())
    group = next((g for g in current.runner_groups if g.id == req.group_id), None)
    group_snapshot = gsm.snapshot().get(req.group_id, {})
    if group is None and not group_snapshot:
        raise HTTPException(status_code=404, detail="Group not found")
    runner_ids = list(group.runner_ids) if group else []
    group_name = group.name if group else str(group_snapshot.get("group_name", req.group_id) or req.group_id)
    gsm.stop_group(req.group_id, runner_ids, group_name=group_name)
    return JSONResponse({"ok": True})


@app.post("/api/pushover_test", response_class=JSONResponse)
def pushover_test(req: PushoverTestRequest) -> JSONResponse:
    profile = store.get_notify_profile(req.profile_id)
    if not profile:
        return JSONResponse({"ok": False, "error": "Profile not found"}, status_code=404)

    if profile.get("type") != "pushover":
        return JSONResponse({"ok": False, "error": "Only Pushover profiles supported"}, status_code=400)
    if not bool(profile.get("active", True)):
        return JSONResponse({"ok": False, "error": "Service is inactive. Please activate it first."}, status_code=400)

    config = profile.get("config", {})
    msg = (req.message or "").strip() or f"Pushover Test OK @ {now_iso()}"
    title = "Pushover Test"
    ts = now_iso()
    try:
        result = send_pushover_checked(config.get("user_key", ""), config.get("api_token", ""), msg, title=title)
        ok_result = store.record_notify_delivery_result(req.profile_id, success=True)
        store.append_notification_journal(
            ts=ts,
            runner_id="__manual_test__",
            profile_id=req.profile_id,
            profile_name=ok_result.get("profile_name", profile.get("name", req.profile_id)),
            delivery="success",
            title=title,
            message=msg,
            error="",
        )
        if ok_result.get("found"):
            broker.publish(
                {
                    "type": "notify_profile_status",
                    "runner_id": "__manual_test__",
                    "profile_id": req.profile_id,
                    "profile_name": ok_result.get("profile_name", profile.get("name", req.profile_id)),
                    "active": ok_result.get("active", True),
                    "failure_count": ok_result.get("failure_count", 0),
                    "sent_count": ok_result.get("sent_count", 0),
                    "delivery": "success",
                    "title": title,
                    "message": msg,
                    "ts": ts,
                }
            )
        return JSONResponse({"ok": True, "result": result})
    except Exception as e:
        err = str(e)
        fail_result = store.record_notify_delivery_result(req.profile_id, success=False, failure_threshold=3)
        store.append_notification_journal(
            ts=ts,
            runner_id="__manual_test__",
            profile_id=req.profile_id,
            profile_name=fail_result.get("profile_name", profile.get("name", req.profile_id)),
            delivery="error",
            title=title,
            message=msg,
            error=err,
        )
        if fail_result.get("found"):
            broker.publish(
                {
                    "type": "notify_profile_status",
                    "runner_id": "__manual_test__",
                    "profile_id": req.profile_id,
                    "profile_name": fail_result.get("profile_name", profile.get("name", req.profile_id)),
                    "active": fail_result.get("active", True),
                    "failure_count": fail_result.get("failure_count", 0),
                    "sent_count": fail_result.get("sent_count", 0),
                    "delivery": "error",
                    "reason": err,
                    "auto_disabled": bool(fail_result.get("auto_disabled", False)),
                    "title": title,
                    "message": msg,
                    "ts": ts,
                }
            )
        if fail_result.get("auto_disabled"):
            broker.publish(
                {
                    "type": "notify_profile_auto_disabled",
                    "profile_id": req.profile_id,
                    "profile_name": profile.get("name", req.profile_id),
                    "failure_count": fail_result.get("failure_count", 3),
                    "sent_count": fail_result.get("sent_count", 0),
                    "reason": err,
                    "ts": ts,
                }
            )
        return JSONResponse({"ok": False, "error": err}, status_code=400)


@app.post("/api/clone_runner", response_class=JSONResponse)
def clone_runner(req: CloneRunnerRequest) -> JSONResponse:
    state_data = store.load()
    runners = state_data.get("runners", [])
    if not isinstance(runners, list):
        runners = []
    runner_groups = state_data.get("runner_groups", [])
    if not isinstance(runner_groups, list):
        runner_groups = []
    runner_layout = state_data.get("runner_layout", [])
    if not isinstance(runner_layout, list):
        runner_layout = []

    source_index = -1
    for idx, runner in enumerate(runners):
        if str((runner or {}).get("id", "")).strip() == req.runner_id:
            source_index = idx
            break
    if source_index < 0:
        raise HTTPException(status_code=404, detail="Runner not found")

    source = runners[source_index] if isinstance(runners[source_index], dict) else {}
    clone = json.loads(json.dumps(source, ensure_ascii=False))
    clone["id"] = _new_id("runner_")
    clone["name"] = _next_clone_name(
        str(source.get("name", "Runner") or "Runner"),
        [str((r or {}).get("name", "") or "") for r in runners if isinstance(r, dict)],
        "Runner",
    )

    cases = clone.get("cases", [])
    if isinstance(cases, list):
        for case in cases:
            if isinstance(case, dict):
                case["id"] = _new_id("case_")
    clone["cases"] = cases if isinstance(cases, list) else []
    clone_id = clone["id"]

    runners.insert(source_index + 1, clone)
    state_data["runners"] = runners

    source_group = None
    for group in runner_groups:
        if not isinstance(group, dict):
            continue
        ids = group.get("runner_ids", [])
        if not isinstance(ids, list):
            continue
        if req.runner_id in ids:
            source_group = group
            break

    if isinstance(source_group, dict):
        ids = [str(v).strip() for v in (source_group.get("runner_ids") or []) if _valid_safe_id(str(v).strip())]
        if req.runner_id in ids:
            insert_at = ids.index(req.runner_id) + 1
            ids.insert(insert_at, clone_id)
        else:
            ids.append(clone_id)
        source_group["runner_ids"] = ids
    else:
        inserted = False
        for i, item in enumerate(runner_layout):
            if not isinstance(item, dict):
                continue
            if str(item.get("type", "")).strip().lower() != "runner":
                continue
            if str(item.get("id", "")).strip() != req.runner_id:
                continue
            runner_layout.insert(i + 1, {"type": "runner", "id": clone_id})
            inserted = True
            break
        if not inserted:
            runner_layout.append({"type": "runner", "id": clone_id})

    state_data["runner_groups"] = runner_groups
    state_data["runner_layout"] = runner_layout
    store.save(state_data)
    current = AppState.model_validate(store.load())
    ensure_logs_for_runners(current.runners)
    rm.refresh_runtime_configs(current)
    return JSONResponse({"ok": True, "cloned_id": clone["id"], "cloned_name": clone["name"]})


@app.get("/api/log/{runner_id}", response_class=PlainTextResponse)
def get_log(runner_id: str) -> PlainTextResponse:
    p = ensure_runner_log_file(runner_id)
    return PlainTextResponse(p.read_text(encoding="utf-8", errors="replace"))


@app.delete("/api/log/{runner_id}", response_class=JSONResponse)
def clear_log(runner_id: str) -> JSONResponse:
    p = ensure_runner_log_file(runner_id)
    p.write_text("", encoding="utf-8")
    return JSONResponse({"ok": True, "message": "Log cleared"})


@app.get("/api/export")
def export_runners() -> StreamingResponse:
    state_data = store.load()
    runners = state_data.get("runners", [])
    runner_groups = state_data.get("runner_groups", [])
    runner_layout = state_data.get("runner_layout", [])

    # Export only runners (not Pushover keys for privacy)
    export_data = {
        "runners": runners,
        "runner_groups": runner_groups,
        "runner_layout": runner_layout,
        "exported_at": now_iso(),
    }
    json_str = json.dumps(export_data, ensure_ascii=False, indent=2)

    from io import BytesIO
    buf = BytesIO(json_str.encode("utf-8"))

    return StreamingResponse(
        buf,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="multi-command-runner-export-{dt.datetime.now().strftime("%Y%m%d_%H%M%S")}.json"'
        },
    )


@app.post("/api/import")
async def import_runners(request: Request) -> JSONResponse:
    try:
        body = await request.body()
        if len(body) > MAX_IMPORT_BYTES:
            raise HTTPException(status_code=413, detail=f"Import too large (max {MAX_IMPORT_BYTES} bytes)")
        import_data = json.loads(body.decode("utf-8"))

        if not isinstance(import_data, dict) or "runners" not in import_data:
            raise HTTPException(status_code=400, detail="Invalid import format: missing 'runners' key")

        imported_runners = import_data.get("runners", [])
        if not isinstance(imported_runners, list):
            raise HTTPException(status_code=400, detail="Invalid import format: 'runners' must be a list")
        if len(imported_runners) > MAX_IMPORTED_RUNNERS:
            raise HTTPException(status_code=400, detail=f"Too many runners in import (max {MAX_IMPORTED_RUNNERS})")
        imported_groups = import_data.get("runner_groups", [])
        if imported_groups is None:
            imported_groups = []
        if not isinstance(imported_groups, list):
            raise HTTPException(status_code=400, detail="Invalid import format: 'runner_groups' must be a list")
        imported_layout = import_data.get("runner_layout", [])
        if imported_layout is None:
            imported_layout = []
        if not isinstance(imported_layout, list):
            raise HTTPException(status_code=400, detail="Invalid import format: 'runner_layout' must be a list")

        validated_runners: List[Dict[str, Any]] = []
        for idx, raw_runner in enumerate(imported_runners, start=1):
            if not isinstance(raw_runner, dict):
                raise HTTPException(status_code=400, detail=f"Invalid runner entry at index {idx}: expected object")
            try:
                parsed = RunnerConfig.model_validate(raw_runner).model_dump()
            except ValidationError as e:
                raise HTTPException(status_code=400, detail=f"Invalid runner entry at index {idx}: {e}") from e

            if len(parsed.get("cases", []) or []) > MAX_CASES_PER_RUNNER:
                raise HTTPException(
                    status_code=400,
                    detail=f"Runner entry at index {idx} exceeds case limit ({MAX_CASES_PER_RUNNER})",
                )
            validated_runners.append(parsed)

        validated_groups: List[Dict[str, Any]] = []
        for idx, raw_group in enumerate(imported_groups, start=1):
            if not isinstance(raw_group, dict):
                raise HTTPException(status_code=400, detail=f"Invalid group entry at index {idx}: expected object")
            try:
                parsed = RunnerGroupConfig.model_validate(raw_group).model_dump()
            except ValidationError as e:
                raise HTTPException(status_code=400, detail=f"Invalid group entry at index {idx}: {e}") from e
            validated_groups.append(parsed)

        validated_layout: List[Dict[str, str]] = []
        for idx, raw_item in enumerate(imported_layout, start=1):
            if not isinstance(raw_item, dict):
                raise HTTPException(status_code=400, detail=f"Invalid layout entry at index {idx}: expected object")
            try:
                parsed = RunnerLayoutItem.model_validate(raw_item).model_dump()
            except ValidationError as e:
                raise HTTPException(status_code=400, detail=f"Invalid layout entry at index {idx}: {e}") from e
            validated_layout.append(parsed)

        # Load current state
        current_state = store.load()
        existing_runners = current_state.get("runners", [])
        if not isinstance(existing_runners, list):
            existing_runners = []
        existing_groups = current_state.get("runner_groups", [])
        if not isinstance(existing_groups, list):
            existing_groups = []
        existing_layout = current_state.get("runner_layout", [])
        if not isinstance(existing_layout, list):
            existing_layout = []

        if len(existing_runners) + len(validated_runners) > MAX_TOTAL_RUNNERS:
            raise HTTPException(
                status_code=400,
                detail=f"Import would exceed total runner limit ({MAX_TOTAL_RUNNERS})",
            )

        runner_id_map: Dict[str, str] = {}
        for runner in validated_runners:
            old_runner_id = str(runner.get("id", "")).strip()
            runner["id"] = _new_id("runner_")
            runner_id_map[old_runner_id] = runner["id"]
            for case in runner.get("cases", []):
                case["id"] = _new_id("case_")

        group_id_map: Dict[str, str] = {}
        mapped_groups: List[Dict[str, Any]] = []
        assigned_group_runner_ids: set[str] = set()
        for group in validated_groups:
            old_group_id = str(group.get("id", "")).strip()
            new_group_id = _new_id("group_")
            group_id_map[old_group_id] = new_group_id
            mapped_runner_ids: List[str] = []
            for old_runner_id in group.get("runner_ids", []):
                mapped_runner_id = runner_id_map.get(str(old_runner_id).strip(), "")
                if not mapped_runner_id:
                    continue
                if mapped_runner_id in assigned_group_runner_ids:
                    continue
                if mapped_runner_id in mapped_runner_ids:
                    continue
                mapped_runner_ids.append(mapped_runner_id)
                assigned_group_runner_ids.add(mapped_runner_id)
            mapped_groups.append(
                {
                    "id": new_group_id,
                    "name": str(group.get("name", "Group") or "Group"),
                    "runner_ids": mapped_runner_ids,
                }
            )

        mapped_layout_segment: List[Dict[str, str]] = []
        grouped_runner_ids = {rid for g in mapped_groups for rid in g.get("runner_ids", [])}
        if validated_layout:
            seen_layout_runner_ids: set[str] = set()
            seen_layout_group_ids: set[str] = set()
            for item in validated_layout:
                item_type = str(item.get("type", "")).strip().lower()
                item_id = str(item.get("id", "")).strip()
                if item_type == "runner":
                    mapped_runner_id = runner_id_map.get(item_id, "")
                    if not mapped_runner_id or mapped_runner_id in grouped_runner_ids:
                        continue
                    if mapped_runner_id in seen_layout_runner_ids:
                        continue
                    seen_layout_runner_ids.add(mapped_runner_id)
                    mapped_layout_segment.append({"type": "runner", "id": mapped_runner_id})
                elif item_type == "group":
                    mapped_group_id = group_id_map.get(item_id, "")
                    if not mapped_group_id:
                        continue
                    if mapped_group_id in seen_layout_group_ids:
                        continue
                    seen_layout_group_ids.add(mapped_group_id)
                    mapped_layout_segment.append({"type": "group", "id": mapped_group_id})

            for runner in validated_runners:
                rid = runner["id"]
                if rid in grouped_runner_ids or rid in seen_layout_runner_ids:
                    continue
                mapped_layout_segment.append({"type": "runner", "id": rid})
                seen_layout_runner_ids.add(rid)
            for group in mapped_groups:
                gid = group["id"]
                if gid in seen_layout_group_ids:
                    continue
                mapped_layout_segment.append({"type": "group", "id": gid})
                seen_layout_group_ids.add(gid)
        else:
            # Legacy import format without groups/layout -> all imported runners stay ungrouped.
            for runner in validated_runners:
                mapped_layout_segment.append({"type": "runner", "id": runner["id"]})
            for group in mapped_groups:
                mapped_layout_segment.append({"type": "group", "id": group["id"]})

        existing_runners.extend(validated_runners)
        existing_groups.extend(mapped_groups)
        existing_layout.extend(mapped_layout_segment)

        current_state["runners"] = existing_runners
        current_state["runner_groups"] = existing_groups
        current_state["runner_layout"] = existing_layout
        store.save(current_state)
        merged_state = AppState.model_validate(store.load())
        ensure_logs_for_runners(merged_state.runners)
        rm.refresh_runtime_configs(merged_state)

        return JSONResponse({"ok": True, "imported_count": len(validated_runners)})
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Import failed")


@app.get("/api/events")
def events() -> StreamingResponse:
    try:
        sub_id, q = broker.subscribe()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    snap = rm.snapshot()
    group_snap = gsm.snapshot()

    def gen() -> Iterable[str]:
        try:
            yield f"data: {json.dumps({'type': 'snapshot', 'snapshot': snap, 'group_snapshot': group_snap}, ensure_ascii=False)}\n\n"
            while True:
                try:
                    ev = q.get(timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            broker.unsubscribe(sub_id)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
