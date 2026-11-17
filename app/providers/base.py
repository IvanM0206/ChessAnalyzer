"""Provider contract. The orchestrator only depends on this interface."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.schemas import RawExtraction, ReferenceCase


@dataclass(frozen=True)
class ExtractionContext:
    similar_cases: list[tuple[ReferenceCase, float]]
    candidate_questions: list[str]
    known_streets: list[str] = field(default_factory=list)


class ProviderError(RuntimeError):
    """Raised when a provider cannot return a valid RawExtraction."""


class ExtractionProvider(Protocol):
    name: str

    def extract(self, transcript: str, ctx: ExtractionContext) -> RawExtraction: ...
