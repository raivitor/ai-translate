import {
  resolveTranslationLanguageCode,
  SUPPORTED_TRANSLATION_LANGUAGE_CODES,
  type TranslationLanguageCode,
} from '../shared/translationLanguages.js'

export const SUPPORTED_TARGET_LANGUAGES = SUPPORTED_TRANSLATION_LANGUAGE_CODES
export const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 600
export const OPENAI_REALTIME_MODEL = 'gpt-realtime-translate'
export const OPENAI_REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'

const OPENAI_TRANSLATION_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/translations/client_secrets'

export type CreateClientSecretParams = {
  targetLanguage: string
  enableTranscription?: boolean | undefined
  transcriptionLanguage?: string | undefined
  apiKey: string
  model?: string
}

export type ClientSecretResult = {
  value: string
  expiresAt: number
}

type OpenAiTranslationAudioInputConfig = {
  transcription?: {
    model: typeof OPENAI_REALTIME_TRANSCRIPTION_MODEL
    language?: TranslationLanguageCode
  }
  noise_reduction: null | {
    type: 'near_field'
  }
}

type OpenAiTranslationClientSecretResponse = {
  value?: unknown
  expires_at?: unknown
}

function getOpenAiErrorMessage(responseBody: Record<string, unknown>): string | undefined {
  const error = responseBody.error

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message : undefined
  }

  return undefined
}

export async function createClientSecret({
  targetLanguage,
  enableTranscription,
  apiKey,
  model = OPENAI_REALTIME_MODEL,
}: CreateClientSecretParams): Promise<ClientSecretResult> {
  const resolvedLanguage = resolveTranslationLanguageCode(targetLanguage)

  if (!resolvedLanguage) {
    throw new Error(`targetLanguage must be one of: ${[...SUPPORTED_TARGET_LANGUAGES].join(', ')}.`)
  }

  const audioInputConfig: OpenAiTranslationAudioInputConfig = {
    noise_reduction: null,
  }

  if (enableTranscription === true) {
    audioInputConfig.noise_reduction = {
      type: 'near_field',
    }

    audioInputConfig.transcription = {
      model: OPENAI_REALTIME_TRANSCRIPTION_MODEL,
    }
  }

  const openAiResponse = await fetch(OPENAI_TRANSLATION_CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': 'local-desktop-user',
    },
    body: JSON.stringify({
      expires_after: {
        anchor: 'created_at',
        seconds: DEFAULT_CLIENT_SECRET_TTL_SECONDS,
      },
      session: {
        model,
        audio: {
          input: audioInputConfig,
          output: {
            language: resolvedLanguage,
          },
        },
      },
    }),
  })

  const responseBody = (await openAiResponse.json().catch(() => ({}))) as
    | OpenAiTranslationClientSecretResponse
    | Record<string, unknown>

  if (!openAiResponse.ok) {
    const openAiErrorMessage = getOpenAiErrorMessage(responseBody)
    const details = openAiErrorMessage ? `: ${openAiErrorMessage}` : ''
    throw new Error(`OpenAI rejected the client secret request (HTTP ${openAiResponse.status})${details}.`)
  }

  if (typeof responseBody.value !== 'string') {
    throw new Error('OpenAI response did not include a client secret value.')
  }

  const expiresAt = typeof responseBody.expires_at === 'number' ? responseBody.expires_at : 0

  return { value: responseBody.value, expiresAt }
}
