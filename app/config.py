"""Runtime configuration read from environment variables (never from committed files)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class ProviderName(StrEnum):
    MOCK = "mock"
    ANTHROPIC = "anthropic"


@dataclass(frozen=True)
class Settings:
    llm_provider: ProviderName
    anthropic_model: str
    dataset_path: Path
    db_path: Path

    @property
    def anthropic_key_present(self) -> bool:
        return bool(os.getenv("ANTHROPIC_API_KEY"))


def load_settings() -> Settings:
    root = Path(__file__).resolve().parent.parent
    raw_provider = os.getenv("LLM_PROVIDER", "").strip().lower()

    # Dual provider: if nobody asked for a real provider (or the key is missing),
    # fall back to the deterministic mock so the stack always works offline.
    if raw_provider == ProviderName.ANTHROPIC and os.getenv("ANTHROPIC_API_KEY"):
        provider = ProviderName.ANTHROPIC
    elif raw_provider == "" and os.getenv("ANTHROPIC_API_KEY"):
        provider = ProviderName.ANTHROPIC
    else:
        provider = ProviderName.MOCK

    return Settings(
        llm_provider=provider,
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5"),
        dataset_path=Path(os.getenv("DATASET_PATH", root / "data" / "dataset_challenge_soflex.csv")),
        db_path=Path(os.getenv("DB_PATH", root / "data" / "copilot.sqlite3")),
    )
