"""Consistent legends: warm/brighter relative inverse depth means closer."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw


def normalize(array):
    array = np.asarray(array, dtype=np.float32)
    if not np.isfinite(array).all():
        raise ValueError("Visualization needs finite values.")
    lo, hi = float(array.min()), float(array.max())
    return np.zeros_like(array) if hi - lo < 1e-8 else (array - lo) / (hi - lo)


def colorize(inverse_depth, cmap="magma"):
    colors = matplotlib.colormaps[cmap](normalize(inverse_depth))[..., :3]
    return Image.fromarray((colors * 255).astype(np.uint8))


def marked_image(image, points):
    image = image.copy()
    draw = ImageDraw.Draw(image)
    radius = max(6, image.width // 90)
    for label, (x, y), color in points:
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=color, outline="white", width=2)
        draw.text((x+radius+3, y-radius), label, fill="white", stroke_width=2, stroke_fill="black")
    return image


def comparison_figure(image, inverse_depth, title, annotations=None):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.7), layout="constrained")
    axes[0].imshow(image)
    axes[0].set_title("Single RGB image")
    im = axes[1].imshow(normalize(inverse_depth), cmap="magma", vmin=0, vmax=1)
    axes[1].set_title("Relative inverse depth • higher = closer")
    for ax in axes:
        ax.axis("off")
        if annotations:
            for idx, pair in enumerate(annotations):
                for name, color in (("point1", "#36d6c8"), ("point2", "#f178b6")):
                    y, x = pair[name]
                    ax.scatter(x, y, s=65, color=color, edgecolors="white")
                    ax.annotate(f"{idx+1}{'A' if name=='point1' else 'B'}", (x, y),
                                xytext=(7, 7), textcoords="offset points", color="white",
                                bbox=dict(facecolor="black", alpha=.6, pad=2))
    bar = fig.colorbar(im, ax=axes[1], shrink=.8, ticks=[0, 1])
    bar.ax.set_yticklabels(["Farther", "Closer"])
    bar.set_label("Per-image normalized arbitrary units")
    fig.suptitle(title)
    return fig


def nyu_figure(image, relative, gt, aligned, mask, title):
    fig, axes = plt.subplots(1, 4, figsize=(17, 4.1), layout="constrained")
    axes[0].imshow(image)
    axes[0].set_title("RGB input")
    rel = axes[1].imshow(normalize(relative), cmap="magma", vmin=0, vmax=1)
    axes[1].set_title("Relative prediction\nHigher = closer (not meters)")
    fig.colorbar(rel, ax=axes[1], shrink=.65, ticks=[0, 1])
    for ax, array, label in ((axes[2], gt, "Filled NYU ground truth (m)"),
                              (axes[3], aligned, "Prediction after oracle alignment (m)")):
        im = ax.imshow(np.ma.masked_where(~mask, array), cmap="magma_r", vmin=.1, vmax=10)
        ax.set_title(label+"\nSensor-supported scoring mask")
        fig.colorbar(im, ax=ax, shrink=.65, label="meters", ticks=[.1, 5, 10])
    for ax in axes:
        ax.axis("off")
    fig.suptitle(title)
    return fig
