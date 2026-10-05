"""Explicit educational protocols, not an official NYU/DA-2K benchmark run."""

import numpy as np
from scipy.stats import spearmanr


def valid_nyu_mask(gt, raw_gt=None):
    if gt.shape != (480, 640):
        raise ValueError("NYU maps must retain their original 480 x 640 alignment.")
    mask = np.isfinite(gt) & (gt > 0.1) & (gt < 10.0)
    # Restrict to sensor-supported pixels rather than treating filled holes as
    # measurements. The full inpainted map is displayed separately.
    if raw_gt is not None:
        if raw_gt.shape != gt.shape:
            raise ValueError("Raw and filled ground truth must have the same shape.")
        mask &= np.isfinite(raw_gt) & (raw_gt > 0.1) & (raw_gt < 10.0)
    crop = np.zeros(gt.shape, dtype=bool)
    crop[45:471, 41:601] = True
    return mask & crop


def align_inverse_depth(prediction, gt, mask):
    """Oracle per-image least-squares fit: a*relative_inverse_depth+b ≈ 1/GT."""
    if prediction.shape != gt.shape or mask.shape != gt.shape:
        raise ValueError("Prediction, ground truth, and mask must have matching shapes.")
    mask = mask & np.isfinite(prediction) & np.isfinite(gt) & (gt > 0)
    if mask.sum() < 3:
        raise ValueError("At least three valid pixels are needed for alignment.")
    x = prediction[mask].astype(np.float64)
    target = 1.0 / gt[mask].astype(np.float64)
    if np.ptp(x) < 1e-8:
        raise ValueError("Constant predictions cannot be scale/shift aligned.")
    design = np.column_stack([x, np.ones_like(x)])
    a, b = np.linalg.lstsq(design, target, rcond=None)[0]
    if a <= 0:
        raise ValueError("Non-positive alignment scale: predicted depth ordering is reversed.")
    aligned_inverse = a * prediction.astype(np.float64) + b
    # Clipping avoids nonpositive inferred inverse depth after an affine fit.
    clipped = (aligned_inverse < 0.1) | (aligned_inverse > 10.0)
    depth = 1.0 / np.clip(aligned_inverse, 0.1, 10.0)
    return depth.astype(np.float32), {
        "scale": float(a), "shift": float(b),
        "clipped_valid_fraction": float(clipped[mask].mean()),
        "alignment": "oracle per-image affine fit to inverse GT on the same scored pixels",
    }


def depth_metrics(pred, gt, mask):
    if pred.shape != gt.shape or mask.shape != gt.shape:
        raise ValueError("All arrays must have matching shapes.")
    valid = mask & np.isfinite(pred) & (pred > 0) & np.isfinite(gt) & (gt > 0)
    if not valid.any():
        raise ValueError("No valid pixels to score.")
    p, g = pred[valid].astype(np.float64), gt[valid].astype(np.float64)
    ratio = np.maximum(p / g, g / p)
    return {
        "abs_rel": float(np.mean(np.abs(p - g) / g)),
        "rmse_m": float(np.sqrt(np.mean((p - g) ** 2))),
        "delta1": float(np.mean(ratio < 1.25)),
        "valid_pixels": int(valid.sum()),
    }


def ordinal_pairs(prediction, annotations):
    rows = []
    height, width = prediction.shape
    for pair in annotations:
        points = {}
        for name in ("point1", "point2"):
            y, x = map(int, pair[name])
            if not (0 <= y < height and 0 <= x < width):
                raise ValueError("Annotated point outside the original image.")
            points[name] = float(prediction[y, x])
        winner = "point1" if points["point1"] > points["point2"] else (
            "point2" if points["point2"] > points["point1"] else "tie"
        )
        expected = pair["closer_point"]
        rows.append({**pair, "values": points, "predicted_closer": winner,
                     "correct": winner == expected})
    return rows


def relative_consistency(reference, changed, seed=663):
    """Rank agreement for a controlled lighting perturbation, not depth accuracy."""
    if reference.shape != changed.shape:
        raise ValueError("Consistency comparison requires matching image geometry.")
    rng = np.random.default_rng(seed)
    n = reference.size
    indices = rng.choice(n, size=min(n, 30000), replace=False)
    x, y = reference.ravel()[indices], changed.ravel()[indices]
    rho = float(spearmanr(x, y).statistic)
    if not np.isfinite(rho):
        raise ValueError("Cannot compare ranks of a constant depth map.")
    return {"spearman_rank_correlation": rho, "sampled_pixels": len(indices),
            "seed": seed, "interpretation": "prediction stability only; no ground-truth accuracy claim"}
