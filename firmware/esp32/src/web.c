// HTTP server on port 80.
//   GET  /              status + Wi-Fi setup page
//   GET  /stream        live video (multipart MJPEG) — what the viewer shows
//   GET  /snapshot.jpg  one frame
//   GET  /api/status    JSON status
//   POST /api/wifi      save Wi-Fi details (ssid, pass, name) and restart
//   POST /api/update    new firmware image (raw .bin body); restarts into it

#include <ctype.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "lookabout.h"

static const char *TAG = "web";
static atomic_int s_viewers;

#define BOUNDARY "lookaboutframe"

int web_viewers(void)
{
    return atomic_load(&s_viewers);
}

static void allow_any_origin(httpd_req_t *req)
{
    // The viewer runs on another origin (the web app or a native app).
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
}

// ---- /stream ---------------------------------------------------------------

static void stream_task(void *arg)
{
    httpd_req_t *req = arg;
    uint8_t *buf = camera_alloc_frame();
    uint32_t seq = 0;
    char head[96];

    if (buf) {
        httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" BOUNDARY);
        allow_any_origin(req);
        while (true) {
            size_t len = camera_wait_frame(&seq, buf, LK_FRAME_MAX, pdMS_TO_TICKS(2000));
            if (len == 0) {
                continue; // Webcam unplugged or stalled: keep the viewer waiting.
            }
            int n = snprintf(head, sizeof(head),
                             "--" BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", (unsigned)len);
            if (httpd_resp_send_chunk(req, head, n) != ESP_OK ||
                    httpd_resp_send_chunk(req, (const char *)buf, len) != ESP_OK ||
                    httpd_resp_send_chunk(req, "\r\n", 2) != ESP_OK) {
                break; // Viewer went away.
            }
        }
        free(buf);
    }
    httpd_req_async_handler_complete(req);
    atomic_fetch_sub(&s_viewers, 1);
    vTaskDelete(NULL);
}

static esp_err_t stream_handler(httpd_req_t *req)
{
    if (atomic_fetch_add(&s_viewers, 1) >= LK_MAX_VIEWERS) {
        atomic_fetch_sub(&s_viewers, 1);
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_sendstr(req, "Too many viewers");
    }
    // Hand the request to its own task so one viewer doesn't block the server.
    httpd_req_t *async_req = NULL;
    if (httpd_req_async_handler_begin(req, &async_req) != ESP_OK ||
            xTaskCreate(stream_task, "stream", 4096, async_req, 5, NULL) != pdPASS) {
        if (async_req) {
            httpd_req_async_handler_complete(async_req);
        }
        atomic_fetch_sub(&s_viewers, 1);
        return httpd_resp_send_500(req);
    }
    return ESP_OK;
}

// ---- /snapshot.jpg ---------------------------------------------------------

static esp_err_t snapshot_handler(httpd_req_t *req)
{
    uint8_t *buf = camera_alloc_frame();
    if (!buf) {
        return httpd_resp_send_500(req);
    }
    uint32_t seq = 0;
    size_t len = camera_wait_frame(&seq, buf, LK_FRAME_MAX, pdMS_TO_TICKS(1500));
    esp_err_t err;
    if (len) {
        httpd_resp_set_type(req, "image/jpeg");
        allow_any_origin(req);
        err = httpd_resp_send(req, (const char *)buf, len);
    } else {
        httpd_resp_set_status(req, "503 Service Unavailable");
        err = httpd_resp_sendstr(req, "No webcam");
    }
    free(buf);
    return err;
}

// ---- /api/status -----------------------------------------------------------

static esp_err_t status_handler(httpd_req_t *req)
{
    unsigned w, h;
    float fps;
    char ip[16];
    char json[320];
    camera_format(&w, &h, &fps);
    net_ip(ip, sizeof(ip));
    snprintf(json, sizeof(json),
             "{\"name\":\"%s\",\"firmware\":\"%s\",\"camera\":%s,\"width\":%u,\"height\":%u,\"fps\":%.0f,"
             "\"viewers\":%d,\"online\":%s,\"setup\":%s,\"ip\":\"%s\",\"rssi\":%d,\"uptime_s\":%lld}",
             net_name(), LOOKABOUT_FW_VERSION, camera_connected() ? "true" : "false", w, h, fps,
             web_viewers(), net_online() ? "true" : "false", net_setup_mode() ? "true" : "false",
             ip, net_rssi(), (long long)(esp_timer_get_time() / 1000000));
    httpd_resp_set_type(req, "application/json");
    allow_any_origin(req);
    return httpd_resp_sendstr(req, json);
}

// ---- /api/wifi -------------------------------------------------------------

static void url_decode(char *s)
{
    char *out = s;
    for (; *s; s++) {
        if (*s == '+') {
            *out++ = ' ';
        } else if (*s == '%' && isxdigit((unsigned char)s[1]) && isxdigit((unsigned char)s[2])) {
            const char hex[3] = {s[1], s[2], 0};
            *out++ = (char)strtol(hex, NULL, 16);
            s += 2;
        } else {
            *out++ = *s;
        }
    }
    *out = 0;
}

// mDNS names: lowercase letters, digits and hyphens.
static void clean_name(char *s)
{
    char *out = s;
    for (; *s; s++) {
        const char c = (char)tolower((unsigned char)*s);
        if (isalnum((unsigned char)c) || c == '-') {
            *out++ = c;
        } else if (c == ' ' || c == '_') {
            *out++ = '-';
        }
    }
    *out = 0;
}

static esp_err_t wifi_handler(httpd_req_t *req)
{
    char body[384];
    if (req->content_len == 0 || req->content_len >= sizeof(body)) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Bad form");
    }
    int got = 0;
    while (got < (int)req->content_len) {
        int n = httpd_req_recv(req, body + got, req->content_len - got);
        if (n <= 0) {
            return ESP_FAIL;
        }
        got += n;
    }
    body[got] = 0;

    char ssid[100] = "", pass[200] = "", name[100] = "";
    httpd_query_key_value(body, "ssid", ssid, sizeof(ssid));
    httpd_query_key_value(body, "pass", pass, sizeof(pass));
    httpd_query_key_value(body, "name", name, sizeof(name));
    url_decode(ssid);
    url_decode(pass);
    url_decode(name);
    clean_name(name);
    if (!ssid[0] || strlen(ssid) > 32 || strlen(pass) > 64 || strlen(name) > 32) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Check the Wi-Fi name and password");
    }

    httpd_resp_set_type(req, "text/html");
    httpd_resp_sendstr(req,
                       "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                       "<body style='font-family:system-ui;background:#0b1220;color:#f4f1ea;padding:24px'>"
                       "<h2>Saved</h2><p>The camera is restarting and joining your Wi-Fi. "
                       "Rejoin your own Wi-Fi, then add the camera in Lookabout.</p>");
    net_save_and_restart(ssid, pass, name);
    return ESP_OK;
}

