import { useEffect, useRef, useState } from "react";
import {
  type ActiveTranslationSession,
  startTranslationSession,
  type TranslationStatus,
  type TranslationTranscriptEvent,
} from "../services/realtimeTranslation.js";

export type TranscriptState = {
  source: string;
  target: string;
};

function formatDeviceLabel(device: MediaDeviceInfo, fallback: string): string {
  return device.label || fallback;
}

function getStatusLabel(status: TranslationStatus): string {
  switch (status) {
    case "requesting-media":
      return "Solicitando microfone";
    case "connecting":
      return "Conectando Realtime";
    case "connected":
      return "Traducao ativa";
    case "stopping":
      return "Encerrando";
    case "error":
      return "Erro";
    case "idle":
    default:
      return "Pronto";
  }
}

export interface TranslationSessionProps {
  sessionKey: string;
  title: string;
  apiBaseUrl: string;
  targetLanguage: "en" | "pt";
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  initialInputDeviceId: string;
  initialOutputDeviceId: string;
  inputLabel: string;
  outputLabel: string;
  disableAudioDSP?: boolean;
}

export function TranslationSession({
  sessionKey,
  title,
  apiBaseUrl,
  targetLanguage,
  inputDevices,
  outputDevices,
  initialInputDeviceId,
  initialOutputDeviceId,
  inputLabel,
  outputLabel,
  disableAudioDSP,
}: TranslationSessionProps) {
  const activeSession = useRef<ActiveTranslationSession | undefined>(undefined);
  const hasManualInputSelection = useRef(false);
  const hasManualOutputSelection = useRef(false);
  const pendingTranscript = useRef<TranscriptState>({ source: "", target: "" });
  const transcriptFlushFrame = useRef<number | undefined>(undefined);
  const [inputDeviceId, setInputDeviceId] = useState(() => {
    return (
      localStorage.getItem(`ai_translate_${sessionKey}_input`) ||
      initialInputDeviceId
    );
  });
  const [outputDeviceId, setOutputDeviceId] = useState(() => {
    return (
      localStorage.getItem(`ai_translate_${sessionKey}_output`) ||
      initialOutputDeviceId
    );
  });
  const [enableTranscription, setEnableTranscription] = useState(false);
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptState>({
    source: "",
    target: "",
  });

  // Update device IDs when better defaults appear or current selections disappear.
  useEffect(() => {
    let updateTimeout: number | undefined;
    const currentInputExists = inputDevices.some(
      (device) => device.deviceId === inputDeviceId,
    );
    const shouldUseInitialInput =
      inputDevices.length > 0 &&
      initialInputDeviceId &&
      (!inputDeviceId ||
        !currentInputExists ||
        (!hasManualInputSelection.current &&
          inputDeviceId !== initialInputDeviceId));

    if (shouldUseInitialInput) {
      updateTimeout = window.setTimeout(() => {
        setInputDeviceId(initialInputDeviceId);
      }, 0);
    }

    return () => {
      if (updateTimeout) {
        window.clearTimeout(updateTimeout);
      }
    };
  }, [initialInputDeviceId, inputDevices, inputDeviceId]);

  useEffect(() => {
    let updateTimeout: number | undefined;
    const currentOutputExists = outputDevices.some(
      (device) => device.deviceId === outputDeviceId,
    );
    const shouldUseInitialOutput =
      outputDevices.length > 0 &&
      initialOutputDeviceId &&
      (!outputDeviceId ||
        !currentOutputExists ||
        (!hasManualOutputSelection.current &&
          outputDeviceId !== initialOutputDeviceId));

    if (shouldUseInitialOutput) {
      updateTimeout = window.setTimeout(() => {
        setOutputDeviceId(initialOutputDeviceId);
      }, 0);
    }

    return () => {
      if (updateTimeout) {
        window.clearTimeout(updateTimeout);
      }
    };
  }, [initialOutputDeviceId, outputDevices, outputDeviceId]);

  function handleInputDeviceChange(deviceId: string): void {
    hasManualInputSelection.current = true;
    setInputDeviceId(deviceId);
  }

  function handleOutputDeviceChange(deviceId: string): void {
    hasManualOutputSelection.current = true;
    setOutputDeviceId(deviceId);
  }

  // Persist selections to localStorage
  useEffect(() => {
    if (inputDeviceId) {
      localStorage.setItem(`ai_translate_${sessionKey}_input`, inputDeviceId);
    }
  }, [inputDeviceId, sessionKey]);

  useEffect(() => {
    if (outputDeviceId) {
      localStorage.setItem(`ai_translate_${sessionKey}_output`, outputDeviceId);
    }
  }, [outputDeviceId, sessionKey]);

  function resetTranscriptBuffer(): void {
    pendingTranscript.current = { source: "", target: "" };

    if (transcriptFlushFrame.current !== undefined) {
      window.cancelAnimationFrame(transcriptFlushFrame.current);
      transcriptFlushFrame.current = undefined;
    }
  }

  function flushTranscript(): void {
    transcriptFlushFrame.current = undefined;

    const queuedTranscript = pendingTranscript.current;
    pendingTranscript.current = { source: "", target: "" };

    if (!queuedTranscript.source && !queuedTranscript.target) {
      return;
    }

    setTranscript((currentTranscript) => ({
      source: `${currentTranscript.source}${queuedTranscript.source}`,
      target: `${currentTranscript.target}${queuedTranscript.target}`,
    }));
  }

  function handleTranscript(event: TranslationTranscriptEvent): void {
    if (!enableTranscription) {
      return;
    }

    pendingTranscript.current = {
      ...pendingTranscript.current,
      [event.kind]: `${pendingTranscript.current[event.kind]}${event.text}`,
    };

    if (transcriptFlushFrame.current === undefined) {
      transcriptFlushFrame.current =
        window.requestAnimationFrame(flushTranscript);
    }
  }

  async function start(): Promise<void> {
    setError("");
    resetTranscriptBuffer();
    setTranscript({ source: "", target: "" });

    activeSession.current?.stop();
    activeSession.current = undefined;

    try {
      activeSession.current = await startTranslationSession({
        apiBaseUrl,
        inputDeviceId,
        outputDeviceId,
        targetLanguage,
        enableTranscription,
        disableAudioDSP: disableAudioDSP ?? false,
        callbacks: {
          onStatusChange: setStatus,
          onTranscript: handleTranscript,
          onError: setError,
          onClosed: () => {
            activeSession.current = undefined;
          },
        },
      });
    } catch (caughtError) {
      activeSession.current?.stop();
      activeSession.current = undefined;
      setStatus("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao iniciar traducao.",
      );
    }
  }

  function stop(): void {
    activeSession.current?.stop();
    activeSession.current = undefined;
  }

  useEffect(() => {
    return () => {
      resetTranscriptBuffer();
      // Ensure we close the connection if the component unmounts
      stop();
    };
  }, []);

  const isRunning =
    status === "requesting-media" ||
    status === "connecting" ||
    status === "connected";
  const canStart = status === "idle" || status === "error";

  return (
    <div className="translation-session">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{title}</h2>
        <div className="status-badge" data-state={status}>
          {getStatusLabel(status)}
        </div>
      </div>

      <section className="control-grid" aria-label="Controles de traducao">
        <div className="control-panel">
          <label htmlFor={`input-device-${title}`}>{inputLabel}</label>
          <select
            id={`input-device-${title}`}
            value={inputDeviceId}
            onChange={(event) => handleInputDeviceChange(event.target.value)}
            disabled={isRunning}
          >
            {inputDevices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {formatDeviceLabel(device, `Entrada ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-panel">
          <label htmlFor={`output-device-${title}`}>{outputLabel}</label>
          <select
            id={`output-device-${title}`}
            value={outputDeviceId}
            onChange={(event) => handleOutputDeviceChange(event.target.value)}
            disabled={isRunning}
          >
            {outputDevices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {formatDeviceLabel(device, `Saida ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-panel compact" style={{ alignSelf: "center" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={enableTranscription}
              onChange={(e) => setEnableTranscription(e.target.checked)}
              disabled={isRunning}
            />
            Gerar legendas de texto
          </label>
        </div>
        <div className="actions" aria-label="Acoes">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void start();
            }}
            disabled={!canStart}
          >
            Iniciar
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={stop}
            disabled={!isRunning}
          >
            Parar
          </button>
        </div>
      </section>

      {error && <p className="error-message">{error}</p>}

      <section className="transcript-grid" aria-label="Legendas">
        <article>
          <h2>Original</h2>
          {enableTranscription ? (
            <p>{transcript.source || "Aguardando..."}</p>
          ) : (
            <p style={{ fontStyle: "italic", opacity: 0.7 }}>
              Legendas desabilitadas. Audio traduzido continua ativo.
            </p>
          )}
        </article>
        <article>
          <h2>Traducao</h2>
          {enableTranscription ? (
            <p>{transcript.target || "Aguardando..."}</p>
          ) : (
            <p style={{ fontStyle: "italic", opacity: 0.7 }}>
              Legendas desabilitadas. Audio traduzido continua ativo.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}
