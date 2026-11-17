"""FastAPI app: JSON API + static operator panel."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, load_settings
from app.copilot import Copilot
from app.dataset import cached_catalog
from app.providers import build_provider
from app.schemas import AnalyzeRequest, CallCard, CallCardIn, CopilotSuggestion
from app.store import CardStore

logging.basicConfig(level=logging.INFO)
STATIC_DIR = Path(__file__).parent / "static"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    catalog = cached_catalog(str(settings.dataset_path))
    copilot = Copilot(catalog, build_provider(settings))
    store = CardStore(settings.db_path)

    app = FastAPI(title="Soflex · Copiloto de Operador", version="0.1.0")

    @app.get("/api/health")
    def health() -> dict[str, str | int]:
        return {"status": "ok", "provider": copilot.provider.name, "catalog_size": len(catalog)}

    @app.get("/api/samples")
    def samples() -> list[dict[str, str]]:
        """Dataset transcripts to demo the flow without typing."""
        return [
            {"id": c.id, "label": f"{c.id} · {c.subcategoria}", "transcript": c.transcripcion}
            for c in catalog
        ]

    @app.post("/api/analyze", response_model=CopilotSuggestion)
    def analyze(req: AnalyzeRequest) -> CopilotSuggestion:
        return copilot.analyze(req.transcript)

    @app.post("/api/cards", response_model=CallCard, status_code=201)
    def create_card(card: CallCardIn) -> CallCard:
        return store.create(card)

    @app.get("/api/cards", response_model=list[CallCard])
    def list_cards() -> list[CallCard]:
        return store.list()

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()