// ---- /api/update -----------------------------------------------------------

// Over-Wi-Fi firmware update. The body is the raw app image (firmware.bin).
// It is written to the spare app slot and only becomes the boot image once
// the whole image has arrived and passed the bootloader's checks.
// There is no sign-in: anyone on the same network can send an update, the
// same trust level as the stream itself.
static esp_err_t update_handler(httpd_req_t *req)
{
    allow_any_origin(req);
    const esp_partition_t *slot = esp_ota_get_next_update_partition(NULL);
    if (!slot || req->content_len <= 0 || (size_t)req->content_len > slot->size) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Firmware image is missing or too large");
    }

    esp_ota_handle_t ota = 0;
    esp_err_t err = esp_ota_begin(slot, OTA_SIZE_UNKNOWN, &ota);
    if (err != ESP_OK) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not start the update");
    }

    char *chunk = malloc(4096);
    int remaining = req->content_len;
    while (chunk && remaining > 0 && err == ESP_OK) {
        int n = httpd_req_recv(req, chunk, remaining < 4096 ? remaining : 4096);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }
        if (n <= 0) {
            err = ESP_FAIL;
            break;
        }
        err = esp_ota_write(ota, chunk, n);
        remaining -= n;
    }
    free(chunk);

    if (err == ESP_ERR_OTA_VALIDATE_FAILED) {
        // esp_ota_write checks the image header on the first chunk: not a firmware file.
        esp_ota_abort(ota);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "That file is not a valid Lookabout firmware image");
    }
    if (err != ESP_OK || remaining != 0) {
        esp_ota_abort(ota);
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Update was interrupted; the camera kept its current firmware");
    }
    err = esp_ota_end(ota); // validates the image
    if (err == ESP_OK) {
        err = esp_ota_set_boot_partition(slot);
    }
    if (err != ESP_OK) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "That file is not a valid Lookabout firmware image");
    }

    ESP_LOGI(TAG, "Firmware updated, restarting");
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"ok\":true}");
    vTaskDelay(pdMS_TO_TICKS(800)); // let the reply go out
    esp_restart();
    return ESP_OK;
}

