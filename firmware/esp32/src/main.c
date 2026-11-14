// Lookabout ESP32-S3 camera: USB webcam in, MJPEG over Wi-Fi out.

#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "lookabout.h"

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_LOGI("lookabout", "Lookabout camera firmware %s", LOOKABOUT_FW_VERSION);
    net_start();
    camera_start();
    web_start();
}
