"""Minimal SQLite persistence for the fixed RPSIT account and saved timetables.

Only the single fixed account (``Rpsit_admin``) is supported. The password is
never stored in clear text: it is hashed with Werkzeug's PBKDF2-SHA256 and the
hash is kept in the ``users`` table.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from werkzeug.security import check_password_hash, generate_password_hash

DEFAULT_USERNAME = "Rpsit_admin"
DEFAULT_PASSWORD = "rpsit123"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timetables (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    class_name TEXT,
    template TEXT,
    payload TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timetables_user ON timetables (username, created_at DESC);
"""


class HistoryDB:
    """Thin SQLite wrapper for users and saved timetables."""

    def __init__(self, db_path: str | Path, duplicate_window_seconds: int = 15) -> None:
        self.db_path = str(db_path)
        self.duplicate_window_seconds = duplicate_window_seconds
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(_SCHEMA)

    # ------------------------------------------------------------------ users
    def ensure_user(self, username: str, password: str) -> None:
        """Create the fixed user or refresh its password hash from config."""
        password_hash = generate_password_hash(password, method="pbkdf2:sha256")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?) "
                "ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash",
                (username, password_hash),
            )

    def verify_user(self, username: str, password: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT password_hash FROM users WHERE username = ?", (username,)
            ).fetchone()
        if row is None:
            return False
        return check_password_hash(row["password_hash"], password)

    # ------------------------------------------------------------ timetables
    @staticmethod
    def _fingerprint(username: str, name: str, class_name: str, payload: str) -> str:
        digest = hashlib.sha256(f"{username}\u0000{name}\u0000{class_name}\u0000{payload}".encode())
        return digest.hexdigest()

    def save_timetable(
        self,
        username: str,
        name: str,
        class_name: str,
        template: str,
        payload: dict[str, Any] | str,
    ) -> dict[str, Any]:
        payload_text = payload if isinstance(payload, str) else json.dumps(payload)
        fingerprint = self._fingerprint(username, name, class_name, payload_text)
        now = datetime.now(timezone.utc)
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM timetables WHERE username = ? AND fingerprint = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (username, fingerprint),
            ).fetchone()
            if existing is not None:
                created = datetime.fromisoformat(existing["created_at"])
                if now - created <= timedelta(seconds=self.duplicate_window_seconds):
                    return self._row_to_meta(existing, duplicate=True)

            record_id = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO timetables "
                "(id, username, name, class_name, template, payload, fingerprint, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (record_id, username, name, class_name, template, payload_text, fingerprint, now.isoformat()),
            )
        return {
            "id": record_id,
            "name": name,
            "class_name": class_name,
            "template": template,
            "created_at": now.isoformat(),
            "duplicate": False,
        }

    def list_timetables(self, username: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, name, class_name, template, created_at "
                "FROM timetables WHERE username = ? ORDER BY created_at DESC",
                (username,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_timetable(self, username: str, record_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM timetables WHERE username = ? AND id = ?",
                (username, record_id),
            ).fetchone()
        if row is None:
            return None
        record = dict(row)
        try:
            record["payload"] = json.loads(record["payload"])
        except (ValueError, TypeError):
            record["payload"] = None
        return record

    @staticmethod
    def _row_to_meta(row: sqlite3.Row, duplicate: bool = False) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "class_name": row["class_name"],
            "template": row["template"],
            "created_at": row["created_at"],
            "duplicate": duplicate,
        }
