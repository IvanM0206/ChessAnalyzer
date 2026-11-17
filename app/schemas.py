"""Domain schemas. Everything crossing a boundary (LLM, API, DB) is validated here."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Priority(StrEnum):
    P1 = "P1"  # life at immediate risk
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"  # no urgency


class Category(StrEnum):
    INCENDIO_RESCATE = "INCENDIO_RESCATE"
    ACCIDENTE_VIAL = "ACCIDENTE_VIAL"
    EMERGENCIA_MEDICA = "EMERGENCIA_MEDICA"
    DEFENSA_CIVIL = "DEFENSA_CIVIL"
    SERVICIOS_PUBLICOS = "SERVICIOS_PUBLICOS"
    CONVIVENCIA_SEGURIDAD = "CONVIVENCIA_SEGURIDAD"


# --------------------------------------------------------------------------- #
# Reference catalog (built from the provided dataset)
# --------------------------------------------------------------------------- #
class ReferenceCase(BaseModel):
    id: str
    origen: str
    categoria: Category
    subcategoria: str
    prioridad: Priority
    transcripcion: str
    calle: str
    altura: str
    interseccion: str
    barrio_comuna: str
    preguntas_mandatorias: list[str]
    preguntas_pendientes: list[str]
    instrucciones_prearribo: str
    riesgos: list[str]
    recursos: str
    notas: str


# --------------------------------------------------------------------------- #
# Raw LLM / extractor output. Kept flat and simple so it works as a JSON schema
# for structured outputs. Every claim carries an evidence quote from the call.
# --------------------------------------------------------------------------- #
class ExtractedField(BaseModel):
    value: str | None = Field(None, description="Valor extraído, o null si no se menciona.")
    evidence: str | None = Field(
        None, description="Fragmento textual literal de la transcripción que respalda el valor."
    )


class ChecklistAnswer(BaseModel):
    question: str = Field(description="Pregunta de protocolo, copiada tal cual de la lista provista.")
    answered: bool
    answer: str | None = Field(None, description="Respuesta breve según el relato.")
    evidence: str | None = Field(None, description="Fragmento literal de la transcripción.")


class RawExtraction(BaseModel):
    calle: ExtractedField
    altura: ExtractedField
    interseccion: ExtractedField
    barrio: ExtractedField
    categoria: Category
    subcategoria: str
    prioridad: Priority
    prioridad_justificacion: str
    checklist: list[ChecklistAnswer]
    riesgos: list[str]
    resumen: str = Field(description="Resumen operativo de una o dos líneas para el despachador.")


# --------------------------------------------------------------------------- #
# What the operator panel receives: raw extraction + grounding + catalog data
# --------------------------------------------------------------------------- #
class GroundedField(BaseModel):
    value: str | None
    evidence: str | None
    grounded: bool = Field(description="True si la evidencia aparece en la transcripción.")
    normalized: str | None = None


class ChecklistItem(BaseModel):
    question: str
    answered: bool
    answer: str | None = None
    evidence: str | None = None
    grounded: bool = False


class SimilarCase(BaseModel):
    id: str
    subcategoria: str
    prioridad: Priority
    score: float


class CopilotSuggestion(BaseModel):
    provider: str
    calle: GroundedField
    altura: GroundedField
    interseccion: GroundedField
    barrio: GroundedField
    categoria: Category
    subcategoria: str
    prioridad: Priority
    prioridad_justificacion: str
    checklist: list[ChecklistItem]
    instrucciones_prearribo: list[str]
    riesgos: list[str]
    recursos_sugeridos: str
    resumen: str
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    similar_cases: list[SimilarCase] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# API payloads
# --------------------------------------------------------------------------- #
class AnalyzeRequest(BaseModel):
    transcript: str = Field(min_length=10, max_length=20_000)


class CallCardIn(BaseModel):
    """The validated 'Carta de Llamada' the operator derives to dispatch."""

    transcript: str
    calle: str = Field(min_length=1)
    altura: str | None = None
    interseccion: str | None = None
    barrio: str | None = None
    categoria: Category
    subcategoria: str
    prioridad: Priority
    preguntas_respondidas: list[str] = Field(default_factory=list)
    preguntas_pendientes: list[str] = Field(default_factory=list)
    instrucciones_transmitidas: list[str] = Field(default_factory=list)
    riesgos: list[str] = Field(default_factory=list)
    recursos_sugeridos: str | None = None
    notas_operador: str | None = None
    ai_confidence: float | None = None
    ai_provider: str | None = None


class CallCard(CallCardIn):
    id: int
    created_at: datetime
