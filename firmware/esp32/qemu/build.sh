#!/usr/bin/env bash
# Builds the two emulator images the tests use. Run inside an ESP-IDF 5.3+
# environment (". $IDF_PATH/export.sh"), from anywhere:
#
#   firmware/esp32/qemu/build.sh
#
# out/flash.bin        a whole 4 MB flash (bootloader, partitions, app "emu-a")
# out/update-emu-b.bin an app image of version "emu-b", sent as an update
set -euo pipefail
cd "$(dirname "$0")/.."
# PlatformIO keeps the app in src/; plain ESP-IDF is told so with EXTRA_COMPONENT_DIRS.
mkdir -p qemu/out
for version in emu-a emu-b; do
    LOOKABOUT_FW_VERSION=$version idf.py -B "build-qemu-$version" \
        -DIDF_TARGET=esp32 \
        -DSDKCONFIG="build-qemu-$version/sdkconfig" \
        -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.qemu" \
        -DEXTRA_COMPONENT_DIRS="$PWD/src" \
        build
done
(cd build-qemu-emu-a && esptool.py --chip esp32 merge_bin --fill-flash-size 4MB -o ../qemu/out/flash.bin @flash_args)
cp build-qemu-emu-b/lookabout-esp32.bin qemu/out/update-emu-b.bin
ls -l qemu/out
