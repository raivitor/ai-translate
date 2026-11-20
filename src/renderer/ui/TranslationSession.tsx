import { useEffect, useRef, useState } from 'react'

import { resolveSavedDeviceId } from '../../shared/deviceSelection.js'
import {
  NOISE_REDUCTION_OPTIONS,
  resolveNoiseReductionMode,
  type NoiseReductionMode,
} from '../../shared/realtimeAudioConfig.js'
import {
  resolveTranslationLanguageCode,
  TRANSLATION_LANGUAGES,
  type TranslationLanguageCode,
} from '../../shared/translationLanguages.js'
import {
  type ActiveTranslationSession,
  type AudioLevels,
  type ConnectionStats,
  startTranslationSession,
  type TranslationStatus,
} from '../services/realtimeTranslation.js'

export type SessionCommand = {
  action: 'start' | 'stop'
  seq: number
}

function formatDeviceLabel(device: MediaDeviceInfo, fallback: string): string {
  return device.label || fallback
}

function getStatusLabel(status: TranslationStatus): string {
  switch (status) {
    case 'requesting-media':
      return 'Solicitando microfone'
    case 'connecting':
      return 'Conectando Realtime'
    case 'connected':
      return 'Tradução ativa'
    case 'reconnecting':
      return 'Reconectando...'
    case 'stopping':
      return 'Encerrando'
    case 'error':
      return 'Erro'
    case 'idle':
    default:
      return 'Pronto'
  }
}

function readStoredVolume(key: string): number {
  const raw = localStorage.getItem(key)
  if (!raw) {
    return 1
  }

  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1.5 ? parsed : 1
}

export interface TranslationSessionProps {
  sessionKey: string
  title: string
  initialTargetLanguage: TranslationLanguageCode
  initialNoiseReduction: NoiseReductionMode
  initialBrowserDsp: boolean
  inputDevices: MediaDeviceInfo[]
  outputDevices: MediaDeviceInfo[]
  initialInputDeviceId: string
  initialOutputDeviceId: string
  targetLanguageLabel: string
  inputLabel: string
  outputLabel: string
  enableMute?: boolean
  enableVolumeControl?: boolean
  command?: SessionCommand | undefined
  onRunningChange?: (running: boolean) => void
}

