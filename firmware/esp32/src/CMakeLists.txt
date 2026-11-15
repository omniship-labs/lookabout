# Requirements can't depend on sdkconfig (ESP-IDF resolves them first), so the
# emulator build (CONFIG_LOOKABOUT_EMULATOR) uses the same list; only the
# sources' #if blocks differ. The USB host only exists on the S2/S3/P4.
set(requires esp_wifi esp_eth esp_netif esp_event nvs_flash esp_http_server esp_timer app_update)
if(IDF_TARGET STREQUAL "esp32s3" OR IDF_TARGET STREQUAL "esp32s2" OR IDF_TARGET STREQUAL "esp32p4")
    list(APPEND requires usb)
endif()

idf_component_register(
    SRCS "main.c" "camera.c" "net.c" "web.c"
    INCLUDE_DIRS "."
    REQUIRES ${requires}
)

# The emulator tests build two images that differ only in version.
# PlatformIO sets the version with build_flags instead.
if(DEFINED ENV{LOOKABOUT_FW_VERSION})
    target_compile_definitions(${COMPONENT_LIB} PRIVATE LOOKABOUT_FW_VERSION="$ENV{LOOKABOUT_FW_VERSION}")
endif()
