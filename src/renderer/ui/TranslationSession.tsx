import { useEffect, useRef, useState } from 'react'

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
  startTranslationSession,
  type TranslationStatus,
} from '../services/realtimeTranslation.js'

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
    case 'stopping':
      return 'Encerrando'
    case 'error':
      return 'Erro'
    case 'idle':
    default:
      return 'Pronto'
  }
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
}: TranslationSessionProps) {
  const activeSession = useRef<ActiveTranslationSession | undefined>(undefined)
  const startAbortController = useRef<AbortController | undefined>(undefined)

  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(
    () => localStorage.getItem(`ai_translate_${sessionKey}_input`) ?? '',
  )
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState(
    () => localStorage.getItem(`ai_translate_${sessionKey}_output`) ?? '',
  )
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
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [error, setError] = useState('')

  const inputDeviceId = inputDevices.some(device => device.deviceId === selectedInputDeviceId)
    ? selectedInputDeviceId
    : initialInputDeviceId
  const outputDeviceId = outputDevices.some(device => device.deviceId === selectedOutputDeviceId)
    ? selectedOutputDeviceId
    : initialOutputDeviceId

  function handleInputDeviceChange(deviceId: string): void {
    setSelectedInputDeviceId(deviceId)
    localStorage.setItem(`ai_translate_${sessionKey}_input`, deviceId)
  }

  function handleOutputDeviceChange(deviceId: string): void {
    setSelectedOutputDeviceId(deviceId)
    localStorage.setItem(`ai_translate_${sessionKey}_output`, deviceId)
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

  function stop(): void {
    startAbortController.current?.abort()
    startAbortController.current = undefined
    activeSession.current?.stop()
    activeSession.current = undefined
    setStatus('idle')
  }

  async function start(): Promise<void> {
    setError('')
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
          onClosed: () => {
            activeSession.current = undefined
          },
        },
      })

      if (controller.signal.aborted) {
        session.stop()
        return
      }

      activeSession.current = session
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
    return () => {
      startAbortController.current?.abort()
      activeSession.current?.stop()
    }
  }, [])

  const isRunning = status === 'requesting-media' || status === 'connecting' || status === 'connected'
  const canStart = status === 'idle' || status === 'error'

  return (
    <div className='translation-session'>
      <div className='session-header'>
        <h2 className='session-title'>{title}</h2>
        <div
          className='status-badge'
          data-state={status}>
          {getStatusLabel(status)}
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
            onChange={event => handleInputDeviceChange(event.target.value)}
            disabled={isRunning}>
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
            onChange={event => handleOutputDeviceChange(event.target.value)}
            disabled={isRunning}>
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

        <div
          className='actions session-actions'
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
        </div>
      </section>

      {error && <p className='error-message'>{error}</p>}
    </div>
  )
}