export function TranslationSession({
  sessionKey,
  title,
  initialTargetLanguage,
  initialNoiseReduction,
  initialBrowserDsp,
  inputDevices,
  outputDevices,
  initialInputDeviceId,
  initialOutputDeviceId,
  targetLanguageLabel,
  inputLabel,
  outputLabel,
  enableMute = false,
  enableVolumeControl = false,
  command,
  onRunningChange,
}: TranslationSessionProps) {
  const activeSession = useRef<ActiveTranslationSession | undefined>(undefined)
  const startAbortController = useRef<AbortController | undefined>(undefined)
  const lastHandledCommandSeq = useRef(command?.seq ?? 0)
  const latestMutedRef = useRef(false)

  const [selectedInput, setSelectedInput] = useState(() => ({
    id: localStorage.getItem(`ai_translate_${sessionKey}_input`) ?? '',
    label: localStorage.getItem(`ai_translate_${sessionKey}_input_label`) ?? '',
  }))
  const [selectedOutput, setSelectedOutput] = useState(() => ({
    id: localStorage.getItem(`ai_translate_${sessionKey}_output`) ?? '',
    label: localStorage.getItem(`ai_translate_${sessionKey}_output_label`) ?? '',
  }))
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguageCode>(() => {
    const stored = localStorage.getItem(`ai_translate_${sessionKey}_target_language`)
    return (stored && resolveTranslationLanguageCode(stored)) || initialTargetLanguage
  })
  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionMode>(() => {
    const stored = localStorage.getItem(`ai_translate_${sessionKey}_noise_reduction`)
    return (stored && resolveNoiseReductionMode(stored)) || initialNoiseReduction
  })
  const [browserDspEnabled, setBrowserDspEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem(`ai_translate_${sessionKey}_browser_dsp`)
    return stored === 'true' ? true : stored === 'false' ? false : initialBrowserDsp
  })
  const [muted, setMuted] = useState(false)
  const [outputVolume, setOutputVolume] = useState(() => readStoredVolume(`ai_translate_${sessionKey}_volume`))
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [switchingDevice, setSwitchingDevice] = useState(false)
  const [levels, setLevels] = useState<AudioLevels>({ input: 0, output: 0 })
  const [stats, setStats] = useState<ConnectionStats | null>(null)
  const [error, setError] = useState('')

  const inputDeviceId = resolveSavedDeviceId(inputDevices, selectedInput.id, selectedInput.label, initialInputDeviceId)
  const outputDeviceId = resolveSavedDeviceId(
    outputDevices,
    selectedOutput.id,
    selectedOutput.label,
    initialOutputDeviceId,
  )

  const isRunning =
    status === 'requesting-media' || status === 'connecting' || status === 'connected' || status === 'reconnecting'
  const isBusyTransition = status === 'requesting-media' || status === 'connecting' || status === 'stopping'
  const canStart = status === 'idle' || status === 'error'
  const canChangeDevice = !isBusyTransition && !switchingDevice

  const latestStartRef = useRef<() => Promise<void>>(async () => undefined)
  const latestStopRef = useRef<() => void>(() => undefined)

  async function switchDevice(kind: 'input' | 'output', deviceId: string): Promise<void> {
    const devices = kind === 'input' ? inputDevices : outputDevices
    const deviceLabel = devices.find(device => device.deviceId === deviceId)?.label ?? ''
    const saveSelection = (): void => {
      const next = { id: deviceId, label: deviceLabel }
      if (kind === 'input') {
        setSelectedInput(next)
      } else {
        setSelectedOutput(next)
      }
      localStorage.setItem(`ai_translate_${sessionKey}_${kind}`, deviceId)
      localStorage.setItem(`ai_translate_${sessionKey}_${kind}_label`, deviceLabel)
    }

    if (!activeSession.current || (status !== 'connected' && status !== 'reconnecting')) {
      saveSelection()
      return
    }

    setError('')
    setSwitchingDevice(true)

    try {
      if (kind === 'input') {
        await activeSession.current.setInputDevice(deviceId)
      } else {
        await activeSession.current.setOutputDevice(deviceId)
      }
      saveSelection()
    } catch (caughtError) {
      const fallbackMessage =
        kind === 'input' ? 'Falha ao trocar microfone ao vivo.' : 'Falha ao trocar saída de áudio ao vivo.'
      setError(caughtError instanceof Error ? caughtError.message : fallbackMessage)
    } finally {
      setSwitchingDevice(false)
    }
  }

  function handleTargetLanguageChange(language: string): void {
    const resolvedLanguage = resolveTranslationLanguageCode(language)

    if (resolvedLanguage) {
      setTargetLanguage(resolvedLanguage)
      localStorage.setItem(`ai_translate_${sessionKey}_target_language`, resolvedLanguage)
    }
  }

  function handleNoiseReductionChange(mode: string): void {
    const resolvedMode = resolveNoiseReductionMode(mode)

    if (resolvedMode) {
      setNoiseReduction(resolvedMode)
      localStorage.setItem(`ai_translate_${sessionKey}_noise_reduction`, resolvedMode)
    }
  }

  function handleBrowserDspChange(enabled: boolean): void {
    setBrowserDspEnabled(enabled)
    localStorage.setItem(`ai_translate_${sessionKey}_browser_dsp`, String(enabled))
  }

  function toggleMute(): void {
    setMuted(previous => !previous)
  }

  function handleOutputVolumeChange(rawValue: string): void {
    const parsed = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    const clamped = Math.min(1.5, Math.max(0, parsed))
    setOutputVolume(clamped)
    localStorage.setItem(`ai_translate_${sessionKey}_volume`, String(clamped))
    activeSession.current?.setOutputVolume(clamped)
  }

  function stop(): void {
    startAbortController.current?.abort()
    startAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined
    setLevels({ input: 0, output: 0 })
    setStats(null)
    setStatus('idle')
  }

  async function start(): Promise<void> {
    setError('')
    setStats(null)
    startAbortController.current?.abort()
    activeSession.current?.stop()
    activeSession.current = undefined

    const controller = new AbortController()
    startAbortController.current = controller

    try {
      const session = await startTranslationSession({
        inputDeviceId,
        outputDeviceId,
        targetLanguage,
        noiseReduction,
        disableAudioDSP: !browserDspEnabled,
        initialMuted: enableMute ? muted : false,
        initialOutputVolume: enableVolumeControl ? outputVolume : 1,
        signal: controller.signal,
        callbacks: {
          onStatusChange: nextStatus => {
            if (!controller.signal.aborted) {
              setStatus(nextStatus)
            }
          },
          onError: message => {
            if (!controller.signal.aborted) {
              setError(message)
            }
          },
          onStats: nextStats => {
            if (!controller.signal.aborted) {
              setStats(nextStats)
            }
          },
          onLevels: nextLevels => {
            if (!controller.signal.aborted) {
              setLevels(nextLevels)
            }
          },
          onClosed: () => {
            activeSession.current = undefined
            setLevels({ input: 0, output: 0 })
            setStats(null)
          },
        },
      })

      if (controller.signal.aborted) {
        session.stop()
        return
      }

      activeSession.current = session
      if (enableMute) {
        session.setMuted(latestMutedRef.current)
      }
    } catch (caughtError) {
      if (controller.signal.aborted) {
        return
      }

      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Falha ao iniciar tradução.')
    } finally {
      if (startAbortController.current === controller) {
        startAbortController.current = undefined
      }
    }
  }

  useEffect(() => {
    latestStartRef.current = start
    latestStopRef.current = stop
  })

  useEffect(() => {
    onRunningChange?.(isRunning)
  }, [isRunning, onRunningChange])

  useEffect(() => {
    if (!command || command.seq === lastHandledCommandSeq.current) {
      return
    }

    lastHandledCommandSeq.current = command.seq

    if (command.action === 'start' && canStart) {
      void latestStartRef.current()
    } else if (command.action === 'stop' && isRunning) {
      latestStopRef.current()
    }
  }, [canStart, command, isRunning])

  useEffect(() => {
    latestMutedRef.current = muted
    if (enableMute) {
      activeSession.current?.setMuted(muted)
    }
  }, [enableMute, muted])

  useEffect(() => {
    if (!enableMute || !window.aiTranslate?.onToggleOutboundMute) {
      return
    }

    return window.aiTranslate.onToggleOutboundMute(() => {
      setMuted(previous => !previous)
    })
  }, [enableMute])

  useEffect(() => {
    return () => {
      startAbortController.current?.abort()
      activeSession.current?.stop()
    }
  }, [])

  return (
    <div className='translation-session'>
      <div className='session-header'>
        <h2 className='session-title'>{title}</h2>
        <div className='session-status-group'>
          {status === 'connected' && stats && (
            <span className='stats-chip'>
              {stats.rttMs !== null ? `RTT ${stats.rttMs} ms` : 'Conectado'}
              {stats.packetsLost > 0 ? ` · Perda ${stats.packetsLost}` : ''}
            </span>
          )}
          <div
            className='status-badge'
            data-state={status}>
            {getStatusLabel(status)}
          </div>
        </div>
      </div>

      <section
        className='control-grid'
        aria-label='Controles de tradução'>
        <div className='control-panel'>
          <label htmlFor={`target-language-${sessionKey}`}>{targetLanguageLabel}</label>
          <select
            id={`target-language-${sessionKey}`}
            value={targetLanguage}
            onChange={event => handleTargetLanguageChange(event.target.value)}
            disabled={isRunning}>
            {TRANSLATION_LANGUAGES.map(language => (
              <option
                key={language.code}
                value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </div>

        <div className='control-panel'>
          <label htmlFor={`noise-reduction-${sessionKey}`}>Redução de ruído (OpenAI)</label>
          <select
            id={`noise-reduction-${sessionKey}`}
            value={noiseReduction}
            onChange={event => handleNoiseReductionChange(event.target.value)}
            disabled={isRunning}>
            {NOISE_REDUCTION_OPTIONS.map(option => (
              <option
                key={option.value}
                value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className='control-panel'>
          <label htmlFor={`input-device-${sessionKey}`}>{inputLabel}</label>
          <select
            id={`input-device-${sessionKey}`}
            value={inputDeviceId}
            onChange={event => {
              void switchDevice('input', event.target.value)
            }}
            disabled={!canChangeDevice}>
            {inputDevices.map((device, index) => (
              <option
                key={device.deviceId || index}
                value={device.deviceId}>
                {formatDeviceLabel(device, `Entrada ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className='control-panel'>
          <label htmlFor={`output-device-${sessionKey}`}>{outputLabel}</label>
          <select
            id={`output-device-${sessionKey}`}
            value={outputDeviceId}
            onChange={event => {
              void switchDevice('output', event.target.value)
            }}
            disabled={!canChangeDevice}>
            {outputDevices.map((device, index) => (
              <option
                key={device.deviceId || index}
                value={device.deviceId}>
                {formatDeviceLabel(device, `Saída ${index + 1}`)}
              </option>
            ))}
          </select>
        </div>

        <div className='control-panel compact'>
          <label className='checkbox-label'>
            <input
              type='checkbox'
              checked={browserDspEnabled}
              onChange={event => handleBrowserDspChange(event.target.checked)}
              disabled={isRunning}
            />
            DSP do navegador (AEC / NS / AGC)
          </label>
        </div>

        {enableVolumeControl && (
          <div className='control-panel compact'>
            <label htmlFor={`volume-${sessionKey}`}>Volume da tradução ({Math.round(outputVolume * 100)}%)</label>
            <input
              id={`volume-${sessionKey}`}
              className='volume-slider'
              type='range'
              min='0'
              max='1.5'
              step='0.05'
              value={outputVolume}
              onChange={event => handleOutputVolumeChange(event.target.value)}
            />
          </div>
        )}

        <div
          className={
            enableVolumeControl ? 'control-panel compact meters-panel full-span' : 'control-panel compact meters-panel'
          }>
          <div className='meter-row'>
            <span>Entrada</span>
            <progress
              className='audio-meter'
              max={1}
              value={levels.input}
              aria-label='Nível de entrada'
            />
          </div>
          <div className='meter-row'>
            <span>Saída</span>
            <progress
              className='audio-meter'
              max={1}
              value={levels.output}
              aria-label='Nível de saída'
            />
          </div>
        </div>

        <div
          className='actions session-actions full-span'
          aria-label='Ações'>
          <button
            type='button'
            className='primary-button'
            onClick={() => {
              void start()
            }}
            disabled={!canStart}>
            Iniciar
          </button>
          <button
            type='button'
            className='danger-button'
            onClick={stop}
            disabled={!isRunning}>
            Parar
          </button>
          {enableMute && (
            <button
              type='button'
              className='secondary-button mute-button'
              data-muted={muted ? 'true' : 'false'}
              onClick={toggleMute}
              title='Atalho global: Ctrl+Shift+M'>
              {muted ? 'Microfone mutado (Ctrl+Shift+M)' : 'Mutar microfone (Ctrl+Shift+M)'}
            </button>
          )}
        </div>
      </section>

      {error && <p className='error-message'>{error}</p>}
    </div>
  )
}
