from app.config import ProviderName, Settings
from app.providers.base import ExtractionContext, ExtractionProvider, ProviderError
from app.providers.mock import MockProvider

__all__ = ["ExtractionContext", "ExtractionProvider", "ProviderError", "MockProvider", "build_provider"]


def build_provider(settings: Settings) -> ExtractionProvider:
    if settings.llm_provider == ProviderName.ANTHROPIC:
        from app.providers.anthropic_provider import AnthropicProvider

        return AnthropicProvider(model=settings.anthropic_model)
    return MockProvider()
