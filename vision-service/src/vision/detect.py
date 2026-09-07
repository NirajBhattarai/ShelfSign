"""YOLO / PyTorch stock detection — Chair / Monitor / Table only.

Aggregates detections into integer totals per SKU (no per-shelf split).
Optional `allowed_skus` filters to the warehouse's selected categories.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

import numpy as np
from PIL import Image

# COCO class → stock SKU. Hackathon catalog is only these three.
#
# Monitor mapping rationale:
#   "tv"     → MONITOR: COCO's label for flat-panel displays; primary mapping.
#   "laptop" → MONITOR: yolov8n (COCO) frequently labels widescreen desk
#              monitors as "laptop" when the camera is roughly head-on and the
#              keyboard is not in frame.  In office AV inventory a laptop and
#              a desk monitor are both countable AV assets; accepting both
#              avoids systematic under-counting without fabricating detections.
#              If the deployment needs laptops tracked separately, override via
#              YOLO_SKU_MAP_JSON={"laptop":"LAPTOP"} at runtime.
DEFAULT_STOCK_CLASS_TO_SKU: dict[str, str] = {
    "chair": "CHAIR",
    "dining table": "TABLE",
    "tv": "MONITOR",
    "laptop": "MONITOR",
}

# Category label (warehouse UI) → SKU used in attestations / stock rows.
CATEGORY_TO_SKU: dict[str, str] = {
    "chair": "CHAIR",
    "chairs": "CHAIR",
    "monitor": "MONITOR",
    "monitors": "MONITOR",
    "table": "TABLE",
    "tables": "TABLE",
}

IGNORE_CLASSES = {
    # Vehicles / outdoor
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    # Animals
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    # Small office items — not tracked as AV inventory; explicit here so they
    # are counted in ignoredCount rather than silently hitting the sku_map miss.
    "cell phone",
    "remote",
    "keyboard",
    "mouse",
    "book",
    "bottle",
    "cup",
    "vase",
    "clock",
    "scissors",
}

MODEL_NAME = os.environ.get("YOLO_MODEL_NAME", "yolov8n-stock-v1")
DEFAULT_WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolov8n.pt")
# 0.20 (down from 0.25): catches partially-occluded or angled monitors that
# sit in the 0.20–0.24 band.  Do not go below 0.15 with yolov8n — the small
# model produces spurious detections in background clutter below that point.
DEFAULT_CONF = float(os.environ.get("YOLO_CONFIDENCE", "0.20"))


def categories_to_skus(categories: Optional[Iterable[str]]) -> Optional[set[str]]:
    """Map warehouse category names to SKU codes. None = allow all known SKUs."""
    if categories is None:
        return None
    skus: set[str] = set()
    for raw in categories:
        key = str(raw).strip().lower()
        if not key:
            continue
        if key in CATEGORY_TO_SKU:
            skus.add(CATEGORY_TO_SKU[key])
        else:
            # Already a SKU like CHAIR / MONITOR / TABLE
            skus.add(key.upper())
    return skus


def _load_sku_map() -> dict[str, str]:
    mapping = dict(DEFAULT_STOCK_CLASS_TO_SKU)
    raw = os.environ.get("YOLO_SKU_MAP_JSON", "").strip()
    path = os.environ.get("YOLO_SKU_MAP_PATH", "").strip()
    if path and Path(path).is_file():
        raw = Path(path).read_text()
    if raw:
        try:
            extra = json.loads(raw)
            if isinstance(extra, dict):
                mapping.update({str(k).lower(): str(v) for k, v in extra.items()})
        except json.JSONDecodeError:
            pass
    return mapping


@lru_cache(maxsize=1)
def _load_model():
    from ultralytics import YOLO

    return YOLO(DEFAULT_WEIGHTS)


def image_hash(frame_bytes: bytes) -> str:
    return "0x" + hashlib.sha256(frame_bytes).hexdigest()


def model_hash() -> str:
    return "0x" + hashlib.sha256(f"{MODEL_NAME}:{DEFAULT_WEIGHTS}".encode()).hexdigest()


def detect_stock(
    frame_bytes: bytes,
    confidence_threshold: float | None = None,
    allowed_skus: Optional[Iterable[str]] = None,
    allowed_categories: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """
    Run YOLO and sum integer counts per SKU (Chair / Monitor / Table).

    If `allowed_categories` or `allowed_skus` is set, only those SKUs are kept
    (warehouse selection at create time).
    """
    conf = DEFAULT_CONF if confidence_threshold is None else float(confidence_threshold)
    sku_map = _load_sku_map()

    allow = None
    if allowed_skus is not None:
        allow = {str(s).upper() for s in allowed_skus}
    elif allowed_categories is not None:
        allow = categories_to_skus(allowed_categories)

    img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
    arr = np.asarray(img)

    model = _load_model()
    results = model.predict(source=arr, conf=conf, verbose=False)

    # SKU -> list of confidences (one per box); count = len
    buckets: dict[str, list[float]] = {}
    detection_count = 0
    ignored_count = 0

    for result in results:
        names = result.names or {}
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            cls_id = int(box.cls.item())
            score = float(box.conf.item())
            class_name = str(names.get(cls_id, f"class_{cls_id}")).lower()
            if class_name in IGNORE_CLASSES:
                ignored_count += 1
                continue
            sku = sku_map.get(class_name)
            if not sku:
                ignored_count += 1
                continue
            if allow is not None and sku.upper() not in allow:
                ignored_count += 1
                continue
            buckets.setdefault(sku, []).append(score)
            detection_count += 1

    items = []
    for sku, confs in sorted(buckets.items(), key=lambda x: (-len(x[1]), x[0])):
        items.append(
            {
                "sku": sku,
                "category": {"CHAIR": "Chair", "MONITOR": "Monitor", "TABLE": "Table"}.get(
                    sku, sku.title()
                ),
                "count": len(confs),  # integer total for this category
                "confidence": 1.0,  # no fractional evidence in UI
                "shelf": "-",
            }
        )

    return {
        "items": items,
        "model": MODEL_NAME,
        "modelHash": model_hash(),
        "imageHash": image_hash(frame_bytes),
        "detectionCount": detection_count,
        "ignoredCount": ignored_count,
        "engine": "ultralytics-yolov8+torch",
        "weights": DEFAULT_WEIGHTS,
        "totalUnits": sum(i["count"] for i in items),
    }
