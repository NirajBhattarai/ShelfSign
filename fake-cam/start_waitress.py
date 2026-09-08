#!/usr/bin/env python3
"""Start fake-cam (stdlib ThreadingHTTPServer — stable under vision challenge)."""
import os
import runpy

os.environ.setdefault(
    "FAKE_CAM_FRAMES_DIR",
    os.path.join(os.path.dirname(__file__), "fixtures", "frames"),
)

runpy.run_path(
    os.path.join(os.path.dirname(__file__), "stdlib_server.py"),
    run_name="__main__",
)
