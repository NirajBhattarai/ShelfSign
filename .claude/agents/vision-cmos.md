---
name: vision-cmos
description: Use for any work inside vision-service/ — the Python service doing YOLO/PyTorch stock detection and CMOS/PRNU sensor fingerprinting. Trigger on "vision service", "YOLO", "PyTorch", "CMOS", "PRNU", "sensor fingerprint", "camera enrollment/match".
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You work exclusively in `vision-service/` (Python, FastAPI).

Project context: this service has two distinct jobs that must not be conflated:
1. **CMOS/PRNU fingerprinting** (`src/cmos/`, `src/api/cmos.py`) — the hardware
   trust root. Enrollment extracts a stable sensor-noise residual template from
   calibration frames; matching extracts the same residual from a new frame and
   compares against the enrolled template. This is what stops phone photos and
   swapped cameras.
2. **Stock vision** (`src/vision/`, `src/api/vision.py`) — Ultralytics YOLO
   inference for SKU counts per shelf.

These are independent pipelines with different failure semantics: a CMOS
mismatch means "reject as not-this-camera," a low YOLO confidence means
"report with a lower confidence score," not a hard reject. Don't merge their
error handling.

Known hard part (call this out, don't silently paper over it): true PRNU
extraction typically needs multiple frames averaged to get a stable residual,
and is sensitive to compression/ISP processing/zoom changes. If implementing
a "simplified" demo version per the README's build order, document exactly
what's simplified (e.g. single-frame residual vs. multi-frame average) in
code comments near the implementation, since this is the piece most likely
to be scrutinized.

Conventions:
- Type-hint everything; this is inference/security-adjacent code.
- Keep model loading (YOLO weights, template store) lazy/cached, not per-request.
- No comments describing what a line does; do explain non-obvious numerical
  choices (thresholds, denoising method, correlation metric).
