"""Loads the provided CSV into a typed reference catalog."""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from app.schemas import ReferenceCase


def _split(value: str, sep: str = "|") -> list[str]:
    return [part.strip() for part in value.split(sep) if part.strip()]


def load_catalog(path: Path) -> list[ReferenceCase]:
    cases: list[ReferenceCase] = []
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if not row.get("id_registro"):
                continue  # trailing empty lines
            cases.append(
                ReferenceCase(
                    id=row["id_registro"],
                    origen=row["origen_reporte"],
                    categoria=row["categoria"],
                    subcategoria=row["subcategoria"],
                    prioridad=row["prioridad_sugerida"],
                    transcripcion=row["transcripcion_cruda"],
                    calle=row["calle_detectada"],
                    altura=row["altura_detectada"],
                    interseccion=row["interseccion_detectada"],
                    barrio_comuna=row["barrio_comuna"],
                    preguntas_mandatorias=_split(row["preguntas_protocolo_mandatorias"]),
                    preguntas_pendientes=_split(row["preguntas_pendientes"]),
                    instrucciones_prearribo=row["instrucciones_prearribo"],
                    riesgos=_split(row["riesgos_detectados"], ","),
                    recursos=row["recursos_recomendados_despacho"],
                    notas=row["notas_operativas_despacho"],
                )
            )
    return cases


@lru_cache(maxsize=4)
def cached_catalog(path: str) -> tuple[ReferenceCase, ...]:
    return tuple(load_catalog(Path(path)))
