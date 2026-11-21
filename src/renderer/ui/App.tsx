import { useCallback, useEffect, useMemo, useState } from 'react'

import { VIRTUAL_AUDIO_NODES, type AudioBridgeStatus } from '../../shared/audioBridgeTypes.js'
import { REQUIRED_HEADSET_NAME, selectDefaultAudioDevices } from '../../shared/deviceSelection.js'
import { ApiKeySettings } from './ApiKeySettings.js'
import { type SessionCommand, TranslationSession } from './TranslationSession.js'

function getAudioBridgeLabel(status: AudioBridgeStatus): string {
  if (status.ready) {
    return status.managedByApp
      ? 'PipeWire: dispositivos virtuais ativos (app)'
      : 'PipeWire: dispositivos virtuais ativos'
  }

  return status.error ? `PipeWire: ${status.error}` : 'PipeWire: dispositivos virtuais pendentes'
}

function isAudioDevice(device: MediaDeviceInfo): boolean {
  return device.kind === 'audioinput' || device.kind === 'audiooutput'
}

async function listAudioDevices(autoUnlock: boolean): Promise<MediaDeviceInfo[]> {
  let audioDevices = (await navigator.mediaDevices.enumerateDevices()).filter(isAudioDevice)

  if (autoUnlock && audioDevices.some(device => !device.label)) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    for (const track of stream.getTracks()) {
      track.stop()
    }
    audioDevices = (await navigator.mediaDevices.enumerateDevices()).filter(isAudioDevice)
  }

  return audioDevices
}

