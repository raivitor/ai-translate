import { useEffect, useMemo, useRef, useState } from 'react'

import {
  type ActiveTranslationSession,
  startTranslationSession,
  type TranslationStatus,
  type TranslationTranscriptEvent,
} from '../services/realtimeTranslation.js'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
const targetLanguage = 'en'

type TranscriptState = {
  source: string
  target: string
}

function formatDeviceLabel(device: MediaDeviceInfo, fallback: string): string {
  return device.label || fallback
}

function isVirtualCableDevice(device: MediaDeviceInfo): boolean {
  const normalizedLabel = device.label.toLowerCase()

  return (
    normalizedLabel.includes('cable') ||
    normalizedLabel.includes('voicemeeter') ||
    normalizedLabel.includes('vb-audio')
  )
}

function getStatusLabel(status: TranslationStatus): string {
  switch (status) {
    case 'requesting-media':
      return 'Solicitando microfone'
    case 'connecting':
      return 'Conectando Realtime'
    case 'connected':
      return 'Traducao ativa'
    case 'stopping':
      return 'Encerrando'
    case 'error':
      return 'Erro'
    case 'idle':
    default:
      return 'Pronto'
  }
}

export function App() {
  const activeSession = useRef<ActiveTranslationSession | undefined>(undefined)
  const platform = window.aiTranslate?.platform ?? 'browser'
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [inputDeviceId, setInputDeviceId] = useState('')
  const [outputDeviceId, setOutputDeviceId] = useState('')
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState<TranscriptState>({
    source: '',
    target: '',
  })

  const inputDevices = useMemo(
    () => devices.filter((device) => device.kind === 'audioinput'),
    [devices],
  )
  const outputDevices = useMemo(
    () => devices.filter((device) => device.kind === 'audiooutput'),
    [devices],
  )

  async function refreshDevices(): Promise<void> {
    const availableDevices = await navigator.mediaDevices.enumerateDevices()
    setDevices(availableDevices)

    const availableInputs = availableDevices.filter(
      (device) => device.kind === 'audioinput',
    )
    const availableOutputs = availableDevices.filter(
      (device) => device.kind === 'audiooutput',
    )
    const preferredOutput = availableOutputs.find(isVirtualCableDevice)

    setInputDeviceId((currentDeviceId) => {
      const currentInputStillExists = availableInputs.some(
        (device) => device.deviceId === currentDeviceId,
      )

      return currentInputStillExists
        ? currentDeviceId
        : availableInputs[0]?.deviceId || ''
    })
    setOutputDeviceId((currentDeviceId) => {
      const currentOutputStillExists = availableOutputs.some(
        (device) => device.deviceId === currentDeviceId,
      )

      return currentOutputStillExists
        ? currentDeviceId
        : preferredOutput?.deviceId || availableOutputs[0]?.deviceId || ''
    })
  }

  async function requestDeviceAccess(): Promise<void> {
    try {
      setError('')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      for (const track of stream.getTracks()) {
        track.stop()
      }

      await refreshDevices()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel liberar os dispositivos.',
      )
    }
  }

  function handleTranscript(event: TranslationTranscriptEvent): void {
    setTranscript((currentTranscript) => ({
      ...currentTranscript,
      [event.kind]: `${currentTranscript[event.kind]}${event.text}`,
    }))
  }

  async function start(): Promise<void> {
    setError('')
    setTranscript({ source: '', target: '' })

    try {
      activeSession.current = await startTranslationSession({
        apiBaseUrl,
        inputDeviceId,
        outputDeviceId,
        targetLanguage,
        callbacks: {
          onStatusChange: setStatus,
          onTranscript: handleTranscript,
        },
      })
    } catch (caughtError) {
      activeSession.current?.stop()
      activeSession.current = undefined
      setStatus('error')
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Falha ao iniciar traducao.',
      )
    }
  }

  function stop(): void {
    activeSession.current?.stop()
    activeSession.current = undefined
  }

  useEffect(() => {
    const refreshTimeout = window.setTimeout(() => {
      void refreshDevices().catch(() => {
        setError('Nao foi possivel listar dispositivos de audio.')
      })
    }, 0)

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)

    return () => {
      window.clearTimeout(refreshTimeout)
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
      activeSession.current?.stop()
    }
  }, [])

  const isRunning =
    status === 'requesting-media' ||
    status === 'connecting' ||
    status === 'connected'
  const canStart = status === 'idle' || status === 'error'

  return (
    <main className="app-shell">
      <section className="toolbar" aria-labelledby="app-title">
        <div>
          <span className="eyebrow">Windows desktop audio bridge</span>
          <h1 id="app-title">Ai Translate</h1>
        </div>

        <div className="status-badge" data-state={status}>
          {getStatusLabel(status)}
        </div>
      </section>

      <section className="control-grid" aria-label="Controles de traducao">
        <div className="control-panel">
          <label htmlFor="input-device">Microfone de entrada</label>
          <select
            id="input-device"
            value={inputDeviceId}
            onChange={(event) => setInputDeviceId(event.target.value)}
            disabled={isRunning}
          >
            {inputDevices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {formatDeviceLabel(device, `Microfone ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-panel">
          <label htmlFor="output-device">Saida traduzida para o Meet</label>
          <select
            id="output-device"
            value={outputDeviceId}
            onChange={(event) => setOutputDeviceId(event.target.value)}
            disabled={isRunning}
          >
            {outputDevices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {formatDeviceLabel(device, `Saida ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-panel compact">
          <span>Modelo</span>
          <strong>gpt-realtime-translate</strong>
        </div>

        <div className="control-panel compact">
          <span>Idioma de saida</span>
          <strong>Ingles</strong>
        </div>
      </section>

      <section className="actions" aria-label="Acoes">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void requestDeviceAccess()
          }}
          disabled={isRunning}
        >
          Liberar dispositivos
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            void start()
          }}
          disabled={!canStart}
        >
          Iniciar traducao
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={stop}
          disabled={!isRunning}
        >
          Parar
        </button>
      </section>

      {error && <p className="error-message">{error}</p>}

      <section className="transcript-grid" aria-label="Legendas">
        <article>
          <h2>Original</h2>
          <p>{transcript.source || 'Aguardando fala do microfone...'}</p>
        </article>
        <article>
          <h2>Traducao</h2>
          <p>{transcript.target || 'Aguardando audio traduzido...'}</p>
        </article>
      </section>

      <section className="runtime-strip" aria-label="Ambiente">
        <div>
          <span>API local</span>
          <strong>{apiBaseUrl}</strong>
        </div>
        <div>
          <span>Plataforma</span>
          <strong>{platform}</strong>
        </div>
        <div>
          <span>Meet</span>
          <strong>Microfone: VB-CABLE/Voicemeeter</strong>
        </div>
      </section>
    </main>
  )
}
