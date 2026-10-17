"""Flask server for RPSIT Timetable Studio.

Serves the existing browser application (``index.html`` + ``src/``) and adds the
fixed-credential login, authenticating sessions, and persistent timetable
history required by the upgrade. The timetable-generation algorithm
(``src/scheduler.js``) is untouched and still runs in the browser.
"""

from __future__ import annotations

import os
import secrets
from datetime import timedelta
from functools import wraps
from pathlib import Path
from typing import Any, Callable

from flask import Flask, jsonify, request, send_from_directory, session

from backend.history import DEFAULT_PASSWORD, DEFAULT_USERNAME, HistoryDB

BASE_DIR = Path(__file__).resolve().parent
SRC_DIR = BASE_DIR / "src"
GENERATED_DIR = BASE_DIR / "backend" / "generated"
DB_PATH = Path(os.environ.get("RPSIT_DB_PATH", GENERATED_DIR / "timetable_history.db"))
SECRET_PATH = GENERATED_DIR / ".session_secret"

ADMIN_USERNAME = os.environ.get("RPSIT_ADMIN_USER", DEFAULT_USERNAME)
ADMIN_PASSWORD = os.environ.get("RPSIT_ADMIN_PASSWORD", DEFAULT_PASSWORD)


def _load_secret_key() -> str:
    """Prefer the environment; otherwise persist a generated key for the deployment."""
    env_key = os.environ.get("RPSIT_SECRET_KEY")
    if env_key:
        return env_key
    if SECRET_PATH.exists():
        stored = SECRET_PATH.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    generated = secrets.token_hex(32)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    SECRET_PATH.write_text(generated, encoding="utf-8")
    return generated


app = Flask(__name__, static_folder=None)
app.secret_key = _load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("RPSIT_COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)

db = HistoryDB(DB_PATH)
db.ensure_user(ADMIN_USERNAME, ADMIN_PASSWORD)


# --------------------------------------------------------------------- helpers
def authenticated() -> bool:
    return session.get("username") == ADMIN_USERNAME


def login_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if not authenticated():
            return jsonify({"error": "unauthorized", "message": "Authentication required."}), 401
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------- pages
@app.get("/")
def index() -> Any:
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/index.html")
def index_html() -> Any:
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/src/<path:filename>")
def source(filename: str) -> Any:
    return send_from_directory(SRC_DIR, filename)


# ---------------------------------------------------------------------- auth
@app.get("/api/auth/session")
def auth_session() -> Any:
    if authenticated():
        return jsonify({"authenticated": True, "username": session["username"]})
    return jsonify({"authenticated": False, "username": None})


@app.post("/api/auth/login")
def auth_login() -> Any:
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if username != ADMIN_USERNAME or not db.verify_user(username, password):
        return jsonify({"error": "invalid_credentials",
                        "message": "Invalid username or password. Please try again."}), 401
    session.clear()
    session.permanent = True
    session["username"] = ADMIN_USERNAME
    return jsonify({"authenticated": True, "username": ADMIN_USERNAME})


@app.post("/api/auth/logout")
def auth_logout() -> Any:
    session.clear()
    return jsonify({"authenticated": False, "username": None})


# ---------------------------------------------------------------- timetables
@app.post("/api/timetables")
@login_required
def save_timetable() -> Any:
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    payload = data.get("payload")
    if not name:
        return jsonify({"error": "invalid_input", "message": "A timetable name is required."}), 400
    if payload is None:
        return jsonify({"error": "invalid_input", "message": "Timetable contents are required."}), 400
    class_name = str(data.get("class_name", "") or "")
    template = str(data.get("template", "class") or "class")
    try:
        record = db.save_timetable(session["username"], name, class_name, template, payload)
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"error": "storage_error", "message": f"Could not save timetable: {exc}"}), 500
    return jsonify(record), 201 if not record.get("duplicate") else 200


@app.get("/api/timetables")
@login_required
def list_timetables() -> Any:
    try:
        return jsonify({"timetables": db.list_timetables(session["username"])})
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"error": "storage_error", "message": f"Could not load history: {exc}"}), 500


@app.get("/api/timetables/<record_id>")
@login_required
def get_timetable(record_id: str) -> Any:
    try:
        record = db.get_timetable(session["username"], record_id)
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"error": "storage_error", "message": f"Could not load timetable: {exc}"}), 500
    if record is None or record.get("payload") is None:
        return jsonify({"error": "not_found", "message": "Saved timetable not found."}), 404
    return jsonify(record)


@app.errorhandler(404)
def not_found(_error: Any) -> Any:
    return jsonify({"error": "not_found", "message": "Resource not found."}), 404


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
