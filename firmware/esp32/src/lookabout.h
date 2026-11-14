// Lookabout ESP32-S3 camera — shared declarations.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"

#ifndef LOOKABOUT_FW_VERSION
#define LOOKABOUT_FW_VERSION "dev"
#endif

// Largest JPEG frame we keep. 640x480 MJPEG frames are usually 20–60 KB.
#if CONFIG_SPIRAM
#define LK_FRAME_MAX (256 * 1024)
#else
#define LK_FRAME_MAX (96 * 1024)
#endif

#define LK_MAX_VIEWERS 4
#define LK_DEFAULT_NAME "lookabout-cam"
#define LK_SETUP_SSID "Lookabout-Setup"

// ---- camera.c: USB webcam (UVC host) -------------------------------------
void camera_start(void);
bool camera_connected(void);
void camera_format(unsigned *width, unsigned *height, float *fps);
// Waits up to `timeout` for a frame newer than *seq, copies it into buf and
// updates *seq. Returns the JPEG length, or 0 if no new frame arrived.
size_t camera_wait_frame(uint32_t *seq, uint8_t *buf, size_t cap, TickType_t timeout);
// Allocates a frame-sized buffer (PSRAM when the board has it).
uint8_t *camera_alloc_frame(void);

// ---- net.c: Wi-Fi, setup hotspot, mDNS -----------------------------------
void net_start(void);
bool net_online(void);        // joined the home Wi-Fi
bool net_setup_mode(void);    // running the Lookabout-Setup hotspot
void net_ip(char *out, size_t len);
int net_rssi(void);
const char *net_name(void);   // mDNS host name, e.g. lookabout-cam
// Saves Wi-Fi details (and optionally a new name) and restarts the board.
void net_save_and_restart(const char *ssid, const char *pass, const char *name);

// ---- web.c: HTTP server ---------------------------------------------------
void web_start(void);
int web_viewers(void);
