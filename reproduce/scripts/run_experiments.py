"""Run real local inference and save raw arrays, figures, and exact metrics."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from depthlab import ROOT
from depthlab.engine import DepthEngine, image_digest, load_rgb
from depthlab.metrics import align_inverse_depth, depth_metrics, ordinal_pairs, relative_consistency, valid_nyu_mask
from depthlab.visuals import colorize, comparison_figure, normalize, nyu_figure


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")


def save_prediction(engine, image, row, out, input_size):
    out.mkdir(parents=True, exist_ok=True)
    prediction = engine.predict(image, input_size)
    np.save(out / "inverse_depth.npy", prediction.inverse_depth, allow_pickle=False)
    colorize(prediction.inverse_depth).save(out / "depth_color.png")
    Image.fromarray(np.round(normalize(prediction.inverse_depth)*255).astype(np.uint8)).save(out / "depth_gray.png")
    image.save(out / "rgb.png")
    metadata = {
        **row, "input_rgb_digest": image_digest(image), "input_size": input_size,
        "processed_tensor_shape": prediction.input_shape, "seconds": prediction.seconds,
        "device": prediction.device, "image_size": image.size,
        "output": str(out.relative_to(ROOT)) if out.is_relative_to(ROOT) else str(out),
    }
    annotations = row.get("annotations", [])
    if annotations:
        metadata["ordinal_results"] = ordinal_pairs(prediction.inverse_depth, annotations)
    fig = comparison_figure(image, prediction.inverse_depth, row["title"], annotations)
    fig.savefig(out / "comparison.png", dpi=140)
    plt.close(fig)
    return prediction.inverse_depth, metadata


def run(engine, size):
    sample_manifest = json.loads((ROOT / "data/samples/manifest.json").read_text())
    nyu_manifest = json.loads((ROOT / "data/nyu/manifest.json").read_text())
    samples, nyu_rows = [], []
    arrays = {}
    for row in sample_manifest["samples"]:
        # DA-2K annotations use native image coordinates. Do not resize originals.
        image = Image.open(ROOT / row["image"]).convert("RGB")
        out = ROOT / "outputs/cases" / row["id"]
        raw, metadata = save_prediction(engine,image,row,out,size)
        arrays[row["id"]] = raw
        if row.get("derived_from"):
            metadata["consistency"] = relative_consistency(arrays[row["derived_from"]],raw)
        write_json(out / "result.json",metadata)
        samples.append(metadata)
        correct = sum(p["correct"] for p in metadata.get("ordinal_results",[]))
        print(row["id"],f'{metadata["seconds"]:.3f}s',f'{correct}/{len(metadata.get("ordinal_results",[]))} pairs',flush=True)
    del arrays
    for row in nyu_manifest["samples"]:
        image = Image.open(ROOT / row["image"]).convert("RGB")
        out = ROOT / "outputs/cases" / row["id"]
        raw, metadata = save_prediction(engine,image,row,out,size)
        with np.load(ROOT / row["depth"],allow_pickle=False) as data:
            gt, sensor = data["depth_m"], data["raw_depth_m"]
        mask = valid_nyu_mask(gt,sensor)
        aligned,fit = align_inverse_depth(raw,gt,mask)
        metrics = depth_metrics(aligned,gt,mask)
        metadata.update({"alignment":fit,"aligned_metrics":metrics,
                         "scoring_mask_fraction":float(mask.mean())})
        np.savez_compressed(out / "evaluation.npz", aligned_depth_m=aligned, ground_truth_m=gt,
                            raw_sensor_depth_m=sensor, valid_mask=mask)
        fig = nyu_figure(image,raw,gt,aligned,mask,
                         f'{row["id"]}: {row["title"]} | aligned AbsRel {metrics["abs_rel"]:.3f}, RMSE {metrics["rmse_m"]:.3f} m')
        fig.savefig(out / "ground_truth_comparison.png",dpi=140)
        plt.close(fig)
        write_json(out / "result.json",metadata)
        nyu_rows.append(metadata)
        print(row["id"],metrics,flush=True)
    original_samples = [r for r in samples if not r.get("derived_from")]
    pairs = [p for row in original_samples for p in row["ordinal_results"]]
    by_category = {}
    for category in sorted({r["category"] for r in original_samples}):
        category_pairs = [p for row in original_samples if row["category"]==category for p in row["ordinal_results"]]
        by_category[category] = {"correct":sum(p["correct"] for p in category_pairs), "total":len(category_pairs),
                                 "accuracy":float(np.mean([p["correct"] for p in category_pairs]))}
    summary = {
        "created_utc":datetime.now(timezone.utc).isoformat(),
        "runtime":engine.metadata(), "input_size":size,
        "selection": {"da2k":sample_manifest["selection"],"nyu":nyu_manifest["selection"]},
        "da2k_subset": {"images":len(original_samples),"correct_pairs":sum(p["correct"] for p in pairs),
                         "total_pairs":len(pairs),"pair_accuracy":float(np.mean([p["correct"] for p in pairs])),
                         "by_category":by_category, "ties":"Counted as incorrect",
                         "scope":"Illustrative fixed subset of authors' dataset; not full benchmark accuracy"},
        "nyu_illustrative": {
            "images":len(nyu_rows),
            "mean_per_image_abs_rel":float(np.mean([r["aligned_metrics"]["abs_rel"] for r in nyu_rows])),
            "mean_per_image_rmse_m":float(np.mean([r["aligned_metrics"]["rmse_m"] for r in nyu_rows])),
            "mean_per_image_delta1":float(np.mean([r["aligned_metrics"]["delta1"] for r in nyu_rows])),
            "total_valid_pixels":sum(r["aligned_metrics"]["valid_pixels"] for r in nyu_rows),
            "protocol":"Fit a*p+b to inverse filled GT per image on sensor-supported cropped scoring pixels; invert and clip to 0.1–10 m",
            "crop":"Rows 45:471, columns 41:601 (Python exclusive upper bounds), original 480×640",
            "scope":"Oracle GT alignment uses scored pixels; not unaligned metric accuracy or official held-out NYU benchmark",
        },
        "samples":samples,"nyu":nyu_rows,
    }
    write_json(ROOT / "outputs/summary.json",summary)
    return summary


def benchmark(engine, row, repeats=5):
    image = Image.open(ROOT / row["image"]).convert("RGB")
    with np.load(ROOT / row["depth"],allow_pickle=False) as data:
        gt, sensor = data["depth_m"],data["raw_depth_m"]
    mask = valid_nyu_mask(gt,sensor)
    rows = []
    for size in [252,392,518]:
        engine.predict(image,size) # warm up each shape, excluded from timing
        predictions = [engine.predict(image,size) for _ in range(repeats)]
        times = [p.seconds for p in predictions]
        aligned, _ = align_inverse_depth(predictions[-1].inverse_depth,gt,mask)
        rows.append({"input_size":size,"tensor_shape":predictions[-1].input_shape,
                     "repeats":repeats,"seconds":times,"median_seconds":float(np.median(times)),
                     "min_seconds":min(times),"max_seconds":max(times),
                     "aligned_metrics":depth_metrics(aligned,gt,mask)})
    result={"image_id":row["id"],"runtime":engine.metadata(),"rows":rows,
            "scope":"Single fixed image on this laptop; warmed synchronized timing; not mobile performance or a general benchmark"}
    write_json(ROOT / "outputs/benchmark.json",result)
    return result


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image",type=Path,help="Run one user image instead of the prepared experiments")
    parser.add_argument("--out",type=Path,default=ROOT/"outputs/user_image")
    parser.add_argument("--device",choices=["auto","cpu","mps","cuda"],default="auto")
    parser.add_argument("--input-size",type=int,default=518,choices=[252,392,518,700])
    parser.add_argument("--benchmark",action="store_true")
    args=parser.parse_args()
    engine=DepthEngine(args.device)
    engine.predict(Image.new("RGB",(640,480),"gray"),args.input_size) # warm-up excluded
    print(json.dumps(engine.metadata(),indent=2),flush=True)
    if args.image:
        image=load_rgb(args.image)
        _,metadata=save_prediction(engine,image,{"id":"user_image","title":args.image.name},args.out,args.input_size)
        write_json(args.out/"result.json",{**metadata,"runtime":engine.metadata()})
    else:
        summary=run(engine,args.input_size)
        if args.benchmark:
            benchmark(engine,summary["nyu"][0])
    print("Experiment complete.",flush=True)
