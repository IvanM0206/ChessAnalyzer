"""Deterministic rules-based provider (LLM_PROVIDER=mock). Offline and free.

It is intentionally simple: regexes for the address, nearest-neighbor over the
catalog for the incident type, keyword overlap for the checklist, and a small set
of red-flag keywords that escalate priority.
"""

from __future__ import annotations

import re

from app.providers.base import ExtractionContext
from app.schemas import Category, ChecklistAnswer, ExtractedField, Priority, RawExtraction, ReferenceCase
from app.text import fold, tokens

_UP = r"A-ZÁÉÍÓÚÑ"
_WORD = rf"[{_UP}0-9][\wáéíóúñ]*"
_ABBR = r"(?:Av\.?|Avenida|Gral\.|Pte\.|Dr\.)\s+"
_NAME = rf"(?:{_ABBR})?[{_UP}][\wáéíóúñ]*(?:\s+(?:de\s+)?{_WORD}){{0,3}}"
_LEADING_NOISE = re.compile(r"^(?:En|Es|La|El|Los|Las|Estoy|Acá|Hay)\s+")

STREET_NUMBER_RE = re.compile(rf"({_NAME})\s+(?:al\s+)?(\d{{3,5}})\b")
CASI_RE = re.compile(rf"\b(?:casi|esquina)\s+({_NAME})")
ENTRE_RE = re.compile(rf"\bentre\s+({_NAME})\s+y\s+({_NAME})")
CORNER_RE = re.compile(rf"(?:\b(?:en|de)|,)\s+({_NAME})\s+y\s+({_NAME})")

# Subset of CABA neighbourhoods; enough for the sketch.
BARRIOS = [
    "Agronomía", "Almagro", "Balvanera", "Barracas", "Belgrano", "Boedo", "Caballito",
    "Chacarita", "Coghlan", "Colegiales", "Constitución", "Flores", "Floresta", "La Boca",
    "Liniers", "Mataderos", "Monserrat", "Nueva Pompeya", "Núñez", "Palermo",
    "Parque Patricios", "Puerto Madero", "Recoleta", "Retiro", "Saavedra", "San Cristóbal",
    "San Nicolás", "San Telmo", "Villa Crespo", "Villa Devoto", "Villa Lugano",
    "Villa Soldati", "Soldati", "Villa Urquiza",
]

# Stem lexicon per category: complements nearest-neighbour voting, which is weak
# with a 30-row catalog where most subcategories appear only once.
CATEGORY_LEXICON: dict[Category, list[str]] = {
    Category.INCENDIO_RESCATE: ["fuego", "incend", "llama", "humo", "bomber", "prend", "ascensor", "rescat", "explot"],
    Category.ACCIDENTE_VIAL: ["choc", "colisi", "moto", "taxi", "colectivo", "camion", "atropell", "volc", "autopista", "ciclist"],
    Category.EMERGENCIA_MEDICA: ["same", "paciente", "respir", "desmay", "convuls", "alergi", "fractur", "dolor", "concien", "ambulan"],
    Category.DEFENSA_CIVIL: ["arbol", "derrumb", "inund", "anega", "marquesin", "medianer", "temporal", "fuga", "gas"],
    Category.SERVICIOS_PUBLICOS: ["semafor", "cable", "socavon", "pozo", "agua", "luz", "cloac", "poste"],
    Category.CONVIVENCIA_SEGURIDAD: ["pelea", "perro", "robo", "disturb", "botella", "agresi", "arma"],
}

# Red flags -> P1 regardless of the nearest neighbour.
P1_FLAGS = [
    "no respira", "no responde", "no se mueve", "atrapad", "quedo adentro", "labios morados",
    "convulsion", "se le esta cerrando la garganta", "exploto", "explosion", "chispeando",
    "olor a gas", "fuga de gas", "inconsciente", "sangrando mucho", "humo negro",
]


def _caller_text(transcript: str) -> str:
    """Drop the operator greeting; the address is what the caller says."""
    parts = re.split(r"Llamante\s*:", transcript, maxsplit=1)
    return parts[1] if len(parts) == 2 else transcript


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[\.\!\?,])\s+", text) if s.strip()]


