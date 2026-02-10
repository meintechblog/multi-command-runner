"""
command-runner

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

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data"))).resolve()
DB_PATH = DATA_DIR / "app.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex}"


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
            "name": "Passwort-Check",
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
        }
    ],
}


class CaseRule(BaseModel):
    id: str = Field(default_factory=lambda: _new_id("case_"))
    pattern: str = ""
    message_template: str = ""
    state: str = ""  # Optional semantic state like UP/DOWN/WARN/INFO


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


class AppState(BaseModel):
    notify_profiles: List[NotifyProfile] = Field(default_factory=list)
    runners: List[RunnerConfig] = Field(default_factory=list)
    # Legacy fields for migration
    pushover_user_key: str = ""
    pushover_api_token: str = ""


class PushoverTestRequest(BaseModel):
    profile_id: str = ""
    message: str = ""


class RunRequest(BaseModel):
    state: AppState
    runner_id: str


class StopRequest(BaseModel):
    runner_id: str


class StateStore:
    def __init__(self, db_path: Path) -> None:
        self._lock = threading.Lock()
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
        if self._get_raw_json() is None:
            self.save(DEFAULT_STATE)

    def _get_raw_json(self) -> Optional[str]:
        cur = self._conn.execute("SELECT json FROM state WHERE id=1")
        row = cur.fetchone()
        return row[0] if row else None

    def load(self) -> Dict[str, Any]:
        with self._lock:
            raw = self._get_raw_json()
            if raw is None:
                self.save(DEFAULT_STATE)
                return dict(DEFAULT_STATE)
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = dict(DEFAULT_STATE)
            return self._merge_defaults(data)

    def save(self, state: Dict[str, Any]) -> None:
        with self._lock:
            payload = json.dumps(self._merge_defaults(state), ensure_ascii=False)
            self._conn.execute(
                "INSERT INTO state (id, json) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                (payload,),
            )
            self._conn.commit()

    def get_notify_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            raw = self._get_raw_json()
            if raw is None:
                data = self._merge_defaults(dict(DEFAULT_STATE))
            else:
                try:
                    data = self._merge_defaults(json.loads(raw))
                except json.JSONDecodeError:
                    data = self._merge_defaults(dict(DEFAULT_STATE))

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
        merged = dict(DEFAULT_STATE)
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
        for np in notify_profiles:
            np.setdefault("id", _new_id("notify_"))
            np.setdefault("name", "Pushover")
            np.setdefault("type", "pushover")
            np.setdefault("active", True)
            np.setdefault("failure_count", 0)
            np.setdefault("sent_count", 0)
            np["active"] = bool(np.get("active", True))
            try:
                np["failure_count"] = max(0, int(np.get("failure_count", 0)))
            except Exception:
                np["failure_count"] = 0
            try:
                np["sent_count"] = max(0, int(np.get("sent_count", 0)))
            except Exception:
                np["sent_count"] = 0
            np.pop("snoozed_until", None)
            np.setdefault("config", {"user_key": "", "api_token": ""})
        merged["notify_profiles"] = notify_profiles

        runners = merged.get("runners") or []
        if not isinstance(runners, list):
            runners = []
        for r in runners:
            r.setdefault("id", _new_id("runner_"))
            r.setdefault("name", "Runner")
            r.setdefault("command", "")
            r.setdefault("logging_enabled", True)
            r.setdefault("schedule", {"hours": 0, "minutes": 0, "seconds": 0})
            r.setdefault("max_runs", 1)
            r.setdefault("alert_cooldown_s", 300)
            r.setdefault("alert_escalation_s", 1800)
            r.setdefault("failure_pause_threshold", 5)
            r.setdefault("cases", [])
            r.setdefault("notify_profile_ids", [])
            r.setdefault("notify_profile_updates_only", [])
            try:
                r["alert_cooldown_s"] = max(0, int(r.get("alert_cooldown_s", 300)))
            except Exception:
                r["alert_cooldown_s"] = 300
            try:
                r["alert_escalation_s"] = max(0, int(r.get("alert_escalation_s", 1800)))
            except Exception:
                r["alert_escalation_s"] = 1800
            try:
                r["failure_pause_threshold"] = max(0, int(r.get("failure_pause_threshold", 5)))
            except Exception:
                r["failure_pause_threshold"] = 5
            r.pop("snoozed_until", None)
            # Case migrations
            for c in r.get("cases", []):
                c.setdefault("state", "")
                c["state"] = normalize_case_state(c.get("state", ""))
        merged["runners"] = runners
        return merged


class EventBroker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: Dict[str, queue.Queue] = {}

    def subscribe(self) -> Tuple[str, queue.Queue]:
        sub_id = uuid.uuid4().hex
        q: queue.Queue = queue.Queue(maxsize=7000)
        with self._lock:
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

        # Load persisted runtime status
        runtime_status = load_runtime_status()
        for runner_id, data in runtime_status.items():
            self._last_case[runner_id] = data.get("last_case", "")
            self._last_case_ts[runner_id] = data.get("last_case_ts", "")

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            snap: Dict[str, Any] = {}
            rids = (
                set(self._cfg.keys())
                | set(self._outputs.keys())
                | set(self._procs.keys())
                | set(self._timers.keys())
                | set(self._consecutive_failures.keys())
                | set(self._paused_due_failures.keys())
            )
            for rid in rids:
                proc = self._procs.get(rid)
                running = proc is not None and proc.poll() is None
                snap[rid] = {
                    "running": running,
                    "stopped": bool(self._stopped.get(rid, False)),
                    "tail": "".join((self._outputs.get(rid) or [])[-200:]),
                    "remaining": self._remaining.get(rid),
                    "run_count": self._run_count.get(rid, 0),  # Current run count for infinite runners
                    "scheduled": rid in self._timers,
                    "last_case": self._last_case.get(rid, ""),
                    "last_case_ts": self._last_case_ts.get(rid, ""),
                    "consecutive_failures": int(self._consecutive_failures.get(rid, 0)),
                    "paused": bool(self._paused_due_failures.get(rid, False)),
                }
            return snap

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
            self._broker.publish({"type": "status", "runner_id": runner_id, "status": "stopped", "ts": now_iso()})
            return

        self._terminate_clean(proc)

    def start(self, cfg: RunnerRuntimeConfig, reset_schedule: bool = True) -> None:
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

        with self._lock:
            current_run_count = self._run_count.get(cfg.runner_id, 0)
            current_remaining = self._remaining.get(cfg.runner_id)
        self._broker.publish({"type": "status", "runner_id": cfg.runner_id, "status": "started", "ts": now_iso(), "run_count": current_run_count, "remaining": current_remaining})
        threading.Thread(target=self._reader_thread, args=(cfg.runner_id,), daemon=True).start()

    def _schedule_next(self, runner_id: str) -> None:
        with self._lock:
            cfg = self._cfg.get(runner_id)
            if cfg is None or cfg.interval_s <= 0:
                return
            if self._stopped.get(runner_id, False):
                return
            if self._paused_due_failures.get(runner_id, False):
                return
            rem = self._remaining.get(runner_id)
            if rem is not None and rem <= 0:
                return
            if runner_id in self._timers:
                return
            t = threading.Timer(cfg.interval_s, self._scheduled_start, args=(runner_id,))
            t.daemon = True
            self._timers[runner_id] = t
            t.start()
        self._broker.publish({"type": "status", "runner_id": runner_id, "status": "scheduled", "in_s": cfg.interval_s, "ts": now_iso()})

    def _scheduled_start(self, runner_id: str) -> None:
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
        self._broker.publish({"type": "status", "runner_id": runner_id, "status": "started", "ts": now_iso(), "run_count": current_run_count, "remaining": current_remaining})
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
            cfg = self._cfg.get(runner_id)

        if proc is None or proc.stdout is None or cfg is None:
            return

        try:
            for line in proc.stdout:
                s = line.strip()
                with self._lock:
                    self._outputs[runner_id].append(line)
                    if s:
                        self._last_line[runner_id] = s
                self._broker.publish({"type": "output", "runner_id": runner_id, "line": line})
                self._match_line_and_notify(cfg, line)
        finally:
            exit_code = proc.wait()
            with self._lock:
                output = "".join(self._outputs.get(runner_id) or [])
                stopped = bool(self._stopped.get(runner_id, False))
                last_line = self._last_line.get(runner_id, "")
                self._procs.pop(runner_id, None)

            if cfg.logging_enabled:
                append_run_log_file(runner_log_path(runner_id), cfg.runner_name, cfg.command, exit_code, output, stopped)

            # Empty case (pattern+template empty) triggers last-line notification at run end.
            if cfg.send_last_line_on_finish:
                msg = last_line if last_line else "(no output)"
                ts = now_iso()
                with self._lock:
                    self._last_case[runner_id] = msg
                    self._last_case_ts[runner_id] = ts

                self._save_runtime_status()
                self._broker.publish({"type": "case_match", "runner_id": runner_id, "pattern": "__on_finish__", "message": msg, "ts": ts})

                if cfg.notify_targets:
                    self._notifier.enqueue(
                        targets=cfg.notify_targets,
                        message=msg,
                        title=f"{cfg.runner_name} (last line)",
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
                        threshold = max(0, int(cfg.failure_pause_threshold))
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
                    "ts": now_iso(),
                }
            )
            if pause_now:
                self._broker.publish(
                    {
                        "type": "status",
                        "runner_id": runner_id,
                        "status": "paused",
                        "reason": "auto_pause_failures",
                        "consecutive_failures": consecutive_failures,
                        "threshold": int(cfg.failure_pause_threshold),
                        "ts": now_iso(),
                    }
                )
                return
            self._schedule_next(runner_id)

    def _match_line_and_notify(self, cfg: RunnerRuntimeConfig, line: str) -> None:
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


store = StateStore(DB_PATH)
ensure_logs_for_runners(store.load().get("runners", []))
broker = EventBroker()
notifier = NotificationWorker(broker, store)
rm = RunnerManager(broker, notifier)

app = FastAPI(title="command-runner", version="2.0.2")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    app_js = BASE_DIR / "static" / "app.js"
    style_css = BASE_DIR / "static" / "style.css"
    asset_version = int(max(app_js.stat().st_mtime, style_css.stat().st_mtime))
    return templates.TemplateResponse("index.html", {"request": request, "asset_version": asset_version})


@app.get("/api/state", response_class=JSONResponse)
def get_state() -> JSONResponse:
    return JSONResponse(store.load())


@app.post("/api/state", response_class=JSONResponse)
def save_state(state: AppState) -> JSONResponse:
    store.save(state.model_dump())
    ensure_logs_for_runners(state.runners)
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
    store.save(req.state.model_dump())
    ensure_logs_for_runners(req.state.runners)
    cfg = compile_runner_cfg(req.state, req.runner_id, broker)
    rm.start(cfg, reset_schedule=True)
    return JSONResponse({"ok": True})


@app.post("/api/stop", response_class=JSONResponse)
def stop(req: StopRequest) -> JSONResponse:
    rm.stop(req.runner_id)
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

    # Export only runners (not Pushover keys for privacy)
    export_data = {"runners": runners, "exported_at": now_iso()}
    json_str = json.dumps(export_data, ensure_ascii=False, indent=2)

    from io import BytesIO
    buf = BytesIO(json_str.encode("utf-8"))

    return StreamingResponse(
        buf,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="command-runner-export-{dt.datetime.now().strftime("%Y%m%d_%H%M%S")}.json"'
        },
    )


@app.post("/api/import")
async def import_runners(request: Request) -> JSONResponse:
    try:
        body = await request.body()
        import_data = json.loads(body.decode("utf-8"))

        if not isinstance(import_data, dict) or "runners" not in import_data:
            raise HTTPException(status_code=400, detail="Invalid import format: missing 'runners' key")

        imported_runners = import_data.get("runners", [])
        if not isinstance(imported_runners, list):
            raise HTTPException(status_code=400, detail="Invalid import format: 'runners' must be a list")

        # Load current state
        current_state = store.load()
        existing_runners = current_state.get("runners", [])

        # Merge: add imported runners with new IDs to avoid conflicts
        for runner in imported_runners:
            # Generate new ID for imported runner
            runner["id"] = _new_id("runner_")
            # Regenerate case IDs too
            for case in runner.get("cases", []):
                case["id"] = _new_id("case_")
            existing_runners.append(runner)

        current_state["runners"] = existing_runners
        store.save(current_state)
        ensure_logs_for_runners(existing_runners)

        return JSONResponse({"ok": True, "imported_count": len(imported_runners)})
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/events")
def events() -> StreamingResponse:
    sub_id, q = broker.subscribe()
    snap = rm.snapshot()

    def gen() -> Iterable[str]:
        try:
            yield f"data: {json.dumps({'type': 'snapshot', 'snapshot': snap}, ensure_ascii=False)}\n\n"
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
