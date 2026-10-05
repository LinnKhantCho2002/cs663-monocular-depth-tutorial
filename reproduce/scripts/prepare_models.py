"""Fetch pinned official source and weights for the three-model comparison."""
import json
from pathlib import Path
import subprocess
import sys
from huggingface_hub import snapshot_download

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from depthlab import ROOT
from depthlab.model_registry import CODE,MODELS
from scripts.prepare import sha256,write_json

for spec in CODE.values():
    path=spec["path"]
    if not path.exists():
        path.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run(["git","clone",spec["url"],str(path)],check=True)
    current=subprocess.check_output(["git","-C",str(path),"rev-parse","HEAD"],text=True).strip()
    if current!=spec["revision"]:
        if subprocess.check_output(["git","-C",str(path),"status","--porcelain"],text=True).strip():
            raise RuntimeError(f"Preserving edited upstream checkout: {path}")
        subprocess.run(["git","-C",str(path),"fetch","origin",spec["revision"]],check=True)
        subprocess.run(["git","-C",str(path),"checkout","--detach",spec["revision"]],check=True)

records={}
for key,spec in MODELS.items():
    patterns=[spec["file"],"README.md"]+(["config.json"] if key=="da3" else [])
    snapshot_download(spec["id"],revision=spec["revision"],local_dir=spec["path"],allow_patterns=patterns)
    records[key]={k:str(v) if isinstance(v,Path) else v for k,v in spec.items()}
    records[key]["weights_sha256"]=sha256(spec["path"]/spec["file"])
write_json(ROOT/"data/comparison_model_provenance.json",{"models":records,
           "code":{k:{n:str(v) if isinstance(v,Path) else v for n,v in s.items()} for k,s in CODE.items()}})
print("Additional model preparation complete.")
