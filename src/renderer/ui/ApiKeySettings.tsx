import { useState } from 'react'

export interface ApiKeySettingsProps {
  api: NonNullable<Window['aiTranslate']>
  hasExistingKey: boolean
  onSaved: () => void
  onCleared: () => void
}

export function ApiKeySettings({ api, hasExistingKey, onSaved, onCleared }: ApiKeySettingsProps) {
  const [key, setKey] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSave(): Promise<void> {
    const trimmed = key.trim()

    if (!trimmed) {
      setFeedback('Informe a chave antes de salvar.')
      return
    }

    setBusy(true)
    setFeedback('')

    try {
      await api.setApiKey(trimmed)
      setKey('')
      onSaved()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao salvar a chave.')
    } finally {
      setBusy(false)
    }
  }

  async function handleClear(): Promise<void> {
    setBusy(true)
    setFeedback('')

    try {
      await api.clearApiKey()
      setKey('')
      onCleared()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao remover a chave.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className='api-key-settings'
      aria-labelledby='settings-title'>
      <h2 id='settings-title'>Configurar OpenAI API Key</h2>
      <p className='settings-description'>
        A chave é armazenada localmente de forma cifrada e nunca sai do processo principal do app.
      </p>

      <div className='settings-form'>
        <label htmlFor='api-key-input'>{hasExistingKey ? 'Nova chave (substitui a atual)' : 'OPENAI_API_KEY'}</label>
        <input
          id='api-key-input'
          type='password'
          autoComplete='off'
          spellCheck={false}
          placeholder='sk-...'
          value={key}
          disabled={busy}
          onChange={e => {
            setKey(e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              void handleSave()
            }
          }}
        />

        <div className='settings-actions'>
          <button
            type='button'
            className='primary-button'
            disabled={busy}
            onClick={() => {
              void handleSave()
            }}>
            Salvar
          </button>

          {hasExistingKey && (
            <button
              type='button'
              className='secondary-button'
              disabled={busy}
              onClick={() => {
                void handleClear()
              }}>
              Limpar chave
            </button>
          )}
        </div>

        {feedback && <p className='error-message'>{feedback}</p>}
      </div>
    </section>
  )
}
