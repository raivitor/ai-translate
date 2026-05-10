import { Router } from 'express'

const router = Router()

type TranslationClientSecretRequest = {
  targetLanguage?: unknown
}

type OpenAiTranslationClientSecretResponse = {
  value?: unknown
  expires_at?: unknown
  session?: unknown
}

const SUPPORTED_TARGET_LANGUAGES = new Set(['en', 'pt'])
const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 600
const OPENAI_TRANSLATION_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/translations/client_secrets'

function resolveTargetLanguage(rawLanguage: unknown): string | undefined {
  if (typeof rawLanguage !== 'string') {
    return undefined
  }

  const normalizedLanguage = rawLanguage.trim().toLowerCase()

  return SUPPORTED_TARGET_LANGUAGES.has(normalizedLanguage) ? normalizedLanguage : undefined
}

router.post('/realtime/translations/client-secret', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not configured on the local API server.',
    })
  }

  const body = req.body as TranslationClientSecretRequest
  const targetLanguage = resolveTargetLanguage(body.targetLanguage)

  if (!targetLanguage) {
    return res.status(400).json({
      error: 'targetLanguage must be one of: en, pt.',
    })
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
        model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-translate',
        audio: {
          input: {
            transcription: {
              model: 'gpt-realtime-whisper',
            },
            noise_reduction: null,
          },
          output: {
            language: targetLanguage,
          },
        },
      },
    }),
  })

  const responseBody = (await openAiResponse.json().catch(() => ({}))) as
    | OpenAiTranslationClientSecretResponse
    | Record<string, unknown>

  if (!openAiResponse.ok) {
    return res.status(openAiResponse.status).json({
      error: 'Failed to create OpenAI Realtime translation client secret.',
      details: responseBody,
    })
  }

  if (typeof responseBody.value !== 'string') {
    return res.status(502).json({
      error: 'OpenAI response did not include a client secret value.',
    })
  }

  return res.status(200).json({
    value: responseBody.value,
    expiresAt: responseBody.expires_at,
    session: responseBody.session,
  })
})

export default router
