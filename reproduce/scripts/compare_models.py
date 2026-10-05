"""Fixed three-model observational study; no model selection based on results."""
import argparse
from datetime import datetime,timezone
import gc
import json
from pathlib import Path
import sys
import time
import numpy as np
from PIL import Image,ImageFilter
import torch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from depthlab import ROOT
from depthlab.comparison_engine import ComparisonEngine
from depthlab.metrics import ordinal_pairs,relative_consistency,valid_nyu_mask,align_inverse_depth,depth_metrics
from depthlab.model_registry import MODELS
from depthlab.visuals import colorize
from scripts.run_experiments import write_json

CONDITIONS=["clean","dark_mild","dark_strong","blur"]


def perturb(image,condition):
    pixels=np.asarray(image,dtype=np.float32)/255
    if condition=="dark_mild":
        return Image.fromarray(np.round(255*.25*pixels**1.6).astype(np.uint8))
    if condition=="dark_strong":
        return Image.fromarray(np.round(255*.05*pixels**3).astype(np.uint8))
    if condition=="blur":
        # Blur radius scaled to image size so all examples have comparable severity.
        return image.filter(ImageFilter.GaussianBlur(radius=min(image.size)/80))
    return image.copy()


def main(device):
    out=ROOT/"outputs/comparison"
    out.mkdir(parents=True,exist_ok=True)
    samples=[r for r in json.loads((ROOT/"data/samples/manifest.json").read_text())["samples"] if not r.get("derived_from")]
    nyu=json.loads((ROOT/"data/nyu/manifest.json").read_text())["samples"]
    protocol={"fixed_before_comparison_run_utc":datetime.now(timezone.utc).isoformat(),
              "research_questions":["Does the AC fine-tuned checkpoint improve annotated ordering under these controlled perturbations?",
                                    "Does DA3-Small change ordering and shape agreement on the same single-image examples?",
                                    "How do local synchronized latency and model size differ?"],
              "models":list(MODELS),"sample_ids":[r["id"] for r in samples],
              "conditions":CONDITIONS,"transformations":{"dark_mild":"round(255*.25*(RGB/255)^1.6)",
                 "dark_strong":"round(255*.05*(RGB/255)^3)","blur":"Pillow GaussianBlur(radius=min(H,W)/80)"},
              "input_size":518,"precision":"float32", "views_per_inference":1,
              "ordinal_metric":"Raw inverse-depth values at original annotated points; ties incorrect; all 35 pairs counted per condition",
              "nyu":"Same 6 records/mask and per-image oracle inverse-depth alignment as the original demo",
              "limitations":["Small fixed authors' dataset subset; not a statistically representative sample",
                "Controlled image perturbations do not simulate all physical camera effects",
                "All three models share related training lineage; training overlap is not audited",
                "DA3-Small is an any-view checkpoint run on one view, not the dedicated large mono/metric variants",
                "Native input rounding differs; all shapes are recorded; no full paper benchmark reproduction",
                "Pixel pairs within the same image and perturbed copies are correlated observations"]}
    write_json(out/"protocol.json",protocol)
    results={}
    for key in MODELS:
        engine=ComparisonEngine(key,device)
        print('Loaded',json.dumps(engine.metadata()),flush=True)
        engine.predict(Image.new('RGB',(640,480),'gray'))
        rows=[]
        for row in samples:
            image=Image.open(ROOT/row["image"]).convert("RGB")
            base=None
            for condition in CONDITIONS:
                transformed=perturb(image,condition)
                prediction=engine.predict(transformed)
                pairs=ordinal_pairs(prediction.inverse_depth,row["annotations"])
                entry={"id":row["id"],"category":row["category"],"condition":condition,
                       "seconds":prediction.seconds,"tensor_shape":prediction.input_shape,
                       "correct":sum(p["correct"] for p in pairs),"total":len(pairs),"pairs":pairs}
                if condition=="clean":
                    base=prediction.inverse_depth
                else:
                    entry["consistency"]=relative_consistency(base,prediction.inverse_depth)
                case=out/"cases"/row["id"]/condition
                case.mkdir(parents=True,exist_ok=True)
                # Preserve every prediction, not just selected successful outputs.
                np.savez_compressed(case/f"{key}.npz",inverse_depth=prediction.inverse_depth)
                colorize(prediction.inverse_depth).save(case/f"{key}.png")
                if key=="v2":
                    transformed.save(case/"rgb.jpg",quality=95)
                rows.append(entry)
            print(key,row["id"],[(r["condition"],r["correct"],r["total"]) for r in rows[-4:]],flush=True)
        nyu_results=[]
        for row in nyu:
            image=Image.open(ROOT/row["image"]).convert("RGB")
            prediction=engine.predict(image)
            with np.load(ROOT/row["depth"],allow_pickle=False) as gt_data:
                gt,sensor=gt_data["depth_m"],gt_data["raw_depth_m"]
            mask=valid_nyu_mask(gt,sensor)
            aligned,fit=align_inverse_depth(prediction.inverse_depth,gt,mask)
            case=out/"nyu"/row["id"]
            case.mkdir(parents=True,exist_ok=True)
            np.savez_compressed(case/f"{key}.npz",inverse_depth=prediction.inverse_depth,
                                aligned_depth_m=aligned,valid_mask=mask)
            nyu_results.append({"id":row["id"],"aligned_metrics":depth_metrics(aligned,gt,mask),"fit":fit})
        # All models get the same 480x640 RGB benchmark image and target resolution.
        bench_image=Image.open(ROOT/nyu[0]["image"]).convert("RGB")
        engine.predict(bench_image)
        times=[engine.predict(bench_image).seconds for _ in range(5)]
        aggregates={}
        for condition in CONDITIONS:
            selected=[r for r in rows if r["condition"]==condition]
            correct=sum(r["correct"] for r in selected)
            total=sum(r["total"] for r in selected)
            aggregates[condition]={"correct":correct,"total":total,"accuracy":correct/total,
                "mean_per_image_rank_stability":float(np.mean([r["consistency"]["spearman_rank_correlation"] for r in selected])) if condition!="clean" else None}
        result={"runtime":engine.metadata(),"ordinal_aggregate":aggregates,"cases":rows,"nyu":nyu_results,
                "nyu_mean_aligned_abs_rel":float(np.mean([r["aligned_metrics"]["abs_rel"] for r in nyu_results])),
                "nyu_mean_aligned_rmse_m":float(np.mean([r["aligned_metrics"]["rmse_m"] for r in nyu_results])),
                "latency":{"image_id":nyu[0]["id"],"seconds":times,"median_seconds":float(np.median(times)),
                           "scope":"warmed synchronized preprocessing+forward+upsampling+CPU transfer; no loading or plots"}}
        write_json(out/f"{key}_results.json",result)
        results[key]=result
        del engine
        gc.collect()
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    write_json(out/"summary.json",{"protocol":protocol,"models":results})
    print("Comparison complete.",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device",choices=["auto","cpu","mps","cuda"],default="auto")
    main(parser.parse_args().device)
