"""Lookabout home hub.

Bridges the cameras in the house (ESP32 and Raspberry Pi nodes, RTSP
cameras, USB webcams on this machine) to paired Lookabout viewers.

    python3 -m lookabout_hub --data ./data
    python3 -m lookabout_hub --port 8787 --name "Home hub"

Meant to run in Docker with host networking; see the README in this folder.
"""

import argparse
import os
import signal
import socket
import sys

from . import VERSION
from .bridge import Go2rtc
from .discovery import advertise
from .monitor import Monitor
from .pairing import Pairing
from .server import Hub, make_server
from .store import Store


def main():
    env = os.environ.get
    parser = argparse.ArgumentParser(description="Lookabout home hub")
    parser.add_argument("--data", default=env("LOOKABOUT_HUB_DATA", "./data"),
                        help="folder for the hub's settings and recordings")
    parser.add_argument("--port", type=int, default=int(env("LOOKABOUT_HUB_PORT", "8787")))
    parser.add_argument("--name", default=env("LOOKABOUT_HUB_NAME") or "lookabout-hub",
                        help="name shown in Lookabout")
    parser.add_argument("--go2rtc", default=env("LOOKABOUT_GO2RTC"), help="path to the go2rtc program")
    parser.add_argument("--no-mdns", action="store_true", help="don't announce the hub on the network")
    args = parser.parse_args()

    os.makedirs(args.data, exist_ok=True)
    store = Store(os.path.join(args.data, "hub.db"))
    bridge = Go2rtc(args.data, binary=args.go2rtc)
    monitor = Monitor(store)
    hub = Hub(store, Pairing(), bridge, monitor, args.name, args.port, args.data)

    try:
        server = make_server(hub)
    except OSError as err:
        sys.exit(f"Port {args.port} is not free: {err}")
    bridge.start(store.cameras())
    monitor.start()
    withdraw = (lambda: None) if args.no_mdns else advertise(args.name, store.hub_id(), args.port, VERSION)

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    print(f"Lookabout hub {VERSION} \"{args.name}\" on {hub.address()} "
          f"(also http://{socket.gethostname()}.local:{args.port})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        withdraw()
        bridge.stop()


if __name__ == "__main__":
    main()
