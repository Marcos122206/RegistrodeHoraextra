import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session
import psycopg
from psycopg.rows import dict_row
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
LEGACY_DB_PATH = BASE_DIR / "database.sqlite3"
DEFAULT_PERSISTENT_DB_PATH = Path("/var/data/database.sqlite3")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

if DATABASE_URL and "[YOUR-PASSWORD]" in DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL ainda contém [YOUR-PASSWORD]. "
        "Substitua o placeholder pela senha real do Supabase no Render."
    )
if DATABASE_URL and "sslmode=" not in DATABASE_URL.lower():
    separator = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{separator}sslmode=require"


def resolve_database_path():
    configured_path = os.environ.get("DATABASE_PATH")
    if not configured_path:
        if DEFAULT_PERSISTENT_DB_PATH.parent.is_dir() and os.access(
            DEFAULT_PERSISTENT_DB_PATH.parent, os.W_OK
        ):
            return DEFAULT_PERSISTENT_DB_PATH
        return LEGACY_DB_PATH

    candidate = Path(configured_path)
    try:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        if not os.access(candidate.parent, os.W_OK):
            raise PermissionError(f"Diretório sem permissão de escrita: {candidate.parent}")
        return candidate
    except OSError as error:
        raise RuntimeError(
            f"DATABASE_PATH={candidate} não está disponível ({error}). "
            "Configure um Persistent Disk gravável antes de iniciar o site. "
            "O app foi interrompido para evitar perda de usuários."
        ) from error


DB_PATH = None if DATABASE_URL else resolve_database_path()
secret_key = os.environ.get("FLASK_SECRET_KEY", "").strip()

is_production = any(
    (
        os.environ.get("FLASK_ENV", "").lower() == "production",
        DATABASE_URL,
        os.environ.get("DATABASE_PATH", "").strip(),
        os.environ.get("FLASK_HTTPS", "0") == "1",
    )
)

if not secret_key and is_production:
    raise RuntimeError(
        "FLASK_SECRET_KEY precisa estar configurada em produção. "
        "Use a mesma chave em todos os processos e deploys."
    )

if DB_PATH and DB_PATH != LEGACY_DB_PATH and not DB_PATH.exists() and LEGACY_DB_PATH.exists():
    shutil.copy2(LEGACY_DB_PATH, DB_PATH)

app = Flask(__name__, static_folder=str(BASE_DIR))
app.config.update(
    SECRET_KEY=secret_key or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_HTTPS", "0") == "1",
    MAX_CONTENT_LENGTH=64 * 1024,
)


def get_db():
    if DATABASE_URL:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def execute_query(conn, query, params=()):
    if DATABASE_URL:
        query = query.replace("?", "%s")
    return conn.execute(query, params)


def init_db():
    conn = get_db()
    if DATABASE_URL:
        execute_query(
            conn,
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                data_json TEXT DEFAULT '{}'
            )
            """,
        )
    else:
        execute_query(
            conn,
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                data_json TEXT DEFAULT '{}'
            )
            """,
        )
    conn.commit()
    conn.close()


def hash_password(value: str) -> str:
    return generate_password_hash(value)


def is_valid_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))


def get_current_user_id():
    return session.get("user_id")


def load_user_state(row):
    try:
        return json.loads(row["data_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/styles.css")
def styles():
    return send_from_directory(BASE_DIR, "styles.css")


@app.route("/script.js")
def script():
    return send_from_directory(BASE_DIR, "script.js")


@app.route("/api/register", methods=["POST"])
def register_user():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = (payload.get("password") or "").strip()

    if not name or not email or not password:
        return jsonify({"ok": False, "message": "Preencha nome, email e senha."}), 400
    if len(name) > 100 or not is_valid_email(email) or len(email) > 254:
        return jsonify({"ok": False, "message": "Informe um nome e email válidos."}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "message": "A senha deve ter pelo menos 8 caracteres."}), 400

    conn = get_db()
    try:
        execute_query(
            conn,
            "INSERT INTO users (name, email, password_hash, data_json) VALUES (?, ?, ?, ?)",
            (name, email, hash_password(password), json.dumps({}))
        )
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "message": "Esse e-mail já está cadastrado."}), 409
    finally:
        conn.close()

    return jsonify({"ok": True, "message": "Cadastro realizado com sucesso."})


@app.route("/api/login", methods=["POST"])
def login_user():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = (payload.get("password") or "").strip()

    if not email or not password:
        return jsonify({"ok": False, "message": "Informe email e senha."}), 400

    conn = get_db()
    row = execute_query(
        conn,
        "SELECT id, name, email, password_hash, data_json FROM users WHERE email = ?",
        (email,),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({"ok": False, "message": "Email ou senha inválidos."}), 401

    password_is_valid = False
    try:
        password_is_valid = check_password_hash(row["password_hash"], password)
    except (ValueError, AttributeError):
        password_is_valid = False

    if not password_is_valid:
        legacy_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        if secrets.compare_digest(row["password_hash"], legacy_hash):
            password_is_valid = True
            conn = get_db()
            execute_query(
                conn,
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(password), row["id"]),
            )
            conn.commit()
            conn.close()

    if not password_is_valid:
        return jsonify({"ok": False, "message": "Email ou senha inválidos."}), 401

    session.clear()
    session["user_id"] = row["id"]

    user = {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
    }

    state = load_user_state(row)
    return jsonify({"ok": True, "user": user, "state": state})


@app.route("/api/session", methods=["GET"])
def current_session():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"ok": True, "authenticated": False})

    conn = get_db()
    row = execute_query(
        conn,
        "SELECT id, name, email, data_json FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()

    if not row:
        session.clear()
        return jsonify({"ok": True, "authenticated": False})

    return jsonify({
        "ok": True,
        "authenticated": True,
        "user": {"id": row["id"], "name": row["name"], "email": row["email"]},
        "state": load_user_state(row),
    })


@app.route("/api/state", methods=["GET", "POST"])
def api_state():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"ok": False, "message": "Faça login para continuar."}), 401

    if request.method == "GET":
        conn = get_db()
        row = execute_query(conn, "SELECT data_json FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        if not row:
            return jsonify({"ok": False, "state": {}})
        return jsonify({"ok": True, "state": load_user_state(row)})

    payload = request.get_json(silent=True) or {}
    state = payload.get("state") or {}
    if not isinstance(state, dict):
        return jsonify({"ok": False, "message": "Estado inválido."}), 400
    state.pop("user", None)

    conn = get_db()
    execute_query(
        conn,
        "UPDATE users SET data_json = ? WHERE id = ?",
        (json.dumps(state), user_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "Dados salvos."})


@app.route("/api/logout", methods=["POST"])
def logout_user():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/account", methods=["DELETE"])
def delete_account():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"ok": False, "message": "Faça login para continuar."}), 401

    conn = get_db()
    execute_query(conn, "DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    session.clear()
    return jsonify({"ok": True, "message": "Conta excluída."})


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=False)