// Browsers ask permission before a cross-origin upload.
static esp_err_t update_preflight_handler(httpd_req_t *req)
{
    allow_any_origin(req);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, NULL, 0);
}

// ---- / ---------------------------------------------------------------------

static const char PAGE[] =
    "<!doctype html><html lang=en><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>Lookabout camera</title>"
    "<style>"
    "body{margin:0;background:#0b1220;color:#d2d8e0;font:15px/1.5 system-ui,sans-serif}"
    "main{max-width:560px;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;gap:16px}"
    "h1{margin:0;color:#f4f1ea;font-size:26px;letter-spacing:-.025em}"
    ".card{background:#141f33;border:1px solid #243349;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px}"
    "img{width:100%;border-radius:12px;background:#0e1726;min-height:180px;display:block}"
    "label{font-size:13px;font-weight:600;color:#f4f1ea}"
    "input{height:44px;box-sizing:border-box;width:100%;padding:0 14px;border:1px solid #2e3f58;border-radius:8px;background:#0e1726;color:#f4f1ea;font:500 16px system-ui}"
    "button{height:52px;border:0;border-radius:12px;background:#f24e1e;color:#fff;font:600 16px system-ui}"
    "small,.m{color:#9aa3b2;font-size:13px}"
    "@media (prefers-color-scheme: light){body{background:#f7f4ee;color:#3a4453}h1,label{color:#0e1726}.card{background:#fff;border-color:#e7e3da}input{background:#fff;border-color:#d8d3c8;color:#0e1726}small,.m{color:#5b6573}}"
    "</style>"
    "<main><h1>Lookabout camera</h1><div class=m id=s>Loading…</div>"
    "<div class=card><img id=v alt='Live video from the webcam'><small>Add this camera in Lookabout with the address above.</small></div>"
    "<form class=card method=post action=/api/wifi>"
    "<label for=ssid>Wi-Fi name</label><input id=ssid name=ssid maxlength=32 required autocapitalize=none>"
    "<label for=pass>Wi-Fi password</label><input id=pass name=pass type=password maxlength=64>"
    "<label for=name>Camera name on the network</label><input id=name name=name maxlength=32 placeholder=lookabout-cam autocapitalize=none>"
    "<button>Save and restart</button>"
    "<small>Details are stored on this board only.</small></form></main>"
    "<script>"
    "fetch('/api/status').then(r=>r.json()).then(j=>{"
    "document.getElementById('s').textContent="
    "(j.online?'On your Wi-Fi at http://'+j.ip+' (http://'+j.name+'.local)':'Setup mode: enter your Wi-Fi below')"
    "+' · '+(j.camera?j.width+'×'+j.height+' webcam':'no webcam plugged in')+' · firmware '+j.firmware;"
    "document.getElementById('name').value=j.name;"
    "if(j.camera)document.getElementById('v').src='/stream'})"
    "</script>";

static esp_err_t page_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, PAGE, sizeof(PAGE) - 1);
}

void web_start(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = LK_MAX_VIEWERS + 3;
    config.lru_purge_enable = true;
    config.stack_size = 6144;
    config.recv_wait_timeout = 15; // firmware uploads over slow Wi-Fi

    httpd_handle_t server = NULL;
    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Could not start the web server");
        return;
    }
    const httpd_uri_t routes[] = {
        {.uri = "/", .method = HTTP_GET, .handler = page_handler},
        {.uri = "/stream", .method = HTTP_GET, .handler = stream_handler},
        {.uri = "/snapshot.jpg", .method = HTTP_GET, .handler = snapshot_handler},
        {.uri = "/api/status", .method = HTTP_GET, .handler = status_handler},
        {.uri = "/api/wifi", .method = HTTP_POST, .handler = wifi_handler},
        {.uri = "/api/update", .method = HTTP_POST, .handler = update_handler},
        {.uri = "/api/update", .method = HTTP_OPTIONS, .handler = update_preflight_handler},
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        httpd_register_uri_handler(server, &routes[i]);
    }
}
