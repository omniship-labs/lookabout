idf_component_register(
    SRCS "main.c" "camera.c" "net.c" "web.c"
    INCLUDE_DIRS "."
    REQUIRES esp_wifi esp_netif esp_event nvs_flash esp_http_server usb esp_timer app_update
)
