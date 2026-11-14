"""Runs go2rtc and tells it which cameras to bridge.

go2rtc reads each camera (MJPEG, RTSP or a local webcam) and hands viewers a
WebRTC stream, an MJPEG stream or a single frame. Its own API listens on
this machine only; viewers reach it through the hub, which checks their key.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .cameras import stream_url


class BridgeError(Exception):
    """go2rtc is missing, not answering, or could not get video from a camera."""


def sources(camera):
    """go2rtc sources for one camera.

    The first is the camera itself. The others are made from it on demand
    when a viewer needs a format the camera doesn't send: H.264 video for
    WebRTC (MJPEG and H.265 cameras) and Opus sound.
    """
    first = stream_url(camera)
    if camera["kind"] == "usb":
        return [first]
    name = camera["id"]
    made = [f"ffmpeg:{name}#video=h264"]
    if camera["kind"] == "rtsp":
        made.insert(0, f"ffmpeg:{name}#audio=opus")
    return [first, *made]


class Go2rtc:
    def __init__(self, data_dir, binary=None, api_port=1984, rtsp_port=8554, webrtc_port=8555):
        self.binary = binary or shutil.which("go2rtc")
        self.config_path = os.path.join(data_dir, "go2rtc.yaml")
        self.api = f"http://127.0.0.1:{api_port}"
        self.api_port, self.rtsp_port, self.webrtc_port = api_port, rtsp_port, webrtc_port
        self._proc = None
        self._stopping = False

    @property
    def available(self):
        return bool(self.binary)

    def rtsp_url(self, camera_id):
        """Where other parts of the hub can read this camera from."""
        return f"rtsp://127.0.0.1:{self.rtsp_port}/{camera_id}"

    # --- process --------------------------------------------------------

    def start(self, cameras):
        if not self.available:
            print("go2rtc not found: the hub runs, but can't show video.", file=sys.stderr)
            return
        self._write_config(cameras)
        threading.Thread(target=self._run, daemon=True).start()
        self._wait_ready()

    def stop(self):
        self._stopping = True
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()

    def _write_config(self, cameras):
        # JSON strings are valid YAML, which keeps odd characters in addresses safe.
        lines = [
            "api:", f"  listen: {json.dumps(f'127.0.0.1:{self.api_port}')}",
            "rtsp:", f"  listen: {json.dumps(f'127.0.0.1:{self.rtsp_port}')}",
            "webrtc:", f"  listen: {json.dumps(f':{self.webrtc_port}')}",
            "log:", "  level: warn",
        ]
        if cameras:
            lines.append("streams:")
            for camera in cameras:
                lines.append(f"  {json.dumps(camera['id'])}:")
                lines.extend(f"    - {json.dumps(src)}" for src in sources(camera))
        tmp = self.config_path + ".tmp"
        with open(tmp, "w") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(tmp, 0o600)  # holds camera passwords
        os.replace(tmp, self.config_path)

    def _run(self):
        while not self._stopping:
            try:
                self._proc = subprocess.Popen([self.binary, "-c", self.config_path])
            except OSError as err:
                print(f"Could not start go2rtc: {err}", file=sys.stderr)
                return
            self._proc.wait()
            if not self._stopping:
                print("go2rtc stopped; restarting in 2 s", file=sys.stderr)
                time.sleep(2)

    def _wait_ready(self, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self._call("GET", "/api")
                return
            except BridgeError:
                time.sleep(0.2)
        print("go2rtc did not answer in time; video may not work yet.", file=sys.stderr)

    # --- go2rtc API -----------------------------------------------------

    def _open(self, method, path, query=None, body=None, headers=None, timeout=10):
        if not self.available:
            raise BridgeError("This hub was started without go2rtc, so it can't show video.")
        url = self.api + path + ("?" + urllib.parse.urlencode(query, doseq=True) if query else "")
        request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as err:
            detail = err.read(300).decode(errors="replace").strip()
            raise BridgeError(detail or f"go2rtc answered {err.code}") from None
        except (OSError, urllib.error.URLError) as err:
            raise BridgeError(f"go2rtc is not answering ({getattr(err, 'reason', err)})") from None

    def _call(self, method, path, query=None, body=None, headers=None, timeout=10):
        with self._open(method, path, query, body, headers, timeout) as response:
            return response.read()

    def streams(self):
        return json.loads(self._call("GET", "/api/streams") or b"{}") or {}

    def add(self, camera, cameras):
        """Starts bridging a camera now and keeps it across go2rtc restarts."""
        self._put(camera["id"], sources(camera))
        if self.available:
            self._write_config(cameras)

    def remove(self, camera_id, cameras):
        try:
            self._call("DELETE", "/api/streams", {"src": camera_id})
        except BridgeError:
            pass  # go2rtc also reports trouble saving its own config, which the hub rewrites anyway
        if self.available:
            self._write_config(cameras)

    def _put(self, name, srcs):
        try:
            self._call("PUT", "/api/streams", {"name": name, "src": srcs})
        except BridgeError:
            # The stream can be live even when go2rtc fails to save its config.
            if name not in self.streams():
                raise

    def frame(self, camera_id, timeout=15):
        """One JPEG frame from a camera."""
        frame = self._call("GET", "/api/frame.jpeg", {"src": camera_id}, timeout=timeout)
        if not frame:  # go2rtc answers 200 with nothing when the camera gives no video
            raise BridgeError("No video came from the camera. Check its address and that it is switched on.")
        return frame

    def mjpeg(self, camera_id):
        """An open MJPEG stream; the caller reads it and closes it."""
        return self._open("GET", "/api/stream.mjpeg", {"src": camera_id}, timeout=15)

    def webrtc(self, camera_id, offer):
        """Exchanges a viewer's WebRTC offer (SDP) for go2rtc's answer."""
        answer = self._call("POST", "/api/webrtc", {"src": camera_id}, body=offer,
                            headers={"Content-Type": "application/sdp"}, timeout=20)
        return answer

    def test(self, camera):
        """Tries a camera that isn't added yet. Returns one JPEG frame."""
        name = "test-" + os.urandom(4).hex()
        self._put(name, [stream_url(camera)])
        try:
            return self.frame(name)
        finally:
            try:
                self._call("DELETE", "/api/streams", {"src": name})
            except BridgeError:
                pass
