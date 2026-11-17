"""Lightweight lexical retrieval (TF-IDF + cosine) over the reference catalog.

Used for: (1) few-shot examples for the LLM, (2) picking the protocol question set,
(3) classification in mock mode. Pure Python on purpose: 30 rows do not justify a
vector DB, and the interface allows swapping in embeddings later.
"""

from __future__ import annotations

import math
from collections import Counter

from app.schemas import ReferenceCase
from app.text import fold, tokens


class CaseRetriever:
    def __init__(self, cases: list[ReferenceCase] | tuple[ReferenceCase, ...]) -> None:
        self.cases = list(cases)
        docs = [tokens(self._doc_text(c)) for c in self.cases]
        df: Counter[str] = Counter()
        for doc in docs:
            df.update(set(doc))
        n = len(docs)
        self._idf = {term: math.log((1 + n) / (1 + freq)) + 1 for term, freq in df.items()}
        self._vectors = [self._vectorize(doc) for doc in docs]

    @staticmethod
    def _doc_text(case: ReferenceCase) -> str:
        # Subcategory is repeated to weigh the incident type over incidental words.
        return f"{case.subcategoria} {case.subcategoria} {case.transcripcion} {' '.join(case.riesgos)}"

    def _vectorize(self, toks: list[str]) -> dict[str, float]:
        tf = Counter(toks)
        vec = {t: c * self._idf.get(t, 1.0) for t, c in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        return {t: v / norm for t, v in vec.items()}

    def search(
        self, transcript: str, k: int = 3, exclude_exact: bool = True
    ) -> list[tuple[ReferenceCase, float]]:
        query = self._vectorize(tokens(transcript))
        folded = fold(transcript).strip()
        scored: list[tuple[ReferenceCase, float]] = []
        for case, vec in zip(self.cases, self._vectors, strict=True):
            # Leave-one-out: never "retrieve the answer" when testing with dataset rows.
            if exclude_exact and fold(case.transcripcion).strip() == folded:
                continue
            score = sum(w * vec.get(t, 0.0) for t, w in query.items())
            scored.append((case, score))
        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:k]
