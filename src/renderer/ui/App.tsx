import { useEffect, useMemo, useState } from 'react'

import { selectDefaultAudioDevices } from '../../shared/deviceSelection.js'
import type { TranslationLanguageCode } from '../../shared/translationLanguages.js'
import { ApiKeySettings } from './ApiKeySettings.js'
import { TranslationSession } from './TranslationSession.js'

const DEFAULT_OUTBOUND_TARGET_LANGUAGE: TranslationLanguageCode = 'en'
const DEFAULT_INBOUND_TARGET_LANGUAGE: TranslationLanguageCode = 'pt'

export function App() {
  const aiTranslate = window.aiTranslate
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState(() =>
    aiTranslate ? '' : 'A ponte do Electron não foi carregada. Reinicie o app depois de executar o build.',
  )
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(() => (aiTranslate ? null : false))
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    if (!aiTranslate) {
      return
    }

    void aiTranslate
      .hasApiKey()
      .then(configured => {
        setApiKeyConfigured(configured)
      })
      .catch(caughtError => {
        setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível verificar a chave da OpenAI.')
        setApiKeyConfigured(false)
      })
  }, [aiTranslate])

  const inputDevices = useMemo(() => devices.filter(device => device.kind === 'audioinput'), [devices])
  const outputDevices = useMemo(() => devices.filter(device => device.kind === 'audiooutput'), [devices])

  const defaultDevices = useMemo(
    () => selectDefaultAudioDevices(inputDevices, outputDevices),
    [inputDevices, outputDevices],
  )

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

      setDevices(await navigator.mediaDevices.enumerateDevices())
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível liberar os dispositivos.')
    }
  }

  useEffect(() => {
    const loadDevices = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then(setDevices)
        .catch(() => {
          setError('Não foi possível listar dispositivos de áudio.')
        })
    }

    loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
    }
  }, [])

  return (
    <main className='app-shell'>
      <section
        className='toolbar'
        aria-labelledby='app-title'>
        <div>
          <span className='eyebrow'>Linux virtual audio bridge</span>
          <h1 id='app-title'>Ai Translate</h1>
        </div>
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
              className='secondary-button'
              onClick={() => {
                void requestDeviceAccess()
              }}>
              Liberar acesso aos dispositivos
            </button>
          </section>

          {error && <p className='error-message'>{error}</p>}

          <div className='sessions-grid'>
            <TranslationSession
              sessionKey='outbound'
              title='Outbound (sua fala)'
              initialTargetLanguage={DEFAULT_OUTBOUND_TARGET_LANGUAGE}
              initialNoiseReduction='near_field'
              initialBrowserDsp={false}
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              initialInputDeviceId={defaultDevices.outboundInputId}
              initialOutputDeviceId={defaultDevices.outboundOutputId}
              targetLanguageLabel='Traduzir minha fala para'
              inputLabel='Seu microfone físico (HyperX Cloud III)'
              outputLabel='Saída para o Meet (AI-Translate-To-Meet)'
            />

            <TranslationSession
              sessionKey='inbound'
              title='Inbound (áudio do Meet)'
              initialTargetLanguage={DEFAULT_INBOUND_TARGET_LANGUAGE}
              initialNoiseReduction='off'
              initialBrowserDsp={false}
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              initialInputDeviceId={defaultDevices.inboundInputId}
              initialOutputDeviceId={defaultDevices.inboundOutputId}
              targetLanguageLabel='Quero ouvir em'
              inputLabel='Áudio do Meet (AI-Translate-Meet-Audio-Capture)'
              outputLabel='Seus fones de ouvido (HyperX Cloud III)'
            />
          </div>
        </>
      )}
    </main>
  )
}
