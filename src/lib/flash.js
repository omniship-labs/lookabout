// Firmware for ESP32 cameras: first flash over USB (Web Serial + esptool-js,
// Chrome or Edge on a computer) and updates over Wi-Fi (POST /api/update).

// Under the page's base path, so it resolves on a GitHub Pages sub-path too.
const MANIFEST_URL = `${import.meta.env.BASE_URL}firmware/esp32-s3-uvc/manifest.json`;

let manifestPromise = null;

/** The firmware build that ships with this page: version, flash settings, files. */
export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL).then((res) => {
      if (!res.ok) throw new Error('No firmware build is published with this page yet.');
      return res.json();
    });
    manifestPromise.catch(() => {
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

const partUrl = (file) => MANIFEST_URL.replace('manifest.json', file);

async function fetchBytes(file) {
  const res = await fetch(partUrl(file));
  if (!res.ok) throw new Error(`Could not download ${file}.`);
  return new Uint8Array(await res.arrayBuffer());
}

// esptool-js takes images as binary strings.
function toBinaryString(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export const canFlashOverUsb = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/**
 * Flash the board plugged into this computer.
 * onStatus(text) reports the current step; onProgress(0–1) the write progress.
 */
export async function flashOverUsb({ onStatus, onProgress }) {
  if (!canFlashOverUsb()) {
    throw new Error('This browser can’t reach USB devices. Use Chrome or Edge on a computer.');
  }
  const manifest = await loadManifest();
  // The picker must open straight from the button press.
  const port = await navigator.serial.requestPort();

  onStatus('Downloading firmware');
  const images = await Promise.all(manifest.parts.map((p) => fetchBytes(p.file)));
  const total = images.reduce((sum, bytes) => sum + bytes.length, 0);

  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  try {
    onStatus('Connecting to the board');
    const loader = new ESPLoader({ transport, baudrate: 460800, romBaudrate: 115200 });
    const chip = await loader.main();
    if (!/ESP32-S3/i.test(chip)) {
      throw new Error(`This board is a ${chip}. Lookabout cameras need an ESP32-S3.`);
    }

    onStatus('Writing firmware');
    const before = images.map((_, i) => images.slice(0, i).reduce((sum, bytes) => sum + bytes.length, 0));
    await loader.writeFlash({
      fileArray: manifest.parts.map((p, i) => ({ data: toBinaryString(images[i]), address: p.address })),
      flashSize: manifest.flash.size,
      flashMode: manifest.flash.mode,
      flashFreq: manifest.flash.freq,
      eraseAll: false,
      compress: true,
      reportProgress: (index, written, size) => {
        onProgress((before[index] + (written / size) * images[index].length) / total);
      },
    });
    onProgress(1);
    onStatus('Restarting the board');
    await loader.after('hard_reset');
    return { chip, version: manifest.version };
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // Port already closed.
    }
  }
}

/** What a camera on the network reports about itself, or null if unreachable. */
export async function cameraStatus(address) {
  try {
    const res = await fetch(`${address}/api/status`, { signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Send the bundled firmware to a camera over Wi-Fi. The camera restarts into it. */
export async function updateOverWifi(address, onProgress) {
  const manifest = await loadManifest();
  const image = await fetchBytes(manifest.app);
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${address}/api/update`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText || 'The camera refused the update.'));
    };
    xhr.onerror = () => reject(new Error('Could not reach the camera. Check that it is on and on this network.'));
    xhr.send(image);
  });
  return manifest.version;
}
