"""Address normalization against a street gazetteer (built from the dataset).

In production the gazetteer would be the official CABA street registry (USIG) and
the result would be geocoded; here we keep it local and deterministic.
"""

from __future__ import annotations

import re
from difflib import get_close_matches

from app.text import fold

_PREFIXES = {
    "avenida": "Av.",
    "av": "Av.",
    "av.": "Av.",
    "avda": "Av.",
    "autopista": "Autopista",
    "au": "Autopista",
}


def canonical_street(raw: str) -> str:
    words = raw.strip().split()
    if not words:
        return raw
    first = _PREFIXES.get(words[0].lower().rstrip("."), None) or _PREFIXES.get(words[0].lower())
    rest = " ".join(words[1:]) if first else " ".join(words)
    return f"{first} {rest}".strip() if first else rest


class StreetGazetteer:
    def __init__(self, streets: list[str]) -> None:
        self._by_key: dict[str, str] = {}
        for street in streets:
            for name in re.split(r"\s+y\s+|/", street):
                name = name.strip()
                if name:
                    self._by_key[self._key(name)] = name

    @staticmethod
    def _key(name: str) -> str:
        folded = fold(name)
        folded = re.sub(r"^(av\.?|avenida|avda\.?)\s+", "", folded)
        return re.sub(r"[^a-z0-9 ]", "", folded).strip()

    def match(self, raw: str | None, cutoff: float = 0.8) -> str | None:
        """Phonetic-ish fuzzy match ('Scalabrini Ortis' -> 'Av. Raúl Scalabrini Ortiz')."""
        if not raw:
            return None
        key = self._key(raw)
        if key in self._by_key:
            return self._by_key[key]
        # Allow matching on a suffix ("scalabrini ortiz" vs "raul scalabrini ortiz").
        for k, v in self._by_key.items():
            if key and (k.endswith(key) or key.endswith(k)) and len(key) >= 5:
                return v
        close = get_close_matches(key, list(self._by_key), n=1, cutoff=cutoff)
        return self._by_key[close[0]] if close else None
