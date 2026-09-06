"""
Typed helpers for the ISAPI controls enrollment needs: OSD text overlay,
IR-cut day/night mode, and IR illuminator brightness.

Ported from siliconwitness's gateway/isapi/controls.py (confirmed present
via /ISAPI/Image/channels/1/capabilities on a real Hikvision DS-2CD1323G0E-I).
Different camera models/firmware may expose these paths slightly
differently -- if enrollment fails with an ISAPIError on a new camera model,
this is the first place to check.
"""

from __future__ import annotations

import re
from typing import Optional

from .isapi_client import ISAPIClient

CHANNEL = 1  # video input / image channel index (not the streaming channel id)

OSD_TEXT_PATH = f"/ISAPI/System/Video/inputs/channels/{CHANNEL}/overlays/text/1"
IRCUT_PATH = f"/ISAPI/Image/channels/{CHANNEL}/ircutFilter"
SUPPLEMENT_LIGHT_PATH = f"/ISAPI/Image/channels/{CHANNEL}/supplementLight"


def set_osd_text(
    client: ISAPIClient,
    text: str,
    enabled: bool = True,
    position_x: int = 0,
    position_y: int = 576,
) -> None:
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<TextOverlay version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>1</id>
<enabled>{'true' if enabled else 'false'}</enabled>
<positionX>{position_x}</positionX>
<positionY>{position_y}</positionY>
<displayText>{text}</displayText>
<isPersistentText>true</isPersistentText>
</TextOverlay>"""
    client.put_xml(OSD_TEXT_PATH, body)


def set_ircut_mode(client: ISAPIClient, mode: str) -> None:
    """mode in {day, night, auto, schedule}."""
    assert mode in ("day", "night", "auto", "schedule")
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<IrcutFilter version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<IrcutFilterType>{mode}</IrcutFilterType>
</IrcutFilter>"""
    client.put_xml(IRCUT_PATH, body)


def get_ircut_mode(client: ISAPIClient) -> Optional[str]:
    xml = client.get_xml(IRCUT_PATH)
    m = re.search(r"<IrcutFilterType>(.*?)</IrcutFilterType>", xml)
    return m.group(1) if m else None


def set_ir_brightness(client: ISAPIClient, level: int, mode: str = "irLight") -> None:
    """level 0-100. mode in {irLight, close}."""
    assert 0 <= level <= 100
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<SupplementLight version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<supplementLightMode>{mode}</supplementLightMode>
<mixedLightBrightnessRegulatMode>manual</mixedLightBrightnessRegulatMode>
<irLightBrightness>{level}</irLightBrightness>
</SupplementLight>"""
    client.put_xml(SUPPLEMENT_LIGHT_PATH, body)


# --- Image brightness / saturation (SiliconWitness challenge actuators) ---
COLOR_PATH = f"/ISAPI/Image/channels/{CHANNEL}/color"


def set_color(
    client: ISAPIClient,
    brightness: Optional[int] = None,
    saturation: Optional[int] = None,
    contrast: Optional[int] = None,
) -> None:
    b = brightness if brightness is not None else 50
    s = saturation if saturation is not None else 50
    c = contrast if contrast is not None else 50
    for v in (b, s, c):
        assert 0 <= v <= 100
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<Color version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<brightnessLevel>{b}</brightnessLevel>
<contrastLevel>{c}</contrastLevel>
<saturationLevel>{s}</saturationLevel>
</Color>"""
    client.put_xml(COLOR_PATH, body)
