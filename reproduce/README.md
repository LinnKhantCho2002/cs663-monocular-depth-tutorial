# Run the depth experiment
This folder contains the first-party inference, sample selection, scoring and comparison code used for the tutorial. Model weights and upstream repositories are downloaded separately from their owners. No training is performed.

## Setup
Install Git and uv (https://docs.astral.sh/uv/getting-started/installation/).
Clone https://github.com/LinnKhantCho2002/cs663-monocular-depth-tutorial.git and enter its reproduce folder, or unzip the source-code download and enter reproduce.
Run: uv sync --locked
The lock uses Python 3.12 and the pinned study dependencies. uv can install a compatible Python automatically. The environment includes the libraries used by the full study; installation and model downloads take extra time and disk space.

## A new photograph: Hugging Face V2 Small
Run: uv run python scripts/prepare.py --only model
Run: uv run python scripts/run_experiments.py --image /path/to/photo.jpg --out outputs/my_photo
For the website's wine-glass display photo in a repository clone, use ../media/da2k_transparent_reflective_01_clean.jpg. The source ZIP does not include photographs.
Quote paths containing spaces. Optional: --device cpu (or mps/cuda when available); --input-size 252, 392, 518 or 700.
Input is EXIF-oriented, converted to RGB and bounded to a 1,600-pixel longest side. Unsupported very small images and extreme panoramas are rejected.
Outputs: rgb.png, inverse_depth.npy, depth_color.png, depth_gray.png, comparison.png and result.json. The raw finite float array matches the processed RGB grid. Higher relative inverse depth means closer; values are not meters. Color normalization is per image.
The result records the pinned model revision, actual input tensor dimensions, device and timing. The script warms up once before measuring. Loading, file I/O and plotting are excluded from inference time.
This route uses the Hugging Face port with Pillow preprocessing. It is not numerically interchangeable with the native study below.

## Fixed native three-model study
Run these in order:
    uv run python scripts/prepare.py --only samples
    uv run python scripts/prepare.py --only nyu
    uv run python scripts/prepare_models.py
    uv run python scripts/compare_models.py
The first two commands select the same 15 original DA-2K images and six NYU records through HTTP range requests. Remote servers must support range access; the manifests preserve source hashes and coordinates.
prepare_models.py clones the official repositories at pinned commits and downloads V2, AC and DA3 weights at pinned Hugging Face revisions. It refuses to reset an upstream checkout with local changes.
compare_models.py uses native implementations, all four fixed conditions and the original annotation coordinates. V2/AC share preprocessing; DA3 uses its official processor. Native DA3 depth is converted to the common relative inverse-depth convention.
Outputs: outputs/comparison/summary.json, per-model result JSON, and all raw prediction NPZ files. NYU arrays include the oracle-aligned depth and valid mask.
NYU fits scale and shift using the same reference pixels that are scored. This evaluates relative shape after access to the answer; it does not establish raw metric accuracy. See the Evaluation lesson for exact crop, mask and metrics.
Compare revisions, inputs, transformations and denominators before comparing numbers. Hardware/float arithmetic can affect near ties and timing. The public provenance describes the original completed Apple M4/MPS run; a new run records its own environment.

## Troubleshooting
Missing weights: run the relevant preparation command before inference.
GPU unavailable: use --device cpu; CPU execution may be slower.
Network/certificate/range error: check connectivity, certificate trust and the original dataset URL; do not disable TLS verification.
First run: dependencies and weights are downloaded. Later runs reuse local files/caches.
The checkpoints and code are not hosted as a running service on GitHub Pages.

## Sources and licenses
V2: https://github.com/DepthAnything/Depth-Anything-V2 (Apache-2.0 for the Small checkpoint used).
AC: https://github.com/HVision-NKU/DepthAnythingAC and https://huggingface.co/ghost233lism/DepthAnything-AC (CC-BY-NC-4.0 checkpoint).
DA3: https://github.com/ByteDance-Seed/Depth-Anything-3 and https://huggingface.co/depth-anything/DA3-SMALL (Apache-2.0).
Dataset rights are separate from model/code rights. Follow the DA-2K and NYU source terms linked in the bibliography. This bundle distributes first-party project code only, without weights, upstream code or dataset archives. AI tools assisted implementation.
