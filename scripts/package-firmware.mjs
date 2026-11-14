// Copies the ESP32 firmware build into the places that ship it:
//   public/firmware/<env>/      web: USB flashing (esptool-js) and Wi-Fi updates
//   ios/Lookabout/Resources/    iOS: Wi-Fi updates
//   android/.../assets/         Android: Wi-Fi updates
//
//   cd firmware/esp32 && pio run -e esp32-s3-uvc
//   npm run firmware:package
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = 'esp32-s3-uvc';
const build = join(root, 'firmware/esp32/.pio/build', env);

if (!existsSync(join(build, 'flasher_args.json'))) {
  console.error(`No build found. Run: cd firmware/esp32 && pio run -e ${env}`);
  process.exit(1);
}

const ini = readFileSync(join(root, 'firmware/esp32/platformio.ini'), 'utf8');
const version = (ini.match(/LOOKABOUT_FW_VERSION=\\"([^\\"]+)\\"/) || [])[1] || 'dev';
const args = JSON.parse(readFileSync(join(build, 'flasher_args.json'), 'utf8'));

// flasher_args.json names files as ESP-IDF builds them; PlatformIO renames them.
const builtName = (idfPath) => {
  if (idfPath.startsWith('bootloader/')) return 'bootloader.bin';
  if (idfPath.startsWith('partition_table/')) return 'partitions.bin';
  if (idfPath === 'ota_data_initial.bin') return 'ota_data_initial.bin';
  return 'firmware.bin';
};

const webDir = join(root, 'public/firmware', env);
mkdirSync(webDir, { recursive: true });
const parts = Object.entries(args.flash_files)
  .map(([address, file]) => ({ address: Number(address), file: builtName(file) }))
  .sort((a, b) => a.address - b.address);
parts.forEach((p) => copyFileSync(join(build, p.file), join(webDir, p.file)));

const manifest = {
  name: 'Lookabout camera',
  env,
  chip: 'ESP32-S3',
  version,
  flash: { mode: args.flash_settings.flash_mode, freq: args.flash_settings.flash_freq, size: args.flash_settings.flash_size },
  parts,
  app: 'firmware.bin', // the image sent for over-Wi-Fi updates
};
writeFileSync(join(webDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const appInfo = `${JSON.stringify({ version, file: `firmware-${env}.bin`, chip: manifest.chip })}\n`;
for (const dir of ['ios/Lookabout/Resources', 'android/app/src/main/assets']) {
  mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(build, 'firmware.bin'), join(root, dir, `firmware-${env}.bin`));
  writeFileSync(join(root, dir, 'firmware.json'), appInfo);
}

// Android can flash over USB too, so it carries every part.
const androidAssets = join(root, 'android/app/src/main/assets');
const sizes = { '2MB': 2, '4MB': 4, '8MB': 8, '16MB': 16 };
const androidParts = parts.map((p) => {
  const file = p.file === 'firmware.bin' ? `firmware-${env}.bin` : `firmware-${env}-${p.file}`;
  if (p.file !== 'firmware.bin') copyFileSync(join(build, p.file), join(androidAssets, file));
  return { address: p.address, file };
});
writeFileSync(
  join(androidAssets, 'firmware-parts.json'),
  `${JSON.stringify({ version, flashSizeBytes: (sizes[manifest.flash.size] || 4) * 1024 * 1024, parts: androidParts })}\n`
);

console.log(`Packaged ${env} firmware ${version}: ${parts.map((p) => `${p.file}@0x${p.address.toString(16)}`).join(', ')}`);
