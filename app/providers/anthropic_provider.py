"""Claude-backed provider (LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY).

Uses structured outputs (`output_format=<pydantic model>`) so the response is
schema-validated by the SDK; anything else raises ProviderError and the
orchestrator falls back to the mock.
"""

from __future__ import annotations

import anthropic

from app.providers.base import ExtractionContext, ProviderError
from app.schemas import RawExtraction

SYSTEM_PROMPT = """\
Sos un copiloto para operadores de una central de emergencias de la Ciudad de Buenos Aires.
Recibís la desgrabación de una llamada (puede tener modismos rioplatenses, ruido y datos incompletos).
Tu tarea es EXTRAER, no inventar:
- Para cada dato (calle, altura, intersección, barrio) devolvé el valor y un fragmento LITERAL de la
  transcripción como evidencia. Si el dato no está en el relato, devolvé value=null y evidence=null.
- Clasificá categoría, subcategoría y prioridad (P1 riesgo de vida inmediato ... P4 sin urgencia).
  Usá los casos de referencia como guía de criterio, no copies sus datos.
- Checklist: para CADA pregunta de la lista provista indicá si el relato ya la responde, con la
  respuesta breve y evidencia literal. No agregues ni reformules preguntas.
- El resumen es para el despachador: una o dos líneas, sin adjetivos innecesarios.
"""


def _render_examples(ctx: ExtractionContext) -> str:
    blocks = []
    for case, _score in ctx.similar_cases:
        blocks.append(
            f"<caso id='{case.id}'>\n"
            f"transcripcion: {case.transcripcion}\n"
            f"categoria: {case.categoria} | subcategoria: {case.subcategoria} | prioridad: {case.prioridad}\n"
            f"ubicacion: {case.calle} {case.altura} ({case.interseccion}) - {case.barrio_comuna}\n"
            f"</caso>"
        )
    return "\n".join(blocks)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str, client: anthropic.Anthropic | None = None) -> None:
        self.model = model
        self.client = client or anthropic.Anthropic(max_retries=2, timeout=30.0)

    def extract(self, transcript: str, ctx: ExtractionContext) -> RawExtraction:
        questions = "\n".join(f"- {q}" for q in ctx.candidate_questions)
        user = (
            f"<casos_de_referencia>\n{_render_examples(ctx)}\n</casos_de_referencia>\n\n"
            f"<preguntas_protocolo>\n{questions}\n</preguntas_protocolo>\n\n"
            f"<transcripcion>\n{transcript}\n</transcripcion>"
        )
        try:
            response = self.client.beta.messages.parse(
                model=self.model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user}],
                output_format=RawExtraction,
                # Server-side fallback if the primary model declines the request.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as exc:
            raise ProviderError(f"Rate limit del proveedor LLM: {exc}") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(f"Error del proveedor LLM ({exc.status_code})") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("Sin conexión con el proveedor LLM") from exc

        if response.stop_reason == "refusal":
            raise ProviderError("El modelo rechazó la solicitud")
        if response.stop_reason == "max_tokens":
            raise ProviderError("Respuesta truncada (max_tokens)")
        if response.parsed_output is None:
            raise ProviderError("Respuesta sin JSON válido")
        return response.parsed_output
