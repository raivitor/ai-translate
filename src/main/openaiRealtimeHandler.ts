import {
  resolveNoiseReductionMode,
  SUPPORTED_NOISE_REDUCTION_MODES,
  type NoiseReductionMode,
} from '../shared/realtimeAudioConfig.js'
import { resolveTranslationLanguageCode, SUPPORTED_TRANSLATION_LANGUAGE_CODES } from '../shared/translationLanguages.js'

export const SUPPORTED_TARGET_LANGUAGES = SUPPORTED_TRANSLATION_LANGUAGE_CODES
export const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 600
export const OPENAI_REALTIME_MODEL = 'gpt-realtime-translate'

const OPENAI_TRANSLATION_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/translations/client_secrets'

export type CreateClientSecretParams = {
  targetLanguage: string
  noiseReduction?: NoiseReductionMode | undefined
  apiKey: string
  model?: string
}

export type ClientSecretResult = {
  value: string
  expiresAt: number
}

type OpenAiTranslationAudioInputConfig = {
  noise_reduction: null | {
    type: 'near_field' | 'far_field'
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
  noiseReduction = 'off',
  apiKey,
  model = OPENAI_REALTIME_MODEL,
}: CreateClientSecretParams): Promise<ClientSecretResult> {
  const resolvedLanguage = resolveTranslationLanguageCode(targetLanguage)

  if (!resolvedLanguage) {
    throw new Error(`targetLanguage must be one of: ${[...SUPPORTED_TARGET_LANGUAGES].join(', ')}.`)
  }

  const resolvedNoiseReduction = resolveNoiseReductionMode(noiseReduction)

  if (!resolvedNoiseReduction) {
    throw new Error(`noiseReduction must be one of: ${[...SUPPORTED_NOISE_REDUCTION_MODES].join(', ')}.`)
  }

  const audioInputConfig: OpenAiTranslationAudioInputConfig = {
    noise_reduction: resolvedNoiseReduction === 'off' ? null : { type: resolvedNoiseReduction },
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
    OpenAiTranslationClientSecretResponse | Record<string, unknown>

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
