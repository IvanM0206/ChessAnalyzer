# Soflex · Copiloto para Operadores de Sala (bosquejo inicial)

Prototipo que procesa la transcripción de una llamada de emergencia y asiste al operador:
extrae la ubicación, sugiere tipificación y prioridad, arma el checklist de protocolo
(qué ya se respondió y qué falta preguntar), muestra las instrucciones de pre-arribo y
permite validar todo y **derivar la Carta de Llamada**.

> Estado: **bosquejo**. El flujo punta a punta funciona en modo simulado; ver
> [DECISIONS.md](DECISIONS.md) para supuestos, trade-offs y próximos pasos.

## Levantar

```bash
docker compose up --build
# abrir http://localhost:8000
```

Sin credenciales corre en **modo simulado** (`LLM_PROVIDER=mock`, reglas determinísticas, offline).
Para usar Claude:

```bash
cp .env.example .env   # completar ANTHROPIC_API_KEY y LLM_PROVIDER=anthropic
docker compose up --build
```

### Sin Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
pytest
```

## Uso

1. Elegí una transcripción de ejemplo (del dataset) o pegá una nueva.
2. **Analizar** (`Ctrl+Enter`).
3. Revisá: los campos con ✓ tienen evidencia literal en el relato; los ⚠ hay que verificarlos.
   El checklist muestra primero las preguntas pendientes.
4. Leé las instrucciones de pre-arribo al llamante.
5. Corregí lo que haga falta y **Derivar Carta de Llamada** (`Ctrl+S`).

## Estructura

```
app/
  main.py              FastAPI: /api/analyze, /api/cards, /api/samples, panel estático
  copilot.py           Orquestador: retrieval → proveedor → grounding/validación → sugerencia
  schemas.py           Modelos Pydantic (salida LLM, sugerencia, carta de llamada)
  providers/
    mock.py            Proveedor determinístico (regex + vecinos cercanos + léxico)
    anthropic_provider.py  Proveedor Claude con structured outputs
  retrieval.py         TF-IDF sobre el dataset (few-shot + selección de protocolo)
  normalization.py     Normalización de calles contra un nomenclador
  text.py              Normalización de texto y verificación de evidencia
  store.py             SQLite para cartas derivadas
  static/              Panel del operador (HTML/CSS/JS sin build)
data/                  Dataset provisto
tests/                 pytest
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado y proveedor activo |
| GET | `/api/samples` | Transcripciones de ejemplo |
| POST | `/api/analyze` | `{transcript}` → `CopilotSuggestion` |
| POST | `/api/cards` | Deriva una carta validada por el operador |
| GET | `/api/cards` | Últimas cartas derivadas |

Documentación interactiva en `http://localhost:8000/docs`.
