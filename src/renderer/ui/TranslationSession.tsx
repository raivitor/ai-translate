import { useEffect, useMemo, useRef, useState } from 'react'

import {
  filterDevicesForRole,
  findMissingActiveDevice,
  resolveSavedDeviceId,
  validateDeviceForRole,
  validateSessionRoute,
  type ActiveAudioRoute,
  type SessionDirection,
} from '../../shared/deviceSelection.js'
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

function getEmptyDeviceLabel(direction: SessionDirection, role: 'input' | 'output'): string {
  if (direction === 'outbound' && role === 'output') {
    return 'AI-Translate-To-Meet indisponível'
  }
  if (direction === 'inbound' && role === 'input') {
    return 'AI-Translate-Meet-Audio-Capture indisponível'
  }
  return role === 'input' ? 'Nenhum microfone físico encontrado' : 'Nenhuma saída física encontrada'
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
  direction: SessionDirection
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
  direction,
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
  const sessionAbortController = useRef<AbortController | undefined>(undefined)
  const lastHandledCommandSeq = useRef(command?.seq ?? 0)
  const latestMutedRef = useRef(false)
  const activeRouteRef = useRef<ActiveAudioRoute | null>(null)
  const mountedRef = useRef(true)

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
  const latestOutputVolumeRef = useRef(outputVolume)
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [playbackReady, setPlaybackReady] = useState(false)
  const [activeRoute, setActiveRoute] = useState<ActiveAudioRoute | null>(null)
  const [switchingDevice, setSwitchingDevice] = useState(false)
  const [levels, setLevels] = useState<AudioLevels>({ input: 0, output: 0 })
  const [stats, setStats] = useState<ConnectionStats | null>(null)
  const [error, setError] = useState('')

  const allowedInputs = useMemo(() => filterDevicesForRole(direction, 'input', inputDevices), [direction, inputDevices])
  const allowedOutputs = useMemo(
    () => filterDevicesForRole(direction, 'output', outputDevices),
    [direction, outputDevices],
  )

  const configuredInputDeviceId = resolveSavedDeviceId(
    allowedInputs,
    selectedInput.id,
    selectedInput.label,
    initialInputDeviceId,
  )
  const configuredOutputDeviceId = resolveSavedDeviceId(
    allowedOutputs,
    selectedOutput.id,
    selectedOutput.label,
    initialOutputDeviceId,
  )

  const isRunning =
    status === 'requesting-media' || status === 'connecting' || status === 'connected' || status === 'reconnecting'
  const isBusyTransition =
    status === 'requesting-media' || status === 'connecting' || status === 'reconnecting' || status === 'stopping'

  // While running, keep the displayed selection locked to the route the active session is actually using.
  const inputDeviceId = isRunning && activeRoute ? activeRoute.inputId : configuredInputDeviceId
  const outputDeviceId = isRunning && activeRoute ? activeRoute.outputId : configuredOutputDeviceId

  const routeValidation = useMemo(
    () => validateSessionRoute(direction, inputDeviceId, outputDeviceId, inputDevices, outputDevices),
    [direction, inputDeviceId, outputDeviceId, inputDevices, outputDevices],
  )

  const canStart = (status === 'idle' || status === 'error') && routeValidation.ok
  const canChangeDevice = !isBusyTransition && !switchingDevice

  const latestStartRef = useRef<() => Promise<void>>(async () => undefined)
  const latestStopRef = useRef<() => void>(() => undefined)

  async function switchDevice(kind: 'input' | 'output', deviceId: string): Promise<void> {
    const devices = kind === 'input' ? inputDevices : outputDevices
    const validation = isRunning
      ? validateSessionRoute(
          direction,
          kind === 'input' ? deviceId : inputDeviceId,
          kind === 'output' ? deviceId : outputDeviceId,
          inputDevices,
          outputDevices,
        )
      : validateDeviceForRole(direction, kind, deviceId, devices)

    if (!validation.ok) {
      setError(validation.reason)
      return
    }

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

      if (activeRouteRef.current) {
        const updatedRoute: ActiveAudioRoute =
          kind === 'input'
            ? { ...activeRouteRef.current, inputId: deviceId, inputLabel: deviceLabel }
            : { ...activeRouteRef.current, outputId: deviceId, outputLabel: deviceLabel }
        activeRouteRef.current = updatedRoute
        setActiveRoute(updatedRoute)
      }
    }

    const targetSession = activeSession.current
    if (!targetSession || status !== 'connected') {
      setError('')
      saveSelection()
      return
    }

    setError('')
    setSwitchingDevice(true)

    try {
      if (kind === 'input') {
        await targetSession.setInputDevice(deviceId)
      } else {
        await targetSession.setOutputDevice(deviceId)
      }
      if (activeSession.current === targetSession) {
        saveSelection()
      }
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
    latestOutputVolumeRef.current = clamped
    setOutputVolume(clamped)
    localStorage.setItem(`ai_translate_${sessionKey}_volume`, String(clamped))
    activeSession.current?.setOutputVolume(clamped)
  }

  function stop(): void {
    sessionAbortController.current?.abort()
    sessionAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined
    activeRouteRef.current = null
    setActiveRoute(null)
    setPlaybackReady(false)
    setLevels({ input: 0, output: 0 })
    setStats(null)
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
    sessionAbortController.current?.abort()
    sessionAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined

    const inputDevice = inputDevices.find(device => device.deviceId === configuredInputDeviceId)
    const outputDevice = outputDevices.find(device => device.deviceId === configuredOutputDeviceId)
    const nextRoute: ActiveAudioRoute = {
      inputId: configuredInputDeviceId,
      inputLabel: inputDevice?.label || selectedInput.label,
      outputId: configuredOutputDeviceId,
      outputLabel: outputDevice?.label || selectedOutput.label,
    }
    activeRouteRef.current = nextRoute
    setActiveRoute(nextRoute)

    const controller = new AbortController()
    sessionAbortController.current = controller

    try {
      const session = await startTranslationSession({
        inputDeviceId: nextRoute.inputId,
        outputDeviceId: nextRoute.outputId,
        targetLanguage,
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
            setActiveRoute(null)
            setPlaybackReady(false)
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
      setActiveRoute(null)
      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Falha ao iniciar tradução.')
    }
  }

  useEffect(() => {
    latestStartRef.current = start
    latestStopRef.current = stop
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

    sessionAbortController.current?.abort()
    sessionAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined
    activeRouteRef.current = null

    queueMicrotask(() => {
      if (!mountedRef.current) {
        return
      }
      setActiveRoute(null)
      setPlaybackReady(false)
      setLevels({ input: 0, output: 0 })
      setStats(null)
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
    }
  }, [])

  return (
    <div className='translation-session'>
      <div className='session-header'>
        <h2 className='session-title'>{title}</h2>
        <div className='session-status-group'>
          {status === 'connected' && (
            <span className='stats-chip'>
              {stats?.rttMs !== null && stats?.rttMs !== undefined ? `RTT ${stats.rttMs} ms` : 'Peer conectado'}
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
            disabled={!canChangeDevice || allowedInputs.length === 0}>
            {allowedInputs.length === 0 && <option value=''>{getEmptyDeviceLabel(direction, 'input')}</option>}
            {allowedInputs.map((device, index) => (
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
            disabled={!canChangeDevice || allowedOutputs.length === 0}>
            {allowedOutputs.length === 0 && <option value=''>{getEmptyDeviceLabel(direction, 'output')}</option>}
            {allowedOutputs.map((device, index) => (
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

      {!error && !routeValidation.ok && <p className='warning-message'>{routeValidation.reason}</p>}
      {error && <p className='error-message'>{error}</p>}
    </div>
  )
}
