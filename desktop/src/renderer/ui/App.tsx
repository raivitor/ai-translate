import { useEffect, useMemo, useState } from "react";

import { TranslationSession } from "./TranslationSession.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

function normalizeDeviceLabel(device: MediaDeviceInfo): string {
  return device.label.toLowerCase().replaceAll(/[\s_]+/g, "-");
}

function isVirtualCableDevice(device: MediaDeviceInfo): boolean {
  const normalizedLabel = device.label.toLowerCase();

  return (
    normalizedLabel.includes("cable") ||
    normalizedLabel.includes("voicemeeter") ||
    normalizedLabel.includes("vb-audio")
  );
}

function isAiTranslateDevice(device: MediaDeviceInfo): boolean {
  const normalizedLabel = normalizeDeviceLabel(device);

  return normalizedLabel.includes("ai-translate");
}

function isAiTranslateToMeetOutput(device: MediaDeviceInfo): boolean {
  const normalizedLabel = normalizeDeviceLabel(device);

  return (
    normalizedLabel.includes("ai-translate-to-meet") ||
    normalizedLabel.includes("ai-translate-to-meet-sink")
  );
}

function isAiTranslateFromMeetInput(device: MediaDeviceInfo): boolean {
  const normalizedLabel = normalizeDeviceLabel(device);

  return (
    normalizedLabel.includes("ai-translate-meet-audio-capture") ||
    normalizedLabel.includes("ai-translate-from-meet-capture")
  );
}

function isAiTranslateFromMeetOutput(device: MediaDeviceInfo): boolean {
  const normalizedLabel = normalizeDeviceLabel(device);

  return (
    normalizedLabel.includes("ai-translate-from-meet") ||
    normalizedLabel.includes("ai-translate-from-meet-sink")
  );
}

function isHeadphones(device: MediaDeviceInfo): boolean {
  const normalizedLabel = device.label.toLowerCase();

  return (
    normalizedLabel.includes("headphone") ||
    normalizedLabel.includes("fones") ||
    normalizedLabel.includes("earbud") ||
    normalizedLabel.includes("headset")
  );
}

export function App() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");

  const inputDevices = useMemo(
    () => devices.filter((device) => device.kind === "audioinput"),
    [devices],
  );
  const outputDevices = useMemo(
    () => devices.filter((device) => device.kind === "audiooutput"),
    [devices],
  );

  const physicalInput = inputDevices.find(
    (device) => !isAiTranslateDevice(device) && !isVirtualCableDevice(device),
  );
  const defaultOutboundInputId =
    physicalInput?.deviceId || inputDevices[0]?.deviceId || "";
  const virtualCableOutput =
    outputDevices.find(isAiTranslateToMeetOutput) ||
    outputDevices.find(isVirtualCableDevice);
  const defaultOutboundOutputId =
    virtualCableOutput?.deviceId || outputDevices[0]?.deviceId || "";

  const virtualCableInput =
    inputDevices.find(isAiTranslateFromMeetInput) ||
    inputDevices.find(isVirtualCableDevice);
  const defaultInboundInputId =
    virtualCableInput?.deviceId || inputDevices[0]?.deviceId || "";

  const headphonesOutput = outputDevices.find(isHeadphones);
  const defaultInboundOutputId =
    headphonesOutput?.deviceId ||
    outputDevices.find(
      (device) =>
        device.deviceId !== defaultOutboundOutputId &&
        !isAiTranslateFromMeetOutput(device),
    )?.deviceId ||
    outputDevices[0]?.deviceId ||
    "";

  async function refreshDevices(): Promise<void> {
    const availableDevices = await navigator.mediaDevices.enumerateDevices();
    setDevices(availableDevices);
  }

  async function requestDeviceAccess(): Promise<void> {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      for (const track of stream.getTracks()) {
        track.stop();
      }

      await refreshDevices();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Nao foi possivel liberar os dispositivos.",
      );
    }
  }

  useEffect(() => {
    const refreshTimeout = window.setTimeout(() => {
      void refreshDevices().catch(() => {
        setError("Nao foi possivel listar dispositivos de audio.");
      });
    }, 0);

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      window.clearTimeout(refreshTimeout);
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        refreshDevices,
      );
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="toolbar" aria-labelledby="app-title">
        <div>
          <span className="eyebrow">Linux virtual audio bridge</span>
          <h1 id="app-title">Ai Translate</h1>
        </div>
      </section>

      <section
        className="actions"
        aria-label="Acoes globais"
        style={{ marginBottom: "2rem" }}
      >
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void requestDeviceAccess();
          }}
        >
          Liberar acesso aos dispositivos
        </button>
      </section>

      {error && <p className="error-message">{error}</p>}

      <div className="sessions-grid">
        <TranslationSession
          sessionKey="outbound"
          title="Outbound (Falar pt-br)"
          apiBaseUrl={apiBaseUrl}
          targetLanguage="en"
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          initialInputDeviceId={defaultOutboundInputId}
          initialOutputDeviceId={defaultOutboundOutputId}
          inputLabel="Seu microfone físico"
          outputLabel="Saída para o Meet (AI-Translate-To-Meet)"
          disableAudioDSP={true}
        />

        <TranslationSession
          sessionKey="inbound"
          title="Inbound (Ouvir pt-br)"
          apiBaseUrl={apiBaseUrl}
          targetLanguage="pt"
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          initialInputDeviceId={defaultInboundInputId}
          initialOutputDeviceId={defaultInboundOutputId}
          inputLabel="Áudio do Meet (AI-Translate-Meet-Audio-Capture)"
          outputLabel="Seus fones de ouvido"
          disableAudioDSP={true}
        />
      </div>

      <section
        className="runtime-strip"
        aria-label="Ambiente"
        style={{ marginTop: "2rem" }}
      ></section>
    </main>
  );
}
