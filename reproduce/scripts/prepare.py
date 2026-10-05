"""Fetch pinned model and bounded public samples, preserving provenance.

The original NYU HDF5 and DA-2K ZIP support HTTP ranges, so only selected
records are read; neither entire archive is downloaded.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

import fsspec
import h5py
from huggingface_hub import snapshot_download
import numpy as np
from PIL import Image, ImageDraw
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from depthlab import ROOT, MODEL_ID, MODEL_REVISION, MODEL_PATH

DA_REVISION = "528f83c26f02a6a7a11c5a036dfc9ee19907ebd9"
DA_URL = f"https://huggingface.co/datasets/depth-anything/DA-2K/resolve/{DA_REVISION}/DA-2K.zip"
NYU_URL = "https://horatio.cs.nyu.edu/mit/silberman/nyu_depth_v2/nyu_depth_v2_labeled.mat"
NYU_INDICES = [0, 289, 578, 867, 1156, 1448]
CATEGORIES = ["indoor", "outdoor", "transparent_reflective", "adverse_style", "object"]


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def prepare_model():
    print("Downloading pinned Depth Anything V2 Small (~99 MB)", flush=True)
    snapshot_download(MODEL_ID, revision=MODEL_REVISION, local_dir=MODEL_PATH,
                      allow_patterns=["*.json", "*.safetensors", "README.md"])
    write_json(ROOT / "data/model_provenance.json", {
        "model_id": MODEL_ID, "revision": MODEL_REVISION,
        "license": "Apache-2.0 (Small checkpoint)",
        "files": {p.name: sha256(p) for p in MODEL_PATH.iterdir() if p.is_file()},
    })


def prepare_da2k():
    out = ROOT / "data/samples"
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    print("Reading selected DA-2K records through HTTP ranges", flush=True)
    with fsspec.open(DA_URL, "rb", block_size=2**20) as remote:
        with zipfile.ZipFile(remote) as archive:
            annotations = json.loads(archive.read("DA-2K/annotations.json"))
            for category in CATEGORIES:
                candidates = sorted(p for p in annotations if p.startswith(f"images/{category}/"))
                for index, original in enumerate(candidates[:3], start=1):
                    sample_id = f"da2k_{category}_{index:02d}"
                    path = out / f"{sample_id}.jpg"
                    # Preserve the original JPEG bytes and point coordinates.
                    path.write_bytes(archive.read("DA-2K/" + original))
                    with Image.open(path) as image:
                        width, height = image.size
                    entry = {
                        "id": sample_id, "title": f"{category.replace('_', ' ').title()} · {index:02d}",
                        "category": category, "image": str(path.relative_to(ROOT)),
                        "source": "Depth Anything V2 authors' DA-2K dataset",
                        "source_url": "https://huggingface.co/datasets/depth-anything/DA-2K",
                        "archive_url": DA_URL, "archive_member": original,
                        "revision": DA_REVISION, "sha256": sha256(path),
                        "width": width, "height": height,
                        "annotations": annotations[original],
                    }
                    entries.append(entry)
                    print(sample_id, (width, height), flush=True)
    # A controlled perturbation, explicitly not a real low-light capture.
    baseline = entries[0]
    image = Image.open(ROOT / baseline["image"]).convert("RGB")
    dark = np.round(255 * 0.25 * (np.asarray(image) / 255.0) ** 1.6).astype(np.uint8)
    dark_path = out / "controlled_low_light.png"
    Image.fromarray(dark).save(dark_path)
    entries.append({
        **baseline, "id": "controlled_low_light", "title": "Controlled dimming of Indoor · 01",
        "category": "controlled_low_light", "image": str(dark_path.relative_to(ROOT)),
        "sha256": sha256(dark_path), "derived_from": baseline["id"],
        "transformation": "round(255 * 0.25 * (RGB/255)^1.6); no geometry change",
        "interpretation": "Synthetic lighting stress test; no real sensor noise or exposure effects",
    })
    write_json(ROOT / "data/samples/manifest.json", {
        "selection": "First 3 lexicographically sorted annotated filenames in each of 5 categories; fixed before inference",
        "scope": "15 public images + 1 controlled lighting variant; illustrative subset, not full DA-2K benchmark",
        "retrieved_utc": datetime.now(timezone.utc).isoformat(), "samples": entries,
    })
    contact_sheet(entries, ROOT / "outputs/input_contact_sheet.jpg")


def prepare_nyu():
    out = ROOT / "data/nyu"
    out.mkdir(parents=True, exist_ok=True)
    head = requests.head(NYU_URL, timeout=30)
    head.raise_for_status()
    entries = []
    print("Reading 6 fixed NYU indices through HTTP ranges", flush=True)
    with fsspec.open(NYU_URL, "rb", block_size=2**20) as remote:
        with h5py.File(remote, "r") as data:
            if data["images"].shape != (1449, 3, 640, 480):
                raise ValueError("Unexpected original NYU layout.")
            for index in NYU_INDICES:
                sample_id = f"nyu_{index+1:04d}"
                # HDF5 storage reverses MATLAB dimensions; these transposes
                # recover RGB [H,W,C] and metric depth [H,W].
                rgb = np.asarray(data["images"][index]).transpose(2, 1, 0)
                depth = np.asarray(data["depths"][index], dtype=np.float32).T
                raw = np.asarray(data["rawDepths"][index], dtype=np.float32).T
                scene_ref = data["scenes"][0, index]
                scene = "".join(chr(int(c)) for c in np.asarray(data[scene_ref]).ravel())
                image_path, depth_path = out / f"{sample_id}.png", out / f"{sample_id}_depth.npz"
                Image.fromarray(rgb).save(image_path)
                np.savez_compressed(depth_path, depth_m=depth, raw_depth_m=raw)
                entries.append({
                    "id": sample_id, "title": scene, "category": "nyu",
                    "image": str(image_path.relative_to(ROOT)),
                    "depth": str(depth_path.relative_to(ROOT)),
                    "matlab_index_1_based": index+1, "hdf5_index_0_based": index,
                    "source_url": NYU_URL,
                    "source_homepage": "https://cs.nyu.edu/~fergus/datasets/nyu_depth_v2.html",
                    "image_sha256": sha256(image_path), "depth_sha256": sha256(depth_path),
                    "depth_units": "meters", "depth_type": "official filled depth plus projected raw sensor depth",
                    "split": "illustrative selection across full labeled file; not a verified held-out test split",
                })
                print(sample_id, scene, 'depth range',float(depth.min()),float(depth.max()), flush=True)
    write_json(out / "manifest.json", {
        "selection": "Fixed zero-based indices [0,289,578,867,1156,1448] chosen before inference",
        "source_etag": head.headers.get("ETag"), "source_content_length": head.headers.get("Content-Length"),
        "source_last_modified": head.headers.get("Last-Modified"),
        "retrieved_utc": datetime.now(timezone.utc).isoformat(), "samples": entries,
    })


def contact_sheet(entries, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tile_w, tile_h, columns = 360, 280, 4
    sheet = Image.new("RGB", (tile_w*columns, tile_h*((len(entries)+columns-1)//columns)), "#13202f")
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(entries):
        image = Image.open(ROOT / row["image"]).convert("RGB")
        image.thumbnail((tile_w-12,tile_h-40))
        x,y = (i%columns)*tile_w, (i//columns)*tile_h
        sheet.paste(image, (x+(tile_w-image.width)//2,y+5))
        draw.text((x+8,y+tile_h-30),row["id"], fill="white")
    sheet.save(path, quality=90)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["model", "samples", "nyu", "all"], default="all")
    args = parser.parse_args()
    for name, fn in [("model",prepare_model),("samples",prepare_da2k),("nyu",prepare_nyu)]:
        if args.only in {"all",name}:
            fn()
    print("Preparation complete.", flush=True)
