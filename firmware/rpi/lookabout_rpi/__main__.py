"""Lookabout camera node for Raspberry Pi.

Reads MJPEG from a Pi camera module (rpicam-vid / libcamera-vid) or a USB
webcam (ffmpeg + V4L2) and serves it on the local network with the same HTTP
interface as the ESP32 firmware:

    GET /              status page
    GET /stream        live video (multipart MJPEG)
    GET /snapshot.jpg  one frame
    GET /api/status    JSON status

Standard library only, so it runs on a stock Raspberry Pi OS image.

    python3 -m lookabout_rpi                    # auto-detect the camera
    python3 -m lookabout_rpi --source usb       # USB webcam on /dev/video0
    python3 -m lookabout_rpi --width 1280 --height 720 --fps 15
"""

import argparse
import json
import os
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.1.0"
BOUNDARY = "lookaboutframe"
MAX_VIEWERS = 8
SOI = b"\xff\xd8"  # JPEG start of image
EOI = b"\xff\xd9"  # JPEG end of image


def split_jpegs(buffer):
    """Pulls complete JPEG frames out of a byte buffer.

    Returns (frames, remainder). The remainder is the tail that doesn't yet
    hold a complete frame and should be prepended to the next read.
    """
    frames = []
    while True:
        start = buffer.find(SOI)
        if start < 0:
            # Keep a trailing 0xFF: it may be the first half of a marker.
            return frames, buffer[-1:] if buffer.endswith(b"\xff") else b""
        end = buffer.find(EOI, start + 2)
        if end < 0:
            return frames, buffer[start:]
        frames.append(bytes(buffer[start:end + 2]))
        buffer = buffer[end + 2:]


