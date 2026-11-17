"""SQLite persistence for derived call cards (Cartas de Llamada)."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.schemas import CallCard, CallCardIn

_SCHEMA = """
CREATE TABLE IF NOT EXISTS call_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
)
"""


class CardStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def create(self, card: CallCardIn) -> CallCard:
        created = datetime.now(UTC)
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO call_cards (created_at, payload) VALUES (?, ?)",
                (created.isoformat(), card.model_dump_json()),
            )
            card_id = cur.lastrowid
        return CallCard(id=card_id, created_at=created, **card.model_dump())

    def list(self, limit: int = 50) -> list[CallCard]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, created_at, payload FROM call_cards ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            CallCard(id=r[0], created_at=datetime.fromisoformat(r[1]), **json.loads(r[2])) for r in rows
        ]
