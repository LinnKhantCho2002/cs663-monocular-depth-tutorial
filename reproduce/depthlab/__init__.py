"""CS663 monocular depth demonstration."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
MODEL_REVISION = "5426e4f0f36572d16453bbda7a8389317b1bef99"
MODEL_PATH = ROOT / "models" / "depth-anything-v2-small"
