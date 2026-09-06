"""YOLO / PyTorch stock detection — counts detected objects as supply units.

Uses Ultralytics YOLOv8 (PyTorch backend). Default weights are COCO-pretrained
`yolov8n.pt`. Point `YOLO_WEIGHTS` at a custom warehouse model when you have
one trained for SKUs like ANGLE-IRON-3M.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

# COCO class → stock SKU. Override via YOLO_SKU_MAP_JSON env (JSON object) or
# YOLO_SKU_MAP_PATH (file). Classes in IGNORE_CLASSES are never counted.
DEFAULT_STOCK_CLASS_TO_SKU: dict[str, str] = {
    "bottle": "BOTTLE",
    "wine glass": "GLASS",
    "cup": "CUP",
    "bowl": "BOWL",
    "banana": "BANANA",
    "apple": "APPLE",
    "orange": "ORANGE",
    "broccoli": "BROCCOLI",
    "carrot": "CARROT",
    "hot dog": "HOTDOG",
    "pizza": "PIZZA",
    "donut": "DONUT",
    "cake": "CAKE",
    "chair": "CHAIR",
    "couch": "COUCH",
    "potted plant": "PLANT",
    "bed": "BED",
    "dining table": "TABLE",
    "tv": "TV",
    "laptop": "LAPTOP",
    "mouse": "MOUSE",
    "remote": "REMOTE",
    "keyboard": "KEYBOARD",
    "cell phone": "PHONE",
    "microwave": "MICROWAVE",
    "oven": "OVEN",
    "toaster": "TOASTER",
    "sink": "SINK",
    "refrigerator": "FRIDGE",
    "book": "BOOK",
    "clock": "CLOCK",
    "vase": "VASE",
    "scissors": "SCISSORS",
    "teddy bear": "TEDDY",
    "hair drier": "DRYER",
    "toothbrush": "TOOTHBRUSH",
    "backpack": "BACKPACK",
    "umbrella": "UMBRELLA",
    "handbag": "HANDBAG",
    "tie": "TIE",
    "suitcase": "SUITCASE",
    "frisbee": "FRISBEE",
    "skis": "SKIS",
    "snowboard": "SNOWBOARD",
    "sports ball": "BALL",
    "kite": "KITE",
    "baseball bat": "BAT",
    "baseball glove": "GLOVE",
    "skateboard": "SKATEBOARD",
    "surfboard": "SURFBOARD",
    "tennis racket": "RACKET",
    "box": "BOX",
}

# People / vehicles / animals — not warehouse stock units.
IGNORE_CLASSES = {
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
}

MODEL_NAME = os.environ.get("YOLO_MODEL_NAME", "yolov8n-stock-v1")
DEFAULT_WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolov8n.pt")
DEFAULT_CONF = float(os.environ.get("YOLO_CONFIDENCE", "0.25"))


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

    # First call downloads yolov8n.pt into Ultralytics cache if missing.
    return YOLO(DEFAULT_WEIGHTS)


def image_hash(frame_bytes: bytes) -> str:
    return "0x" + hashlib.sha256(frame_bytes).hexdigest()


def model_hash() -> str:
    return "0x" + hashlib.sha256(f"{MODEL_NAME}:{DEFAULT_WEIGHTS}".encode()).hexdigest()


def _shelf_for_box(xyxy: np.ndarray, image_height: int) -> str:
    """Map vertical position to a coarse shelf band (A/B/C)."""
    y_center = float((xyxy[1] + xyxy[3]) / 2.0)
    ratio = y_center / max(image_height, 1)
    if ratio < 0.33:
        return "A1"
    if ratio < 0.66:
        return "B1"
    return "C1"


def detect_stock(
    frame_bytes: bytes,
    confidence_threshold: float | None = None,
) -> dict[str, Any]:
    """
    Run YOLO (PyTorch via Ultralytics) on a JPEG frame and aggregate detections
    into SKU stock rows. One detection box = one counted unit.
    """
    conf = DEFAULT_CONF if confidence_threshold is None else float(confidence_threshold)
    sku_map = _load_sku_map()

    img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
    arr = np.asarray(img)
    height = arr.shape[0]

    model = _load_model()
    results = model.predict(source=arr, conf=conf, verbose=False)

    buckets: dict[tuple[str, str], list[float]] = {}
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
                # Keep unknown detections so live supply still shows something.
                sku = class_name.upper().replace(" ", "_")[:24] or f"OBJ_{cls_id}"
            xyxy = box.xyxy[0].cpu().numpy()
            shelf = _shelf_for_box(xyxy, height)
            buckets.setdefault((sku, shelf), []).append(score)
            detection_count += 1

    items = []
    for (sku, shelf), confs in sorted(
        buckets.items(), key=lambda x: (-len(x[1]), x[0][0])
    ):
        items.append(
            {
                "sku": sku,
                "count": len(confs),
                "confidence": round(sum(confs) / len(confs), 3),
                "shelf": shelf,
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
