// USB webcam on the ESP32-S3's USB host port, read as MJPEG through
// espressif/usb_host_uvc. The newest frame is kept in one buffer; the web
// server copies it out for each viewer.

#include <string.h>
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "usb/usb_host.h"
#include "usb/uvc_host.h"

#include "lookabout.h"

static const char *TAG = "camera";

#define USB_HOST_PRIORITY 15

// Formats to try, in order. The S3's USB port is full-speed (12 Mbit/s), so
// small MJPEG modes are the ones that actually work.
static const struct {
    unsigned w, h;
    float fps;
} k_formats[] = {
    {640, 480, 15}, {640, 480, 30}, {640, 480, 10}, {320, 240, 30},
    {320, 240, 15}, {800, 600, 15}, {640, 360, 15}, {1280, 720, 10},
};

static SemaphoreHandle_t s_lock;      // guards s_latest*
static SemaphoreHandle_t s_plugged;   // given when a UVC device appears
static SemaphoreHandle_t s_unplugged; // given when it goes away
static uint8_t *s_latest;
static size_t s_latest_len;
static uint32_t s_seq;
static volatile bool s_connected;
static volatile uint8_t s_dev_addr;
static uvc_host_stream_format_t s_format;

uint8_t *camera_alloc_frame(void)
{
    return heap_caps_malloc_prefer(LK_FRAME_MAX, 2, MALLOC_CAP_SPIRAM, MALLOC_CAP_DEFAULT);
}

bool camera_connected(void)
{
    return s_connected;
}

void camera_format(unsigned *width, unsigned *height, float *fps)
{
    *width = s_connected ? s_format.h_res : 0;
    *height = s_connected ? s_format.v_res : 0;
    *fps = s_connected ? s_format.fps : 0;
}

