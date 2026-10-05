"""Local pretrained inference. Values are relative inverse depth, never meters."""

from dataclasses import dataclass
import hashlib
import io
import platform
import time

import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

from depthlab import MODEL_ID, MODEL_PATH, MODEL_REVISION


def load_rgb(source, max_edge=1600):
    """Orient RGB correctly and bound display/output size; preserve aspect ratio."""
    image = Image.open(source) if not isinstance(source, Image.Image) else source
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    if min(image.size) < 28:
        raise ValueError("Image must be at least 28 pixels on each side.")
    if max(image.size) / min(image.size) > 4:
        raise ValueError("Please crop panoramas to an aspect ratio of 4:1 or less.")
    return image


def image_digest(image):
    h = hashlib.sha256()
    h.update(str(image.size).encode())
    h.update(image.convert("RGB").tobytes())
    return h.hexdigest()


def select_device(requested="auto"):
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else (
            "mps" if torch.backends.mps.is_available() else "cpu"
        )
    if requested == "mps" and not torch.backends.mps.is_available():
        raise ValueError("Apple MPS is unavailable on this computer.")
    if requested == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable on this computer.")
    if requested not in {"mps", "cuda", "cpu"}:
        raise ValueError(f"Unknown device: {requested}")
    return requested


def synchronize(device):
    if device == "mps":
        torch.mps.synchronize()
    elif device == "cuda":
        torch.cuda.synchronize()


@dataclass
class Prediction:
    inverse_depth: np.ndarray
    seconds: float
    input_shape: tuple
    device: str


class DepthEngine:
    def __init__(self, device="auto"):
        if not (MODEL_PATH / "model.safetensors").exists():
            raise FileNotFoundError("Model missing. Run: uv run python scripts/prepare.py")
        self.device = select_device(device)
        started = time.perf_counter()
        self.processor = AutoImageProcessor.from_pretrained(
            str(MODEL_PATH), local_files_only=True, use_fast=False
        )
        self.model = AutoModelForDepthEstimation.from_pretrained(
            str(MODEL_PATH), local_files_only=True
        ).to(self.device).eval()
        if self.model.config.depth_estimation_type != "relative":
            raise ValueError("This demo requires the pinned relative-depth checkpoint.")
        synchronize(self.device)
        self.load_seconds = time.perf_counter() - started

    def predict(self, image, input_size=518):
        if input_size not in {252, 392, 518, 700}:
            raise ValueError("Input size must be one of 252, 392, 518, 700.")
        synchronize(self.device)
        started = time.perf_counter()
        inputs = self.processor(
            images=image, return_tensors="pt",
            size={"height": input_size, "width": input_size},
        ).to(self.device)
        shape = tuple(inputs["pixel_values"].shape)
        with torch.inference_mode():
            outputs = self.model(**inputs)
            # Same explicit interpolation as the official HF model card. Bicubic
            # interpolation may overshoot slightly; retain raw values for analysis.
            predicted = torch.nn.functional.interpolate(
                outputs.predicted_depth.unsqueeze(1),
                size=(image.height, image.width), mode="bicubic", align_corners=False,
            )[0, 0].float().cpu().numpy()
        synchronize(self.device)
        seconds = time.perf_counter() - started
        if predicted.shape != (image.height, image.width) or not np.isfinite(predicted).all():
            raise ValueError("Model produced an invalid depth map.")
        return Prediction(predicted, seconds, shape, self.device)

    def metadata(self):
        import transformers
        return {
            "model_id": MODEL_ID, "model_revision": MODEL_REVISION,
            "parameters": sum(p.numel() for p in self.model.parameters()),
            "device": self.device, "torch": torch.__version__,
            "transformers": transformers.__version__, "python": platform.python_version(),
            "platform": platform.platform(), "model_load_seconds": self.load_seconds,
            "output_semantics": "relative inverse depth; higher = closer; arbitrary units",
            "implementation": "Hugging Face Transformers; Pillow preprocessing; bicubic upsampling",
            "timing_scope": "synchronized preprocessing + forward pass + upsampling + CPU transfer; excludes model loading, file I/O and plotting",
        }


def npy_bytes(array):
    buffer = io.BytesIO()
    np.save(buffer, array, allow_pickle=False)
    return buffer.getvalue()
