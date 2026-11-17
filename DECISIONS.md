# Memoria de decisiones

## Principios de producto

- **El copiloto sugiere, el operador decide.** Toda sugerencia es editable y nada se deriva
  sin acción explícita. Los recursos se muestran como referencia: el despacho lo decide el
  despachador en el CAD, no el operador.
- **Menos lectura bajo estrés.** Lo accionable primero: alertas, prioridad, ubicación,
  instrucciones a leer en voz alta (grandes, en rojo) y preguntas pendientes antes que las
  respondidas.
- **Mostrar el nivel de certeza** por campo (✓ con evidencia / ⚠ verificar / "no mencionado")
  y un puntaje global heurístico.

## Control de alucinaciones

1. **Evidencia obligatoria:** el esquema pide, para cada dato, un fragmento literal de la
   transcripción. El backend verifica que ese fragmento exista (comparación insensible a
   tildes y mayúsculas, con tolerancia a diferencias menores). Si no aparece, el campo se marca
   como no verificado y se genera una alerta.
2. **Las preguntas de protocolo no las inventa el modelo:** salen del catálogo (dataset). El
   modelo solo marca cuáles ya se respondieron; las que devuelva fuera de la lista se descartan.
3. **Instrucciones de pre-arribo y recursos** salen del caso de referencia de la categoría
   final (texto curado), no de generación libre.
4. **Salida estructurada validada con Pydantic.** Si el proveedor falla (error de red, rate
   limit, rechazo, JSON inválido, truncado) se degrada al modo reglas con una alerta visible,
   en vez de romper el flujo del operador.

## Proveedor dual

- `LLM_PROVIDER=mock` (o sin `ANTHROPIC_API_KEY`): reglas determinísticas, offline y gratis.
- `LLM_PROVIDER=anthropic`: Claude vía `messages.parse` con el modelo Pydantic como formato de
  salida, más few-shot con los 5 casos más similares del dataset. Se habilita el *fallback*
  del lado del servidor (`fallbacks="default"`) por si el modelo principal rechaza la
  solicitud.
- La interfaz `ExtractionProvider` permite sumar OpenAI/Gemini/Ollama sin tocar el orquestador.

## Uso del dataset

- Con 30 filas no se justifica un vector store: TF-IDF en Python puro alcanza y es
  determinístico. La interfaz `CaseRetriever.search` permite cambiarlo por embeddings.
- El retrieval excluye la transcripción idéntica (**leave-one-out**) para no "recuperar la
  respuesta" al probar con filas del propio dataset.
- Las calles del dataset funcionan como nomenclador mínimo para normalizar
  ("Scalabrini Ortiz" → "Av. Raúl Scalabrini Ortiz").

### Línea base del modo simulado (leave-one-out sobre las 30 filas)

| Métrica | Aciertos |
|---|---|
| Categoría | 23/30 |
| Prioridad | 20/30 |
| Calle detectada | 24/30 |

La subcategoría casi nunca coincide en leave-one-out porque cada una aparece una sola vez en el
dataset; por eso el panel la muestra como sugerencia editable y alerta cuando la similitud es baja.
El modo reglas además escala a P1 ante señales de alarma ("no respira", "atrapado",
"olor a gas"...), lo que genera algo de sobre-triage: en emergencias se prefiere ese error al
inverso.

## Trade-offs asumidos

- Panel en HTML/JS sin framework ni build: cero fricción en `docker compose up`, a costa de
  menos estructura en el front.
- SQLite guarda la carta como JSON: suficiente para el prototipo, sin migraciones.
- El puntaje de certeza es heurístico (no calibrado).
- La extracción por regex del modo simulado falla con direcciones sin número ni
  "X y Y" (autopistas, estaciones de subte, parques).

## Con más tiempo

- Nomenclador oficial (USIG/BA Data) + geocodificación y mapa con el punto.
- Modo "en vivo": re-analizar a medida que entran turnos de diálogo, con diff de qué cambió.
- Set de evaluación con transcripciones nuevas (ruido, modismos, datos contradictorios) y
  métricas por campo para el modo LLM; calibrar el puntaje de certeza.
- Protocolos como catálogo propio versionado (por subcategoría) en vez de derivarlos del dataset.
- Auditoría: guardar la sugerencia original junto con lo que corrigió el operador (sirve como
  feedback para mejorar el modelo).
- Autenticación de operadores y trazabilidad por puesto.
