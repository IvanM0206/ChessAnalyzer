from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import ProviderName, Settings
from app.copilot import Copilot
from app.dataset import load_catalog
from app.main import create_app
from app.providers import ExtractionContext, MockProvider, ProviderError
from app.schemas import ChecklistAnswer, RawExtraction
from app.text import is_grounded

DATASET = Path(__file__).resolve().parent.parent / "data" / "dataset_challenge_soflex.csv"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATASET)


def test_catalog_loads_all_rows(catalog):
    assert len(catalog) == 30
    assert all(c.preguntas_mandatorias for c in catalog)


def test_grounding_detects_literal_and_rejects_invented():
    transcript = "Llamante: se prendió fuego la campana en Av. Corrientes 1540 casi Montevideo"
    assert is_grounded("Av. Corrientes 1540", transcript)
    assert is_grounded("av corrientes 1540", transcript)  # accent/case/punct-insensitive
    assert not is_grounded("Av. Santa Fe 3200", transcript)
    assert not is_grounded(None, transcript)


def test_mock_extracts_address_from_unseen_call(catalog):
    copilot = Copilot(catalog, MockProvider())
    s = copilot.analyze(
        "Operador: 911. Llamante: Hay olor a gas y humo negro en Av. Rivadavia 5400 casi Acoyte, "
        "una señora quedó atrapada en el segundo piso!"
    )
    assert s.calle.value == "Av. Rivadavia" and s.calle.grounded
    assert s.altura.value == "5400"
    assert s.interseccion.value == "Acoyte"
    assert s.prioridad == "P1"  # red flags escalate
    assert s.checklist and s.instrucciones_prearribo


def test_missing_address_produces_warning(catalog):
    s = Copilot(catalog, MockProvider()).analyze("Llamante: por favor vengan rápido, mi papá no respira")
    assert s.calle.value is None
    assert any("calle" in w.lower() for w in s.warnings)


class _HallucinatingProvider:
    """Simulates an LLM that invents a street and an off-protocol question."""

    name = "fake-llm"

    def extract(self, transcript: str, ctx: ExtractionContext) -> RawExtraction:
        raw = MockProvider().extract(transcript, ctx)
        raw.calle.value, raw.calle.evidence = "Av. Santa Fe", "Av. Santa Fe 3200"
        raw.checklist.append(ChecklistAnswer(question="¿Pregunta inventada?", answered=True))
        return raw


def test_hallucinations_are_flagged_and_filtered(catalog):
    copilot = Copilot(catalog, _HallucinatingProvider())
    s = copilot.analyze(catalog[0].transcripcion)
    assert s.calle.grounded is False
    assert any("verificar" in w for w in s.warnings)
    assert all(item.question != "¿Pregunta inventada?" for item in s.checklist)


class _BrokenProvider:
    name = "broken"

    def extract(self, transcript: str, ctx: ExtractionContext) -> RawExtraction:
        raise ProviderError("JSON malformado")


def test_provider_failure_falls_back_to_mock(catalog):
    s = Copilot(catalog, _BrokenProvider()).analyze(catalog[4].transcripcion)
    assert s.provider.startswith("mock")
    assert any("no disponible" in w for w in s.warnings)


def test_api_end_to_end(tmp_path):
    settings = Settings(
        llm_provider=ProviderName.MOCK,
        anthropic_model="unused",
        dataset_path=DATASET,
        db_path=tmp_path / "test.sqlite3",
    )
    client = TestClient(create_app(settings))
    assert client.get("/api/health").json()["provider"] == "mock"

    transcript = client.get("/api/samples").json()[0]["transcript"]
    suggestion = client.post("/api/analyze", json={"transcript": transcript}).json()

    card = {
        "transcript": transcript,
        "calle": suggestion["calle"]["normalized"],
        "altura": suggestion["altura"]["value"],
        "categoria": suggestion["categoria"],
        "subcategoria": suggestion["subcategoria"],
        "prioridad": suggestion["prioridad"],
    }
    created = client.post("/api/cards", json=card)
    assert created.status_code == 201
    assert client.get("/api/cards").json()[0]["id"] == created.json()["id"]

    assert client.post("/api/cards", json={**card, "calle": ""}).status_code == 422