export function App() {
  const aiTranslate = window.aiTranslate
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState(() =>
    aiTranslate ? '' : 'A ponte do Electron não foi carregada. Reinicie o app depois de executar o build.',
  )
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(() => (aiTranslate ? null : false))
  const [showSettings, setShowSettings] = useState(false)
  const [audioBridgeStatus, setAudioBridgeStatus] = useState<AudioBridgeStatus | null>(null)
  const [restartingBridge, setRestartingBridge] = useState(false)
  const [outboundRunning, setOutboundRunning] = useState(false)
  const [inboundRunning, setInboundRunning] = useState(false)
  const [callCommand, setCallCommand] = useState<SessionCommand | undefined>(undefined)

  useEffect(() => {
    if (!aiTranslate) {
      return
    }

    let active = true

    void aiTranslate
      .hasApiKey()
      .then(configured => {
        if (active) {
          setApiKeyConfigured(configured)
        }
      })
      .catch(caughtError => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível verificar a chave da OpenAI.')
          setApiKeyConfigured(false)
        }
      })

    return () => {
      active = false
    }
  }, [aiTranslate])

  useEffect(() => {
    let active = true

    const syncDevicesAndBridge = async (autoUnlock: boolean): Promise<void> => {
      if (aiTranslate) {
        try {
          const bridgeStatus = await aiTranslate.getAudioBridgeStatus()
          if (active) {
            setAudioBridgeStatus(bridgeStatus)
          }
        } catch {
          // Non-fatal; device enumeration still proceeds.
        }
      }

      try {
        const availableDevices = await listAudioDevices(autoUnlock).catch(() => listAudioDevices(false))
        if (active) {
          setDevices(availableDevices)
        }
      } catch {
        if (active) {
          setError('Não foi possível listar dispositivos de áudio.')
        }
      }
    }

    const handleDeviceChange = (): void => {
      void syncDevicesAndBridge(false)
    }

    void syncDevicesAndBridge(true)
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

    return () => {
      active = false
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [aiTranslate])

  const inputDevices = useMemo(() => devices.filter(device => device.kind === 'audioinput'), [devices])
  const outputDevices = useMemo(() => devices.filter(device => device.kind === 'audiooutput'), [devices])
  const hasMissingDeviceLabels = useMemo(() => devices.length > 0 && devices.some(device => !device.label), [devices])

  const defaultDevices = useMemo(
    () => selectDefaultAudioDevices(inputDevices, outputDevices),
    [inputDevices, outputDevices],
  )

  const handleOutboundRunningChange = useCallback((running: boolean) => {
    setOutboundRunning(running)
  }, [])

  const handleInboundRunningChange = useCallback((running: boolean) => {
    setInboundRunning(running)
  }, [])

  const anySessionRunning = outboundRunning || inboundRunning
  const canStartAny = Boolean(
    (defaultDevices.outboundInputId && defaultDevices.outboundOutputId) ||
    (defaultDevices.inboundInputId && defaultDevices.inboundOutputId),
  )

  function triggerCallAction(action: 'start' | 'stop'): void {
    setCallCommand(previous => ({ action, seq: (previous?.seq ?? 0) + 1 }))
  }

  async function requestDeviceAccess(): Promise<void> {
    try {
      setError('')
      setDevices(await listAudioDevices(true))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível liberar os dispositivos.')
    }
  }

  async function handleRestartAudioBridge(): Promise<void> {
    if (!aiTranslate || anySessionRunning) {
      return
    }

    setError('')
    setRestartingBridge(true)

    try {
      const status = await aiTranslate.restartAudioBridge()
      setAudioBridgeStatus(status)
      setDevices(await listAudioDevices(false))
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Não foi possível recriar os dispositivos PipeWire.',
      )
    } finally {
      setRestartingBridge(false)
    }
  }

  return (
    <main className='app-shell'>
      <section
        className='toolbar'
        aria-labelledby='app-title'>
        <div>
          <span className='eyebrow'>Baixa latência · Google Meet · Teams · Discord</span>
          <h1 id='app-title'>Ai Translate</h1>
        </div>
        <div className='toolbar-actions'>
          {audioBridgeStatus?.supported && (
            <div
              className='bridge-badge'
              data-ready={audioBridgeStatus.ready ? 'true' : 'false'}>
              {getAudioBridgeLabel(audioBridgeStatus)}
            </div>
          )}
          {apiKeyConfigured && !showSettings && (
            <button
              type='button'
              className='secondary-button'
              onClick={() => {
                setShowSettings(true)
              }}
              aria-label='Configurações'>
              Configurações
            </button>
          )}
        </div>
      </section>

      {(apiKeyConfigured === false || showSettings) && (
        <>
          {error && <p className='error-message'>{error}</p>}
          {aiTranslate && (
            <ApiKeySettings
              api={aiTranslate}
              hasExistingKey={apiKeyConfigured === true}
              onSaved={() => {
                setError('')
                setApiKeyConfigured(true)
                setShowSettings(false)
              }}
              onCleared={() => {
                setApiKeyConfigured(false)
                setShowSettings(false)
              }}
            />
          )}
        </>
      )}

      {apiKeyConfigured === null && <p className='settings-description'>Carregando configurações...</p>}

      {apiKeyConfigured === true && !showSettings && (
        <>
          <section
            className='actions global-actions'
            aria-label='Ações globais'>
            <button
              type='button'
              className={anySessionRunning ? 'danger-button' : 'primary-button'}
              disabled={!anySessionRunning && (restartingBridge || !canStartAny)}
              onClick={() => {
                triggerCallAction(anySessionRunning ? 'stop' : 'start')
              }}>
              {anySessionRunning ? 'Parar chamada' : 'Iniciar chamada'}
            </button>
            {hasMissingDeviceLabels && (
              <button
                type='button'
                className='secondary-button'
                onClick={() => {
                  void requestDeviceAccess()
                }}>
                Liberar acesso aos dispositivos
              </button>
            )}
            {audioBridgeStatus?.supported && !audioBridgeStatus.ready && (
              <button
                type='button'
                className='secondary-button'
                disabled={restartingBridge || anySessionRunning}
                title={
                  anySessionRunning
                    ? 'Pare as sessões ativas antes de recriar o áudio virtual.'
                    : 'Recriar dispositivos'
                }
                onClick={() => {
                  void handleRestartAudioBridge()
                }}>
                {restartingBridge ? 'Recriando áudio virtual...' : 'Recriar áudio virtual'}
              </button>
            )}
          </section>

          <section
            className='call-routing-hint'
            aria-label='Configuração dos aplicativos de chamada'>
            <span>
              <strong>Meet / Teams / Discord (web ou desktop):</strong> Microfone{' '}
              <code>{VIRTUAL_AUDIO_NODES.toCallMicLabel}</code> · Alto-falante{' '}
              <code>{VIRTUAL_AUDIO_NODES.fromCallSinkLabel}</code> · Headset fixo <code>{REQUIRED_HEADSET_NAME}</code>
            </span>
          </section>

          {error && <p className='error-message'>{error}</p>}

          <div className='sessions-grid'>
            <TranslationSession
              direction='outbound'
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              inputDeviceId={defaultDevices.outboundInputId}
              outputDeviceId={defaultDevices.outboundOutputId}
              command={callCommand}
              onRunningChange={handleOutboundRunningChange}
            />

            <TranslationSession
              direction='inbound'
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              inputDeviceId={defaultDevices.inboundInputId}
              outputDeviceId={defaultDevices.inboundOutputId}
              command={callCommand}
              onRunningChange={handleInboundRunningChange}
            />
          </div>
        </>
      )}
    </main>
  )
}
