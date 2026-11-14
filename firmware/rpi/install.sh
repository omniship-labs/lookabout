#!/usr/bin/env bash
# Installs the Lookabout camera service on Raspberry Pi OS (Bookworm or newer).
#   ./install.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_AS="${SUDO_USER:-$USER}"

echo "Installing camera tools (ffmpeg for USB webcams, rpicam-apps for Pi camera modules)"
sudo apt-get update
sudo apt-get install -y ffmpeg avahi-daemon
sudo apt-get install -y rpicam-apps || echo "rpicam-apps not available; USB webcams will still work."

sudo usermod -aG video "$RUN_AS"

sed -e "s|__USER__|$RUN_AS|" -e "s|__DIR__|$DIR|" "$DIR/systemd/lookabout-camera.service" \
  | sudo tee /etc/systemd/system/lookabout-camera.service >/dev/null
sudo cp "$DIR/systemd/lookabout.service.avahi" /etc/avahi/services/lookabout.service

sudo systemctl daemon-reload
sudo systemctl enable --now lookabout-camera.service

echo
echo "Done. Camera address: http://$(hostname).local:8080"
echo "Add it in Lookabout: Cameras > + > Raspberry Pi camera."
