import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Tests never hit a real LLM, even if the developer has a key exported.
os.environ["LLM_PROVIDER"] = "mock"
