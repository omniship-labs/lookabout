"""Lets Lookabout apps find the hub on the network (_lookabout-hub._tcp)."""

import socket
import sys

SERVICE = "_lookabout-hub._tcp.local."


def NOT_ANNOUNCED():
    """What advertise() hands back when it could not announce the hub (nothing to withdraw)."""


def local_addresses():
    """This machine's addresses on the home network, best guess first."""
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 9))  # sends nothing; just picks the outgoing interface
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if info[4][0] not in found and not info[4][0].startswith("127."):
                found.append(info[4][0])
    except OSError:
        pass
    return found


def advertise(name, hub_id, port, version):
    """Announces the hub over mDNS. Returns a function that withdraws it."""
    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        print("zeroconf is not installed: apps won't find the hub on their own.", file=sys.stderr)
        return NOT_ANNOUNCED
    addresses = local_addresses()
    if not addresses:
        print("No network address found: not announcing the hub.", file=sys.stderr)
        return NOT_ANNOUNCED
    info = ServiceInfo(
        SERVICE,
        f"{name}.{SERVICE}",
        addresses=[socket.inet_aton(a) for a in addresses],
        port=port,
        properties={"id": hub_id, "name": name, "version": version, "path": "/"},
        server=f"{socket.gethostname().split('.')[0]}.local.",
    )
    try:
        zc = Zeroconf()
        zc.register_service(info, allow_name_change=True)
    except Exception as err:  # no multicast on this network, port taken, ...
        print(f"Could not announce the hub on the network: {err}", file=sys.stderr)
        return NOT_ANNOUNCED

    def withdraw():
        zc.unregister_service(info)
        zc.close()

    return withdraw