class Camera:
    """Runs the capture command and keeps the newest frame."""

    def __init__(self, command, width, height, fps):
        self.command = command
        self.width, self.height, self.fps = width, height, fps
        self.frame = None
        self.seq = 0
        self.connected = False
        self.started = time.time()
        self._cond = threading.Condition()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while True:
            try:
                proc = subprocess.Popen(self.command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            except OSError as err:
                print(f"Could not start the camera: {err}", file=sys.stderr)
                time.sleep(5)
                continue
            pending = b""
            while True:
                chunk = proc.stdout.read1(65536)
                if not chunk:
                    break
                frames, pending = split_jpegs(pending + chunk)
                if len(pending) > 8 * 1024 * 1024:  # not MJPEG, or badly corrupt
                    pending = b""
                if frames:
                    with self._cond:
                        self.frame = frames[-1]
                        self.seq += 1
                        self.connected = True
                        self._cond.notify_all()
            proc.wait()
            self.connected = False
            print("Camera stopped; retrying in 3 s", file=sys.stderr)
            time.sleep(3)

    def wait_frame(self, seq, timeout=2.0):
        """Returns (frame, seq) once a frame newer than `seq` exists, else (None, seq)."""
        with self._cond:
            if self.seq == seq:
                self._cond.wait(timeout)
            if self.seq == seq or self.frame is None:
                return None, seq
            return self.frame, self.seq


def camera_command(source, device, width, height, fps):
    """Builds the capture command for the chosen source. Returns (name, argv) or None."""
    pi_tool = shutil.which("rpicam-vid") or shutil.which("libcamera-vid")
    if source in ("auto", "pi") and pi_tool:
        return "Pi camera module", [
            pi_tool, "--nopreview", "--timeout", "0", "--codec", "mjpeg",
            "--width", str(width), "--height", str(height), "--framerate", str(fps),
            "--output", "-",
        ]
    if source in ("auto", "usb") and shutil.which("ffmpeg") and os.path.exists(device):
        return "USB webcam", [
            "ffmpeg", "-loglevel", "error", "-f", "v4l2", "-input_format", "mjpeg",
            "-video_size", f"{width}x{height}", "-framerate", str(fps), "-i", device,
            "-c:v", "copy", "-f", "mjpeg", "-",
        ]
    return None


PAGE = """<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content='width=device-width,initial-scale=1'>
<title>Lookabout camera</title>
<style>
body{margin:0;background:#0b1220;color:#d2d8e0;font:15px/1.5 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;color:#f4f1ea;font-size:26px;letter-spacing:-.025em}
img{width:100%;border-radius:18px;background:#141f33;border:1px solid #243349;min-height:240px;display:block}
.m{color:#9aa3b2;font-size:13px}
@media (prefers-color-scheme: light){body{background:#f7f4ee;color:#3a4453}h1{color:#0e1726}.m{color:#5b6573}}
</style>
<main><h1>Lookabout camera</h1><div class=m id=s>Loading…</div>
<img src=/stream alt='Live video from this camera'>
<div class=m>Add this camera in Lookabout with the address of this page.</div></main>
<script>
fetch('/api/status').then(r=>r.json()).then(j=>{document.getElementById('s').textContent=
j.name+' · '+(j.camera?j.source+' · '+j.width+'×'+j.height:'no camera found')+' · version '+j.firmware})
</script>"""


def make_handler(camera, name, source_name):
    viewers = {"n": 0}
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # keep the journal quiet
            pass

        def _send(self, status, content_type, body):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                self._send(200, "text/html; charset=utf-8", PAGE.encode())
            elif path == "/api/status":
                body = json.dumps({
                    "name": name,
                    "firmware": VERSION,
                    "camera": camera.connected,
                    "source": source_name,
                    "width": camera.width,
                    "height": camera.height,
                    "fps": camera.fps,
                    "viewers": viewers["n"],
                    "online": True,
                    "uptime_s": int(time.time() - camera.started),
                }).encode()
                self._send(200, "application/json", body)
            elif path == "/snapshot.jpg":
                frame, _ = camera.wait_frame(-1, timeout=1.5)
                if frame:
                    self._send(200, "image/jpeg", frame)
                else:
                    self._send(503, "text/plain", b"No camera")
            elif path == "/stream":
                self._stream()
            else:
                self._send(404, "text/plain", b"Not found")

        def _stream(self):
            with lock:
                if viewers["n"] >= MAX_VIEWERS:
                    self._send(503, "text/plain", b"Too many viewers")
                    return
                viewers["n"] += 1
            try:
                self.send_response(200)
                self.send_header("Content-Type", f"multipart/x-mixed-replace;boundary={BOUNDARY}")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                seq = -1
                while True:
                    frame, seq = camera.wait_frame(seq)
                    if frame is None:
                        continue  # camera unplugged or stalled: keep the viewer waiting
                    head = f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n"
                    self.wfile.write(head.encode() + frame + b"\r\n")
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass  # viewer went away
            finally:
                with lock:
                    viewers["n"] -= 1
                self.close_connection = True

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Lookabout camera node for Raspberry Pi")
    parser.add_argument("--source", choices=["auto", "pi", "usb"], default="auto",
                        help="Pi camera module, USB webcam, or pick whichever is present")
    parser.add_argument("--device", default="/dev/video0", help="USB webcam device")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--name", default=socket.gethostname(), help="Name shown in Lookabout")
    parser.add_argument("--command", help="Custom capture command that writes MJPEG to stdout")
    args = parser.parse_args()

    if args.command:
        source_name, command = "Custom source", shlex.split(args.command)
    else:
        found = camera_command(args.source, args.device, args.width, args.height, args.fps)
        if not found:
            sys.exit(
                "No camera found. Attach a Pi camera module (needs rpicam-apps) "
                "or a USB webcam (needs ffmpeg: sudo apt install ffmpeg)."
            )
        source_name, command = found

    camera = Camera(command, args.width, args.height, args.fps)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(camera, args.name, source_name))
    server.daemon_threads = True
    print(f"Lookabout camera \"{args.name}\" ({source_name}) on http://{socket.gethostname()}.local:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
