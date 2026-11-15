"""Camera kinds the hub can bridge, and checks on what a viewer sends.

    mjpeg  an ESP32 or Raspberry Pi camera node (multipart MJPEG over http)
    rtsp   any RTSP camera (Reolink, Tapo, Eufy with NAS mode, ...)
    usb    a webcam plugged into the machine the hub runs on

Addresses end up in go2rtc source strings, where "#" starts an option and
schemes such as "exec:" run commands, so everything is checked here first.
"""

import glob
import os
import re
from urllib.parse import quote, urlsplit, urlunsplit

KINDS = ("mjpeg", "rtsp", "usb")
DEFAULT_LABELS = {
    "mjpeg": ("CAMERA", "Camera via hub"),
    "rtsp": ("IP CAM", "RTSP via hub"),
    "usb": ("USB CAM", "USB webcam on hub"),
}
USB_DEVICE = re.compile(r"^/dev/video\d+$")


class BadCamera(ValueError):
    """What the viewer sent can't be used; the message is shown to the person."""


def _clean_url(value, schemes, what):
    value = str(value or "").strip()
    if not value:
        raise BadCamera(f"Enter the {what}.")
    if any(ch.isspace() for ch in value) or "#" in value:
        raise BadCamera(f"The {what} can't contain spaces or #.")
    try:
        parts = urlsplit(value)
        parts.port  # raises on a port that isn't a number
    except ValueError:
        raise BadCamera(f"The {what} isn't a valid address.") from None
    if parts.scheme.lower() not in schemes or not parts.hostname:
        raise BadCamera(f"The {what} should start with {' or '.join(s + '://' for s in schemes)}.")
    return parts


def clean_camera(data):
    """Returns the fields to store for a new camera, or raises BadCamera."""
    kind = data.get("kind")
    if kind not in KINDS:
        raise BadCamera("Unknown kind of camera.")
    name = str(data.get("name") or "").strip()[:40]
    if not name:
        raise BadCamera("Give the camera a name.")
    username = str(data.get("username") or "")
    password = str(data.get("password") or "")

    if kind == "mjpeg":
        address = str(data.get("address") or "").strip()
        if address and "://" not in address:
            address = "http://" + address
        parts = _clean_url(address, ("http", "https"), "camera address")
        address = urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), parts.query, ""))
        username = password = ""
    elif kind == "rtsp":
        parts = _clean_url(data.get("address"), ("rtsp", "rtsps"), "stream address")
        if parts.username:  # sign-in typed into the address itself
            username, password = parts.username, parts.password or ""
        host = parts.hostname if ":" not in parts.hostname else f"[{parts.hostname}]"
        netloc = host + (f":{parts.port}" if parts.port else "")
        address = urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))
    else:
        address = str(data.get("address") or "").strip()
        if not USB_DEVICE.match(address):
            raise BadCamera("Pick a webcam from the list.")
        username = password = ""

    device, source = DEFAULT_LABELS[kind]
    return {
        "name": name,
        "kind": kind,
        "address": address,
        "username": username,
        "password": password,
        "device": str(data.get("device") or device).strip()[:16],
        "source": str(data.get("source") or source).strip()[:60],
    }


def stream_url(camera):
    """The address go2rtc reads this camera from."""
    kind, address = camera["kind"], camera["address"]
    if kind == "mjpeg":
        parts = urlsplit(address)
        return address if parts.path else address + "/stream"
    if kind == "rtsp":
        if not camera.get("username"):
            return address
        parts = urlsplit(address)
        login = quote(camera["username"], safe="") + ":" + quote(camera.get("password", ""), safe="")
        return urlunsplit((parts.scheme, f"{login}@{parts.netloc}", parts.path, parts.query, ""))
    return f"ffmpeg:device?video={address}&input_format=mjpeg&video_size=1280x720#video=h264"


def public_camera(camera):
    """A camera as viewers see it: no sign-in details."""
    shown = {k: camera[k] for k in ("id", "name", "kind", "device", "source", "status", "since", "created")}
    shown["address"] = camera["address"]
    return shown


def usb_cameras(sys_root="/sys/class/video4linux", dev_root="/dev"):
    """Webcams plugged into this machine: [{address, name, port}]."""
    found = []
    for entry in sorted(glob.glob(os.path.join(sys_root, "video*")), key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0)):
        node = os.path.basename(entry)
        try:
            with open(os.path.join(entry, "index")) as f:
                if f.read().strip() != "0":  # each webcam also has a metadata node
                    continue
            with open(os.path.join(entry, "name")) as f:
                name = f.read().strip()
        except OSError:
            continue
        real = os.path.realpath(os.path.join(entry, "device"))
        if "/usb" not in real:  # skip the Pi's built-in codec and ISP nodes
            continue
        address = os.path.join(dev_root, node)
        if not os.path.exists(address):
            continue
        port = re.search(r"/(\d+-[\d.]+)(?::[\d.]+)?$", real)
        found.append({"address": address, "name": name.split(":")[0].strip() or "USB camera",
                      "port": port.group(1) if port else ""})
    return found
