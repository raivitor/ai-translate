import { useEffect, useMemo, useRef, useState } from 'react'

import { VIRTUAL_AUDIO_NODES } from '../../shared/audioBridgeTypes.js'
import {
  findMissingActiveDevice,
  REQUIRED_HEADSET_NAME,
  validateSessionRoute,
  type ActiveAudioRoute,
  type SessionDirection,
} from '../../shared/deviceSelection.js'
import {
  NOISE_REDUCTION_OPTIONS,
  resolveNoiseReductionMode,
  type NoiseReductionMode,
} from '../../shared/realtimeAudioConfig.js'
import { TRANSLATION_ROUTES } from '../../shared/translationLanguages.js'
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

function getStatusLabel(status: TranslationStatus): string {
  switch (status) {
    case 'requesting-media':
      return 'Solicitando áudio'
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

const SESSION_CONFIG = {
  outbound: {
    title: 'Outbound (sua fala → chamada)',
    inputLabel: `Microfone fixo (${REQUIRED_HEADSET_NAME})`,
    outputLabel: `Saída para a chamada (${VIRTUAL_AUDIO_NODES.toCallSinkLabel})`,
    emptyInputLabel: `Microfone ${REQUIRED_HEADSET_NAME} não detectado`,
    emptyOutputLabel: `${VIRTUAL_AUDIO_NODES.toCallSinkLabel} indisponível`,
    defaultNoiseReduction: 'near_field' as NoiseReductionMode,
    enableMute: true,
    enableVolumeControl: false,
  },
  inbound: {
    title: 'Inbound (áudio da chamada → fone)',
    inputLabel: `Áudio da chamada (${VIRTUAL_AUDIO_NODES.fromCallCaptureLabel})`,
    outputLabel: `Saída fixa (${REQUIRED_HEADSET_NAME})`,
    emptyInputLabel: `${VIRTUAL_AUDIO_NODES.fromCallCaptureLabel} indisponível`,
    emptyOutputLabel: `Saída ${REQUIRED_HEADSET_NAME} não detectada`,
    defaultNoiseReduction: 'off' as NoiseReductionMode,
    enableMute: false,
    enableVolumeControl: true,
  },
} as const

function readStoredVolume(key: string): number {
  const raw = localStorage.getItem(key)
  if (!raw) {
    return 1
  }

  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1.5 ? parsed : 1
}

export interface TranslationSessionProps {
  direction: SessionDirection
  inputDevices: MediaDeviceInfo[]
  outputDevices: MediaDeviceInfo[]
  inputDeviceId: string
  outputDeviceId: string
  command?: SessionCommand | undefined
  onRunningChange?: (running: boolean) => void
}

export function TranslationSession({
  direction,
  inputDevices,
  outputDevices,
  inputDeviceId: configuredInputDeviceId,
  outputDeviceId: configuredOutputDeviceId,
  command,
  onRunningChange,
}: TranslationSessionProps) {
  const config = SESSION_CONFIG[direction]
  const translationRoute = TRANSLATION_ROUTES[direction]
  const { enableMute, enableVolumeControl } = config

  const activeSession = useRef<ActiveTranslationSession | undefined>(undefined)
  const sessionAbortController = useRef<AbortController | undefined>(undefined)
  const lastHandledCommandSeq = useRef(command?.seq ?? 0)
  const latestMutedRef = useRef(false)
  const activeRouteRef = useRef<ActiveAudioRoute | null>(null)
  const mountedRef = useRef(true)

  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionMode>(() => {
    const stored = localStorage.getItem(`ai_translate_${direction}_noise_reduction`)
    return (stored && resolveNoiseReductionMode(stored)) || config.defaultNoiseReduction
  })
  const [browserDspEnabled, setBrowserDspEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem(`ai_translate_${direction}_browser_dsp`)
    return stored === 'true'
  })
  const [muted, setMuted] = useState(false)
  const [outputVolume, setOutputVolume] = useState(() => readStoredVolume(`ai_translate_${direction}_volume`))
  const latestOutputVolumeRef = useRef(outputVolume)
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [playbackReady, setPlaybackReady] = useState(false)
  const [activeRoute, setActiveRoute] = useState<ActiveAudioRoute | null>(null)
  const [levels, setLevels] = useState<AudioLevels>({ input: 0, output: 0 })
  const [stats, setStats] = useState<ConnectionStats | null>(null)
  const [error, setError] = useState('')

  const isRunning =
    status === 'requesting-media' || status === 'connecting' || status === 'connected' || status === 'reconnecting'

  // While running, keep the displayed route locked to the devices the active session is actually using.
  const effectiveInputDeviceId = isRunning && activeRoute ? activeRoute.inputId : configuredInputDeviceId
  const effectiveOutputDeviceId = isRunning && activeRoute ? activeRoute.outputId : configuredOutputDeviceId

  const resolvedInputDevice = useMemo(
    () =>
      effectiveInputDeviceId ? inputDevices.find(device => device.deviceId === effectiveInputDeviceId) : undefined,
    [effectiveInputDeviceId, inputDevices],
  )
  const resolvedOutputDevice = useMemo(
    () =>
      effectiveOutputDeviceId ? outputDevices.find(device => device.deviceId === effectiveOutputDeviceId) : undefined,
    [effectiveOutputDeviceId, outputDevices],
  )

  const displayedInputLabel =
    resolvedInputDevice?.label || (isRunning && activeRoute?.inputLabel) || config.emptyInputLabel
  const displayedOutputLabel =
    resolvedOutputDevice?.label || (isRunning && activeRoute?.outputLabel) || config.emptyOutputLabel

  const routeValidation = useMemo(
    () => validateSessionRoute(direction, effectiveInputDeviceId, effectiveOutputDeviceId, inputDevices, outputDevices),
    [direction, effectiveInputDeviceId, effectiveOutputDeviceId, inputDevices, outputDevices],
  )

  const canStart = (status === 'idle' || status === 'error') && routeValidation.ok

  const latestStartRef = useRef<() => Promise<void>>(async () => undefined)
  const latestStopRef = useRef<() => void>(() => undefined)
  const onRunningChangeRef = useRef(onRunningChange)

  function handleNoiseReductionChange(mode: string): void {
    const resolvedMode = resolveNoiseReductionMode(mode)

    if (resolvedMode) {
      setNoiseReduction(resolvedMode)
      localStorage.setItem(`ai_translate_${direction}_noise_reduction`, resolvedMode)
    }
  }

  function handleBrowserDspChange(enabled: boolean): void {
    setBrowserDspEnabled(enabled)
    localStorage.setItem(`ai_translate_${direction}_browser_dsp`, String(enabled))
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
    latestOutputVolumeRef.current = clamped
    setOutputVolume(clamped)
    localStorage.setItem(`ai_translate_${direction}_volume`, String(clamped))
    activeSession.current?.setOutputVolume(clamped)
  }

  function teardownSession(): void {
    sessionAbortController.current?.abort()
    sessionAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined
    activeRouteRef.current = null
  }

  function clearRuntimeState(): void {
    setActiveRoute(null)
    setPlaybackReady(false)
    setLevels({ input: 0, output: 0 })
    setStats(null)
  }

  function stop(): void {
    teardownSession()
    clearRuntimeState()
    setStatus('idle')
  }

  async function start(): Promise<void> {
    const validation = validateSessionRoute(
      direction,
      configuredInputDeviceId,
      configuredOutputDeviceId,
      inputDevices,
      outputDevices,
    )

    if (!validation.ok) {
      setError(validation.reason)
      return
    }

    setError('')
    setStats(null)
    setPlaybackReady(false)
    teardownSession()

    const inputDevice = inputDevices.find(device => device.deviceId === configuredInputDeviceId)
    const outputDevice = outputDevices.find(device => device.deviceId === configuredOutputDeviceId)
    const nextRoute: ActiveAudioRoute = {
      inputId: configuredInputDeviceId,
      inputLabel: inputDevice?.label || config.inputLabel,
      outputId: configuredOutputDeviceId,
      outputLabel: outputDevice?.label || config.outputLabel,
    }
    activeRouteRef.current = nextRoute
    setActiveRoute(nextRoute)

    const controller = new AbortController()
    sessionAbortController.current = controller

    try {
      const session = await startTranslationSession({
        inputDeviceId: nextRoute.inputId,
        outputDeviceId: nextRoute.outputId,
        targetLanguage: translationRoute.targetLanguage,
        noiseReduction,
        disableAudioDSP: !browserDspEnabled,
        initialMuted: enableMute ? latestMutedRef.current : false,
        initialOutputVolume: enableVolumeControl ? latestOutputVolumeRef.current : 1,
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
          onPlaybackReady: ready => {
            if (!controller.signal.aborted) {
              setPlaybackReady(ready)
            }
          },
          onClosed: () => {
            if (controller.signal.aborted) {
              return
            }
            if (sessionAbortController.current === controller) {
              sessionAbortController.current = undefined
            }
            activeSession.current = undefined
            activeRouteRef.current = null
            clearRuntimeState()
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
      if (enableVolumeControl) {
        session.setOutputVolume(latestOutputVolumeRef.current)
      }
    } catch (caughtError) {
      if (controller.signal.aborted) {
        return
      }

      if (sessionAbortController.current === controller) {
        sessionAbortController.current = undefined
      }
      activeRouteRef.current = null
      clearRuntimeState()
      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Falha ao iniciar tradução.')
    }
  }

  useEffect(() => {
    latestStartRef.current = start
    latestStopRef.current = stop
    onRunningChangeRef.current = onRunningChange
  })

  useEffect(() => {
    onRunningChange?.(isRunning)
  }, [isRunning, onRunningChange])

  // Stop only this direction if an actively routed device disappears while running.
  useEffect(() => {
    if (!isRunning || !activeRouteRef.current) {
      return
    }

    const missing = findMissingActiveDevice(activeRouteRef.current, inputDevices, outputDevices)
    if (!missing) {
      return
    }

    teardownSession()

    queueMicrotask(() => {
      if (!mountedRef.current) {
        return
      }
      clearRuntimeState()
      setStatus('error')
      setError(`Dispositivo "${missing.label}" desconectado. Reconecte-o para retomar esta direção.`)
    })
  }, [inputDevices, isRunning, outputDevices])

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
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionAbortController.current?.abort()
      activeSession.current?.stop()
      onRunningChangeRef.current?.(false)
    }
  }, [])

  return (
    <div className='translation-session'>
      <div className='session-header'>
        <h2 className='session-title'>{config.title}</h2>
        <div className='session-status-group'>
          {status === 'connected' && (
            <span className='stats-chip'>
              {stats?.rttMs !== null && stats?.rttMs !== undefined ? `RTT ${stats.rttMs} ms` : 'Peer conectado'}
              {stats?.jitterMs !== null && stats?.jitterMs !== undefined ? ` · Jitter ${stats.jitterMs} ms` : ''}
              {playbackReady ? ' · Áudio pronto' : ' · Aguardando áudio'}
              {stats && stats.packetsLost > 0 ? ` · Perda ${stats.packetsLost}` : ''}
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
          <span className='panel-label'>Idioma fixo</span>
          <div className='fixed-value'>
            {translationRoute.sourceLabel} → {translationRoute.targetLabel}
          </div>
        </div>

        <div className='control-panel'>
          <label htmlFor={`noise-reduction-${direction}`}>Redução de ruído (OpenAI)</label>
          <select
            id={`noise-reduction-${direction}`}
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
          <span className='panel-label'>{config.inputLabel}</span>
          <div
            className='fixed-value'
            data-missing={resolvedInputDevice ? 'false' : 'true'}>
            {displayedInputLabel}
          </div>
        </div>

        <div className='control-panel'>
          <span className='panel-label'>{config.outputLabel}</span>
          <div
            className='fixed-value'
            data-missing={resolvedOutputDevice ? 'false' : 'true'}>
            {displayedOutputLabel}
          </div>
        </div>

        <div className='control-panel compact'>
          <label className='checkbox-label'>
            <input
              type='checkbox'
              checked={browserDspEnabled}
              onChange={event => handleBrowserDspChange(event.target.checked)}
              disabled={isRunning}
            />
            DSP do navegador (AEC / NS / AGC — desligado p/ menor delay)
          </label>
        </div>

        {enableVolumeControl && (
          <div className='control-panel compact'>
            <label htmlFor={`volume-${direction}`}>Volume da tradução ({Math.round(outputVolume * 100)}%)</label>
            <input
              id={`volume-${direction}`}
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

      {!error && !routeValidation.ok && <p className='warning-message'>{routeValidation.reason}</p>}
      {error && <p className='error-message'>{error}</p>}
    </div>
  )
}
