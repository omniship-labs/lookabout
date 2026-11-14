// Wi-Fi. With saved details the board joins the home network; without them
// (or if joining keeps failing) it opens the "Lookabout-Setup" hotspot so
// the details can be entered at http://192.168.4.1.

#include <string.h>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mdns.h"
#include "nvs.h"
#include "nvs_flash.h"

#include "lookabout.h"

static const char *TAG = "net";
static const char *NVS_NS = "lookabout";

#define JOIN_ATTEMPTS_BEFORE_SETUP 8

static char s_ssid[33];
static char s_pass[65];
static char s_name[33] = LK_DEFAULT_NAME;
static char s_ip[16] = "0.0.0.0";
static volatile bool s_online;
static volatile bool s_setup;
static int s_failures;

bool net_online(void) { return s_online; }
bool net_setup_mode(void) { return s_setup; }
const char *net_name(void) { return s_name; }

void net_ip(char *out, size_t len)
{
    strlcpy(out, s_setup && !s_online ? "192.168.4.1" : s_ip, len);
}

int net_rssi(void)
{
    wifi_ap_record_t ap;
    return (s_online && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) ? ap.rssi : 0;
}

static void load_settings(void)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READONLY, &nvs) != ESP_OK) {
        return;
    }
    size_t len = sizeof(s_ssid);
    nvs_get_str(nvs, "ssid", s_ssid, &len);
    len = sizeof(s_pass);
    nvs_get_str(nvs, "pass", s_pass, &len);
    len = sizeof(s_name);
    nvs_get_str(nvs, "name", s_name, &len);
    nvs_close(nvs);
}

void net_save_and_restart(const char *ssid, const char *pass, const char *name)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_set_str(nvs, "ssid", ssid);
        nvs_set_str(nvs, "pass", pass);
        if (name && name[0]) {
            nvs_set_str(nvs, "name", name);
        }
        nvs_commit(nvs);
        nvs_close(nvs);
    }
    ESP_LOGI(TAG, "Wi-Fi details saved, restarting");
    vTaskDelay(pdMS_TO_TICKS(800)); // let the HTTP reply go out
    esp_restart();
}

static void start_setup_hotspot(void)
{
    if (s_setup) {
        return;
    }
    s_setup = true;
    wifi_config_t ap = {
        .ap = {
            .ssid = LK_SETUP_SSID,
            .ssid_len = strlen(LK_SETUP_SSID),
            .channel = 1,
            .max_connection = 2,
            .authmode = WIFI_AUTH_OPEN,
        },
    };
    esp_wifi_set_mode(s_ssid[0] ? WIFI_MODE_APSTA : WIFI_MODE_AP);
    esp_wifi_set_config(WIFI_IF_AP, &ap);
    ESP_LOGI(TAG, "Setup hotspot \"%s\" is up. Join it and open http://192.168.4.1", LK_SETUP_SSID);
}

static void start_mdns(void)
{
    if (mdns_init() != ESP_OK) {
        return;
    }
    mdns_hostname_set(s_name);
    mdns_instance_name_set("Lookabout camera");
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
    // Lets the Lookabout apps find cameras on the network without typing an address.
    mdns_txt_item_t txt[] = {{"path", "/stream"}, {"fw", LOOKABOUT_FW_VERSION}};
    mdns_service_add(s_name, "_lookabout", "_tcp", 80, txt, 2); // instance name = host name, so apps can build the address
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_online = false;
        if (++s_failures == JOIN_ATTEMPTS_BEFORE_SETUP) {
            ESP_LOGW(TAG, "Could not join \"%s\"", s_ssid);
            start_setup_hotspot();
        }
        vTaskDelay(pdMS_TO_TICKS(s_failures < JOIN_ATTEMPTS_BEFORE_SETUP ? 1000 : 10000));
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = data;
        snprintf(s_ip, sizeof(s_ip), IPSTR, IP2STR(&event->ip_info.ip));
        s_failures = 0;
        s_online = true;
        ESP_LOGI(TAG, "Online. Camera address: http://%s  (or http://%s.local)", s_ip, s_name);
    }
}

void net_start(void)
{
    load_settings();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *sta = esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();
    esp_netif_set_hostname(sta, s_name);

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, NULL));

    if (s_ssid[0]) {
        wifi_config_t sta_config = {0};
        strlcpy((char *)sta_config.sta.ssid, s_ssid, sizeof(sta_config.sta.ssid));
        strlcpy((char *)sta_config.sta.password, s_pass, sizeof(sta_config.sta.password));
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_config));
        ESP_LOGI(TAG, "Joining \"%s\"", s_ssid);
    } else {
        start_setup_hotspot();
    }
    ESP_ERROR_CHECK(esp_wifi_start());
    // Video is latency-sensitive; don't let the radio nap between frames.
    esp_wifi_set_ps(WIFI_PS_NONE);
    start_mdns();
}
