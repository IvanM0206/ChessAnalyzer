"""Orchestrator: retrieval -> provider extraction -> grounding/validation -> suggestion.

The provider is treated as untrusted: its output is checked against the transcript
(evidence grounding) and against the catalog (protocol questions), and a failure
in the real provider degrades to the deterministic mock instead of erroring.
"""

from __future__ import annotations

import logging
import re

from app.normalization import StreetGazetteer, canonical_street
from app.providers import ExtractionContext, ExtractionProvider, MockProvider, ProviderError
from app.retrieval import CaseRetriever
from app.schemas import (
    ChecklistItem,
    CopilotSuggestion,
    ExtractedField,
    GroundedField,
    RawExtraction,
    ReferenceCase,
    SimilarCase,
)
from app.text import fold, is_grounded

log = logging.getLogger(__name__)

MIN_SIMILARITY = 0.12  # below this the incident type is a guess
MAX_QUESTIONS = 8


class Copilot:
    def __init__(self, catalog: list[ReferenceCase] | tuple[ReferenceCase, ...], provider: ExtractionProvider) -> None:
        self.catalog = list(catalog)
        self.provider = provider
        self.retriever = CaseRetriever(self.catalog)
        streets = [c.calle for c in self.catalog] + [c.interseccion for c in self.catalog]
        self.gazetteer = StreetGazetteer(streets)
        self._fallback = MockProvider()

    # ------------------------------------------------------------------ public
    def analyze(self, transcript: str) -> CopilotSuggestion:
        similar = self.retriever.search(transcript, k=5)
        ctx = ExtractionContext(
            similar_cases=similar,
            candidate_questions=self._candidate_questions(similar),
            known_streets=[c.calle for c in self.catalog],
        )

        warnings: list[str] = []
        provider_name = self.provider.name
        try:
            raw = self.provider.extract(transcript, ctx)
        except ProviderError as exc:
            log.warning("provider %s failed: %s", self.provider.name, exc)
            warnings.append(f"Proveedor IA no disponible ({exc}). Se usó el modo reglas.")
            raw = self._fallback.extract(transcript, ctx)
            provider_name = f"{self._fallback.name} (fallback)"

        return self._build_suggestion(transcript, raw, ctx, provider_name, warnings)

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _candidate_questions(similar: list[tuple[ReferenceCase, float]]) -> list[str]:
        """Protocol questions of the most likely category (by summed similarity).

        Mixing questions from different incident types confuses the operator, so
        the set is taken from (at most) the two best cases of a single category.
        """
        if not similar:
            return []
        votes: dict[str, float] = {}
        for case, score in similar:
            votes[case.categoria] = votes.get(case.categoria, 0.0) + score
        best = max(votes, key=lambda cat: votes[cat])
        return Copilot._questions_of([c for c, _ in similar if c.categoria == best][:2])

    @staticmethod
    def _questions_of(cases: list[ReferenceCase]) -> list[str]:
        seen: dict[str, str] = {}
        for case in cases:
            for q in case.preguntas_mandatorias + case.preguntas_pendientes:
                seen.setdefault(fold(q), q)
        return list(seen.values())[:MAX_QUESTIONS]

    def _ground(self, field: ExtractedField, transcript: str, street: bool = False) -> GroundedField:
        grounded = field.value is not None and is_grounded(field.evidence or field.value, transcript)
        normalized = None
        if street and field.value:
            normalized = self.gazetteer.match(field.value) or canonical_street(field.value)
        return GroundedField(
            value=field.value, evidence=field.evidence, grounded=grounded, normalized=normalized
        )

    def _build_suggestion(
        self,
        transcript: str,
        raw: RawExtraction,
        ctx: ExtractionContext,
        provider_name: str,
        warnings: list[str],
    ) -> CopilotSuggestion:
        calle = self._ground(raw.calle, transcript, street=True)
        altura = self._ground(raw.altura, transcript)
        interseccion = self._ground(raw.interseccion, transcript)
        barrio = self._ground(raw.barrio, transcript)

        # Anchor = most similar reference case of the *final* category. Protocol
        # questions, pre-arrival instructions and resources all come from it, so the
        # panel never mixes protocols of different incident types.
        anchor, anchor_score = next(
            ((c, sc) for c, sc in ctx.similar_cases if c.categoria == raw.categoria), (None, 0.0)
        )
        answers = list(raw.checklist)
        questions = ctx.candidate_questions
        if anchor and not {fold(q) for q in self._questions_of([anchor])} & {fold(q) for q in questions}:
            # The provider chose another category than the pre-selected protocol.
            questions = self._questions_of([anchor])
            answers = [MockProvider.answer_question(q, transcript) for q in questions]
            warnings.append("Checklist recalculado para la categoría final (respuestas por reglas).")
        if anchor is None:
            warnings.append("Sin caso de referencia para esta categoría: aplicar protocolo general.")

        # Only protocol questions from the catalog survive; invented ones are dropped.
        allowed = {fold(q): q for q in questions}
        by_question = {fold(a.question): a for a in answers}
        checklist: list[ChecklistItem] = []
        for key, question in allowed.items():
            ans = by_question.get(key)
            grounded = bool(ans and ans.answered and is_grounded(ans.evidence, transcript))
            checklist.append(
                ChecklistItem(
                    question=question,
                    answered=bool(ans and ans.answered),
                    answer=ans.answer if ans else None,
                    evidence=ans.evidence if ans else None,
                    grounded=grounded,
                )
            )
        if dropped := set(by_question) - set(allowed):
            warnings.append(f"Se descartaron {len(dropped)} preguntas no pertenecientes al protocolo.")

        if not calle.value:
            warnings.append("No se detectó la calle: confirmar dirección con el llamante.")
        elif not calle.grounded:
            warnings.append("La calle sugerida no figura literalmente en el relato: verificar.")
        if not altura.value and not interseccion.value:
            warnings.append("Falta altura o intersección para ubicar el hecho.")
        if anchor_score < MIN_SIMILARITY:
            warnings.append("Tipificación con baja similitud a casos conocidos: revisar categoría.")
        if anchor and raw.prioridad != anchor.prioridad:
            warnings.append(
                f"La prioridad sugerida ({raw.prioridad}) difiere del caso de referencia "
                f"{anchor.id} ({anchor.prioridad})."
            )

        instructions = (
            [s.strip() for s in re.split(r"(?<=\.)\s+", anchor.instrucciones_prearribo) if s.strip()]
            if anchor
            else []
        )

        return CopilotSuggestion(
            provider=provider_name,
            calle=calle,
            altura=altura,
            interseccion=interseccion,
            barrio=barrio,
            categoria=raw.categoria,
            subcategoria=raw.subcategoria,
            prioridad=raw.prioridad,
            prioridad_justificacion=raw.prioridad_justificacion,
            checklist=checklist,
            instrucciones_prearribo=instructions,
            riesgos=raw.riesgos,
            recursos_sugeridos=anchor.recursos if anchor else "",
            resumen=raw.resumen,
            confidence=self._confidence(calle.grounded, altura.grounded or interseccion.grounded, anchor_score, checklist, provider_name),
            warnings=warnings,
            similar_cases=[
                SimilarCase(id=c.id, subcategoria=c.subcategoria, prioridad=c.prioridad, score=round(s, 3))
                for c, s in ctx.similar_cases
            ],
        )

    @staticmethod
    def _confidence(
        street_ok: bool, location_ok: bool, top_score: float, checklist: list[ChecklistItem], provider: str
    ) -> float:
        """Heuristic certainty score shown to the operator (not a calibrated probability)."""
        answered = [c for c in checklist if c.answered]
        grounded_ratio = (sum(c.grounded for c in answered) / len(answered)) if answered else 1.0
        score = (
            0.30 * street_ok
            + 0.15 * location_ok
            + 0.35 * min(top_score / 0.35, 1.0)
            + 0.20 * grounded_ratio
        )
        if provider.startswith("mock"):
            score *= 0.9  # rules are brittler than an LLM on unseen phrasing
        return round(min(max(score, 0.0), 1.0), 2)