size_t camera_wait_frame(uint32_t *seq, uint8_t *buf, size_t cap, TickType_t timeout)
{
    const TickType_t start = xTaskGetTickCount();
    while (s_seq == *seq) {
        if (xTaskGetTickCount() - start >= timeout) {
            return 0;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    size_t len = 0;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_latest_len <= cap) {
        memcpy(buf, s_latest, s_latest_len);
        len = s_latest_len;
    }
    *seq = s_seq;
    xSemaphoreGive(s_lock);
    return len;
}

// Called by the UVC driver for every complete frame.
static bool on_frame(const uvc_host_frame_t *frame, void *user_ctx)
{
    // A valid JPEG starts with FF D8. Drop anything else (partial frames).
    if (frame->data_len >= 2 && frame->data_len <= LK_FRAME_MAX &&
            frame->data[0] == 0xFF && frame->data[1] == 0xD8) {
        if (xSemaphoreTake(s_lock, pdMS_TO_TICKS(20)) == pdTRUE) {
            memcpy(s_latest, frame->data, frame->data_len);
            s_latest_len = frame->data_len;
            s_seq++;
            xSemaphoreGive(s_lock);
        }
    }
    return true; // Done with the frame; the driver can reuse its buffer.
}

static void on_stream_event(const uvc_host_stream_event_data_t *event, void *user_ctx)
{
    switch (event->type) {
    case UVC_HOST_DEVICE_DISCONNECTED:
        ESP_LOGW(TAG, "Webcam unplugged");
        xSemaphoreGive(s_unplugged);
        break;
    case UVC_HOST_TRANSFER_ERROR:
        ESP_LOGW(TAG, "USB transfer error: %s", esp_err_to_name(event->transfer_error.error));
        break;
    default:
        break; // Overflow / underflow: a frame was skipped, nothing to do.
    }
}

static void on_driver_event(const uvc_host_driver_event_data_t *event, void *user_ctx)
{
    if (event->type == UVC_HOST_DRIVER_EVENT_DEVICE_CONNECTED &&
            event->device_connected.uvc_stream_index == 0) {
        s_dev_addr = event->device_connected.dev_addr;
        ESP_LOGI(TAG, "Webcam plugged in (address %d, %d formats)", s_dev_addr,
                 (int)event->device_connected.frame_info_num);
        xSemaphoreGive(s_plugged);
    }
}

static esp_err_t open_stream(uvc_host_stream_hdl_t *stream)
{
    esp_err_t err = ESP_FAIL;
    for (size_t i = 0; i < sizeof(k_formats) / sizeof(k_formats[0]); i++) {
        const uvc_host_stream_config_t config = {
            .event_cb = on_stream_event,
            .frame_cb = on_frame,
            .usb = {
                .dev_addr = s_dev_addr,
                .vid = UVC_HOST_ANY_VID,
                .pid = UVC_HOST_ANY_PID,
                .uvc_stream_index = 0,
            },
            .vs_format = {
                .h_res = k_formats[i].w,
                .v_res = k_formats[i].h,
                .fps = k_formats[i].fps,
                .format = UVC_VS_FORMAT_MJPEG,
            },
            .advanced = {
                .number_of_frame_buffers = 2,
                .frame_size = LK_FRAME_MAX,
#if CONFIG_SPIRAM
                .frame_heap_caps = MALLOC_CAP_SPIRAM,
#endif
                .number_of_urbs = 4,
                .urb_size = 10 * 1024,
            },
        };
        err = uvc_host_stream_open(&config, pdMS_TO_TICKS(1000), stream);
        if (err == ESP_OK) {
            s_format = config.vs_format;
            ESP_LOGI(TAG, "Streaming MJPEG %ux%u at %.0f fps", s_format.h_res, s_format.v_res, s_format.fps);
            return ESP_OK;
        }
    }
    ESP_LOGE(TAG, "No MJPEG mode this board can carry (%s). The webcam must offer MJPEG at 640x480 or smaller.",
             esp_err_to_name(err));
    return err;
}

static void camera_task(void *arg)
{
    while (true) {
        xSemaphoreTake(s_plugged, portMAX_DELAY);
        xSemaphoreTake(s_unplugged, 0); // clear a stale unplug

        uvc_host_stream_hdl_t stream = NULL;
        if (open_stream(&stream) != ESP_OK) {
            continue;
        }
        esp_err_t err = uvc_host_stream_start(stream);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Could not start the stream: %s", esp_err_to_name(err));
            uvc_host_stream_close(stream);
            continue;
        }
        s_connected = true;

        xSemaphoreTake(s_unplugged, portMAX_DELAY);
        s_connected = false;
        uvc_host_stream_close(stream);
    }
}

static void usb_lib_task(void *arg)
{
    while (true) {
        uint32_t flags;
        usb_host_lib_handle_events(portMAX_DELAY, &flags);
        if (flags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) {
            usb_host_device_free_all();
        }
    }
}

void camera_start(void)
{
    s_lock = xSemaphoreCreateMutex();
    s_plugged = xSemaphoreCreateBinary();
    s_unplugged = xSemaphoreCreateBinary();
    s_latest = camera_alloc_frame();
    assert(s_lock && s_plugged && s_unplugged && s_latest);

    const usb_host_config_t host_config = {
        .skip_phy_setup = false,
        .intr_flags = ESP_INTR_FLAG_LOWMED,
    };
    ESP_ERROR_CHECK(usb_host_install(&host_config));
    xTaskCreatePinnedToCore(usb_lib_task, "usb_lib", 4096, NULL, USB_HOST_PRIORITY, NULL, tskNO_AFFINITY);

    const uvc_host_driver_config_t driver_config = {
        .driver_task_stack_size = 5 * 1024,
        .driver_task_priority = USB_HOST_PRIORITY + 1,
        .xCoreID = tskNO_AFFINITY,
        .create_background_task = true,
        .event_cb = on_driver_event,
    };
    ESP_ERROR_CHECK(uvc_host_install(&driver_config));

    xTaskCreate(camera_task, "camera", 5 * 1024, NULL, 5, NULL);
    ESP_LOGI(TAG, "Waiting for a USB webcam");
}
