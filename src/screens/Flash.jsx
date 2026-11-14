import React from 'react';
import { useStore } from '../lib/store.js';
import { cameraStatus, canFlashOverUsb, flashOverUsb, loadManifest, updateOverWifi } from '../lib/flash.js';
import { BackBar, Banner, Chip, Cta, Eyebrow, Group, Note, Page, Pill, Row, RowText, StatusBox, Steps, display } from '../components/ui.jsx';
import { WarningIcon } from '../components/icons.jsx';

/** First flash: the board is plugged into this computer over USB. */
function UsbFlash({ manifest }) {
  const [state, setState] = React.useState({ step: 'idle' }); // idle | working | done | error
  const supported = canFlashOverUsb();

  const start = async () => {
    setState({ step: 'working', status: 'Pick the board’s port', progress: 0 });
    try {
      const result = await flashOverUsb({
        onStatus: (status) => setState((s) => ({ ...s, status })),
        onProgress: (progress) => setState((s) => ({ ...s, progress })),
      });
      setState({ step: 'done', version: result.version });
    } catch (err) {
      // Closing the port picker is not an error worth showing.
      if (err && err.name === 'NotFoundError') setState({ step: 'idle' });
      else setState({ step: 'error', message: (err && err.message) || 'Flashing failed.' });
    }
  };

  return (
    <>
      <Eyebrow>FIRST TIME · OVER USB</Eyebrow>
      <Steps
        items={[
          ['Plug the ESP32-S3 into this computer using the port marked ', ['UART'], ' (or COM).'],
          'Press Flash and pick the board’s port from the list.',
          'When it finishes, move the webcam to the board’s USB port and power it up.',
        ]}
      />
      {!supported ? (
        <Banner icon={<WarningIcon size={18} />} title="This browser can’t flash over USB">
          Open this page in Chrome or Edge on a computer. Phones and tablets can update a camera over Wi-Fi below once it has been flashed.
        </Banner>
      ) : null}
      {state.step === 'working' ? (
        <StatusBox label="FLASHING" progress={Math.round((state.progress || 0) * 100)}>
          {state.status}{state.progress ? ` · ${Math.round(state.progress * 100)}%` : ''}
        </StatusBox>
      ) : null}
      {state.step === 'done' ? (
        <StatusBox label="DONE">
          Firmware {state.version} is on the board. Join the “Lookabout-Setup” Wi-Fi it opens to give it your Wi-Fi details.
        </StatusBox>
      ) : null}
      {state.step === 'error' ? (
        <Banner icon={<WarningIcon size={18} />} title="Flashing didn’t finish">
          {state.message} If the board isn’t found, hold its BOOT button while you plug it in, then try again.
        </Banner>
      ) : null}
      <Cta onClick={start} disabled={!supported || !manifest || state.step === 'working'}>
        {state.step === 'done' ? 'Flash another board' : 'Flash over USB'}
      </Cta>
    </>
  );
}

function WifiRow({ cam, manifest }) {
  const [status, setStatus] = React.useState(undefined); // undefined = checking, null = unreachable
  const [state, setState] = React.useState({ step: 'idle' });

  const refresh = React.useCallback(() => {
    setStatus(undefined);
    cameraStatus(cam.address).then(setStatus);
  }, [cam.address]);
  React.useEffect(refresh, [refresh]);

  const update = async () => {
    setState({ step: 'working', progress: 0 });
    try {
      await updateOverWifi(cam.address, (progress) => setState({ step: 'working', progress }));
      setState({ step: 'done' });
      // The camera restarts into the new firmware; then show its new version.
      setTimeout(() => {
        setState({ step: 'idle' });
        refresh();
      }, 8000);
    } catch (err) {
      setState({ step: 'error', message: err.message });
    }
  };

  // The Raspberry Pi node reports a `source`; it updates with its own installer.
  const isBoard = status && !status.source;
  const current = status ? status.firmware : null;
  const upToDate = isBoard && manifest && current === manifest.version;
  let sub = 'Checking…';
  if (status === null) sub = 'Not reachable on this network';
  else if (status && !isBoard) sub = 'Raspberry Pi · update with its installer';
  else if (status) sub = `Firmware ${current}${upToDate ? ' · up to date' : manifest ? ` · ${manifest.version} available` : ''}`;
  if (state.step === 'working') sub = `Sending update · ${Math.round(state.progress * 100)}%`;
  if (state.step === 'done') sub = 'Updated. The camera is restarting.';
  if (state.step === 'error') sub = state.message;

  return (
    <Row minHeight={60} style={{ padding: 0 }}>
      <RowText title={cam.name} sub={sub} weight={600} />
      {isBoard && state.step !== 'working' ? (
        <Chip onClick={update}>{upToDate ? 'Reinstall' : 'Update'}</Chip>
      ) : null}
      {state.step === 'working' ? <Pill tone="success" small>UPDATING</Pill> : null}
    </Row>
  );
}

/** Camera firmware: flash a new ESP32 over USB, update flashed ones over Wi-Fi. */
export function Flash() {
  const s = useStore();
  const [manifest, setManifest] = React.useState(null);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    loadManifest().then(setManifest).catch(() => setMissing(true));
  }, []);
  const boards = s.direct.filter((c) => c.address);

  return (
    <Page gap={16}>
      <BackBar to="/add/esp32" eyebrow="ESP32 CAMERA" />
      <h1 style={display(26, { lineHeight: 1.15 })}>Camera firmware</h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
        For an ESP32-S3 board with a USB webcam.{manifest ? ` This page carries firmware ${manifest.version}.` : ''}
      </p>
      {missing ? (
        <Banner icon={<WarningIcon size={18} />} title="No firmware build here yet">
          Build it in firmware/esp32, then run “npm run firmware:package”.
        </Banner>
      ) : null}

      <UsbFlash manifest={manifest} />

      <Eyebrow style={{ paddingTop: 10 }}>ALREADY SET UP · OVER WI-FI</Eyebrow>
      {boards.length ? (
        <Group>
          {boards.map((cam) => (
            <WifiRow key={cam.id} cam={cam} manifest={manifest} />
          ))}
        </Group>
      ) : (
        <Note size={13}>Cameras you add by address show up here, so you can update them without unplugging anything.</Note>
      )}
      <Note>
        Updates go straight from this device to the camera over your home network. If an update is interrupted, the camera keeps its current firmware.
      </Note>
    </Page>
  );
}