class MockProvider:
    name = "mock"

    def extract(self, transcript: str, ctx: ExtractionContext) -> RawExtraction:
        caller = _caller_text(transcript)
        calle, altura, interseccion = self._address(caller)
        barrio = self._barrio(caller)

        categoria = self._classify(transcript, ctx)
        same_cat = [c for c, _ in ctx.similar_cases if c.categoria == categoria]
        top: ReferenceCase | None = same_cat[0] if same_cat else None
        prioridad = top.prioridad if top else Priority.P3
        justification = (
            f"Prioridad del caso de referencia más similar ({top.id})." if top else "Sin referencia."
        )
        flag = next((f for f in P1_FLAGS if f in fold(transcript)), None)
        if flag and prioridad != Priority.P1:
            prioridad = Priority.P1
            justification = f"Escalado a P1 por señal de alarma en el relato: '{flag}'."

        return RawExtraction(
            calle=calle,
            altura=altura,
            interseccion=interseccion,
            barrio=barrio,
            categoria=categoria,
            subcategoria=top.subcategoria if top else "Sin subcategoría de referencia",
            prioridad=prioridad,
            prioridad_justificacion=justification,
            checklist=[self.answer_question(q, transcript) for q in ctx.candidate_questions],
            riesgos=list(top.riesgos) if top else [],
            resumen=_sentences(caller)[0][:200] if caller.strip() else "",
        )

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _classify(transcript: str, ctx: ExtractionContext) -> Category:
        words = re.findall(r"[a-z0-9]+", fold(transcript))
        scores: dict[Category, float] = {cat: 0.0 for cat in Category}
        for cat, stems in CATEGORY_LEXICON.items():
            scores[cat] += sum(1.0 for w in words for st in stems if w.startswith(st))
        for case, sim in ctx.similar_cases:
            scores[case.categoria] += 4.0 * sim
        return max(scores, key=lambda c: scores[c])

    @staticmethod
    def _address(text: str) -> tuple[ExtractedField, ExtractedField, ExtractedField]:
        calle = altura = inter = ExtractedField()
        if m := STREET_NUMBER_RE.search(text):
            calle = ExtractedField(value=_LEADING_NOISE.sub("", m.group(1).strip()), evidence=m.group(0))
            altura = ExtractedField(value=m.group(2), evidence=m.group(0))
        if m := ENTRE_RE.search(text):
            inter = ExtractedField(value=f"{m.group(1)} y {m.group(2)}", evidence=m.group(0))
        elif m := CASI_RE.search(text):
            inter = ExtractedField(value=m.group(1).strip(), evidence=m.group(0))
        if (m := CORNER_RE.search(text)) and (calle.value is None or inter.value is None):
            if calle.value is None:
                calle = ExtractedField(value=m.group(1).strip(), evidence=m.group(0))
                inter = ExtractedField(value=m.group(2).strip(), evidence=m.group(0))
            else:
                inter = ExtractedField(value=m.group(2).strip(), evidence=m.group(0))
        return calle, altura, inter

    @staticmethod
    def _barrio(text: str) -> ExtractedField:
        # Require "en <barrio>" / "barrio <barrio>" to avoid false hits ("espuma en la boca").
        folded = fold(text)
        for barrio in sorted(BARRIOS, key=len, reverse=True):
            name = fold(barrio)
            if m := re.search(rf"\b(?:en|barrio(?: de)?)\s+{re.escape(name)}\b", folded):
                if name == "la boca" and not m.group(0).startswith("barrio"):
                    continue  # "espuma en la boca" is not a neighbourhood
                return ExtractedField(value=barrio, evidence=text[m.start():m.end()])
        return ExtractedField()

    @staticmethod
    def answer_question(question: str, transcript: str) -> ChecklistAnswer:
        caller = _caller_text(transcript)
        q_stems = {t[:5] for t in tokens(question)}
        best, best_overlap = None, 0.0
        for sentence in _sentences(caller):
            overlap = len(q_stems & {t[:5] for t in tokens(sentence)}) / (len(q_stems) or 1)
            if overlap > best_overlap:
                best, best_overlap = sentence, overlap
        answered = best is not None and best_overlap >= 0.3
        return ChecklistAnswer(
            question=question,
            answered=answered,
            answer=best if answered else None,
            evidence=best if answered else None,
        )
