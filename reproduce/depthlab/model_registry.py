"""Pinned research comparison model/source revisions."""
from depthlab import ROOT

CODE = {
    "v2": {"url":"https://github.com/DepthAnything/Depth-Anything-V2.git",
           "revision":"a561b849ebae10a6f5ef49e26c83cbbcd36c71bf",
           "path":ROOT/"third_party/Depth-Anything-V2"},
    "da3": {"url":"https://github.com/ByteDance-Seed/Depth-Anything-3.git",
            "revision":"3d835ec1a5802d64a8b8b15f817a1ab54809bfe4",
            "path":ROOT/"third_party/Depth-Anything-3"},
    "ac": {"url":"https://github.com/HVision-NKU/DepthAnythingAC.git",
           "revision":"f1209ed2e103344b346aef69a7e30c5e602e1ccd",
           "path":ROOT/"third_party/DepthAnythingAC"},
}
MODELS = {
    "v2": {"label":"Depth Anything V2 Small", "id":"depth-anything/Depth-Anything-V2-Small",
           "revision":"03876f8651c73a60fe4c2c48294e09fcb6838fcf",
           "path":ROOT/"models/v2-native", "file":"depth_anything_v2_vits.pth",
           "license":"Apache-2.0", "paper":"https://arxiv.org/abs/2406.09414"},
    "ac": {"label":"DepthAnything-AC Small", "id":"ghost233lism/DepthAnything-AC",
           "revision":"d5a8c0d69351116aa77fdc719beb91239764e0c7",
           "path":ROOT/"models/depthanything-ac", "file":"checkpoints/depth_anything_AC_vits.pth",
           "license":"CC-BY-NC-4.0", "paper":"https://arxiv.org/abs/2507.01634"},
    "da3": {"label":"Depth Anything 3 Small", "id":"depth-anything/DA3-SMALL",
            "revision":"e08cab65ca0ec38e7826075418411ab90cab4da3",
            "path":ROOT/"models/da3-small", "file":"model.safetensors",
            "license":"Apache-2.0", "paper":"https://arxiv.org/abs/2511.10647"},
}
