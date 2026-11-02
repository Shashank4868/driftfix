import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-test-not-a-real-key")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
