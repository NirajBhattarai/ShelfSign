"""Authenticity gates: real Hikvision must pass; Fake Cam must fail."""

from __future__ import annotations

import os
import time
import unittest

import numpy as np

from src.cmos.device_authenticity import (
    SyntheticDeviceError,
    assert_live_sensor_burst,
    assert_physical_device,
    device_looks_synthetic,
    osd_region_changed,
    parse_device_info_xml,
)

REAL_DEVICE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>IP CAMERA</deviceName>
  <deviceID>283d8000-6a37-11b3-81a7-08cc81ec9141</deviceID>
  <model>DS-2CD1323G0E-I</model>
  <serialNumber>DS-2CD1323G0E-I20250423AAWRFZ1499188</serialNumber>
  <firmwareVersion>V5.7.23</firmwareVersion>
  <deviceType>IPCamera</deviceType>
</DeviceInfo>
"""

FAKE_DEVICE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>ShelfSign-FakeCam</deviceName>
  <deviceID>fake-cam-001</deviceID>
  <model>FAKE-ISAPI-STUB</model>
  <serialNumber>FAKECMOS0000001</serialNumber>
  <firmwareVersion>V0.0.1</firmwareVersion>
  <deviceType>IPCamera</deviceType>
</DeviceInfo>
"""

OSD_BOX = (0, 0, 260, 190)


class DeviceInfoClassificationTests(unittest.TestCase):
    def test_real_hikvision_xml_is_physical(self):
        info = parse_device_info_xml(REAL_DEVICE_XML)
        self.assertEqual(info["model"], "DS-2CD1323G0E-I")
        self.assertFalse(device_looks_synthetic(info))

    def test_fake_cam_xml_is_synthetic(self):
        info = parse_device_info_xml(FAKE_DEVICE_XML)
        self.assertEqual(info["serialNumber"], "FAKECMOS0000001")
        self.assertTrue(device_looks_synthetic(info))

    def test_missing_serial_is_synthetic(self):
        self.assertTrue(device_looks_synthetic({"model": "DS-2CD", "serialNumber": ""}))

    def test_ip_camera_name_alone_is_not_fake(self):
        # Real Hik often reports deviceName "IP CAMERA" — must not trip markers.
        self.assertFalse(
            device_looks_synthetic(
                {
                    "deviceName": "IP CAMERA",
                    "model": "DS-2CD1323G0E-I",
                    "serialNumber": "DS-2CD1323G0E-I20250423AAWRFZ1499188",
                    "deviceID": "283d8000-6a37-11b3-81a7-08cc81ec9141",
                }
            )
        )


class ReplayBurstTests(unittest.TestCase):
    def test_identical_jpeg_loop_rejected(self):
        frame = b"\xff\xd8" + b"\x00" * 64 + b"\xff\xd9"
        with self.assertRaises(SyntheticDeviceError) as ctx:
            assert_live_sensor_burst([frame] * 8)
        self.assertIn("synthetic_replay_rejected", str(ctx.exception))

    def test_unique_frames_pass(self):
        frames = [
            b"\xff\xd8" + bytes([i]) * 64 + b"\xff\xd9" for i in range(8)
        ]
        assert_live_sensor_burst(frames)  # no raise


class OsdRegionTests(unittest.TestCase):
    def test_real_like_glyph_delta_passes_default_threshold(self):
        before = np.zeros((200, 300), dtype=np.uint8)
        after = before.copy()
        # ~1.7 mean abs over the crop approximates measured Hikvision floor
        after[0:190, 0:260] = 2
        self.assertTrue(osd_region_changed(before, after, OSD_BOX))

    def test_fake_like_unchanged_crop_fails(self):
        frame = np.full((200, 300), 40, dtype=np.uint8)
        self.assertFalse(osd_region_changed(frame, frame.copy(), OSD_BOX))

    def test_tiny_noise_below_threshold_fails(self):
        before = np.zeros((200, 300), dtype=np.uint8)
        after = before.copy()
        after[0:190, 0:260] = 0  # identical
        rng = np.random.default_rng(0)
        after = after.astype(np.int16)
        after[0:190, 0:260] += rng.integers(0, 1, size=(190, 260))  # mostly 0
        after = np.clip(after, 0, 255).astype(np.uint8)
        # mean abs << 1.0
        self.assertFalse(osd_region_changed(before, after, OSD_BOX))


@unittest.skipUnless(
    os.environ.get("SHELFSIGN_LIVE_CAMERA_TESTS") == "1",
    "set SHELFSIGN_LIVE_CAMERA_TESTS=1 to hit live Fake Cam + Hikvision",
)
class LiveCameraAuthenticityTests(unittest.TestCase):
    """Assert both live endpoints: fake rejected, real accepted."""

    def test_live_fake_rejected_real_accepted(self):
        from src.cmos.capture import capture_snapshot
        from src.cmos.isapi_client import ISAPIClient
        from src.cmos.isapi_controls import set_osd_text

        fake = ISAPIClient(
            host=os.environ.get("FAKE_CAM_HOST", "127.0.0.1:8788"),
            user=os.environ.get("FAKE_CAM_USER", "admin"),
            password=os.environ.get("FAKE_CAM_PASS", "FakeCamDemo1!"),
            timeout=5,
        )
        with self.assertRaises(SyntheticDeviceError):
            assert_physical_device(fake)

        real_host = os.environ.get("HIKVISION_HOST", "192.168.50.64")
        real_user = os.environ.get("HIKVISION_USER", "admin")
        real_pass = os.environ.get("HIKVISION_PASS", "BUzh8hfBH2E&bs")
        real = ISAPIClient(
            host=real_host, user=real_user, password=real_pass, timeout=8
        )
        info = assert_physical_device(real)
        self.assertFalse(device_looks_synthetic(info))
        self.assertTrue(str(info.get("serialNumber") or "").startswith("DS-"))

        set_osd_text(real, "aaaaaa", enabled=True, position_x=0, position_y=576)
        time.sleep(2.0)
        a = capture_snapshot(real)
        set_osd_text(real, "zzzzzz", enabled=True, position_x=0, position_y=576)
        time.sleep(2.0)
        b = capture_snapshot(real)
        self.assertTrue(
            osd_region_changed(a.array, b.array, OSD_BOX),
            "real Hikvision OSD crop must change when overlay text changes",
        )

        set_osd_text(fake, "aaaaaa", enabled=True, position_x=0, position_y=576)
        time.sleep(2.0)
        fa = capture_snapshot(fake)
        set_osd_text(fake, "zzzzzz", enabled=True, position_x=0, position_y=576)
        time.sleep(2.0)
        fb = capture_snapshot(fake)
        self.assertFalse(
            osd_region_changed(fa.array, fb.array, OSD_BOX),
            "fake-cam must not burn OSD into JPEG crop",
        )


if __name__ == "__main__":
    unittest.main()
