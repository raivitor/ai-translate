import assert from 'node:assert/strict'
import { afterEach, before, test } from 'node:test'

import { getResponseBody } from '../test/helpers/supertest.js'
import { api, integrationDescribe, prepareIntegrationSuite } from '../test/setup/integration.js'

type ClientSecretBody = {
  value?: string
  expiresAt?: number
  error?: string
}

type OpenAiRequestBody = {
  session?: {
    model?: string
    audio?: {
      input?: {
        transcription?: {
          model?: string
        }
        noise_reduction?: null
      }
      output?: {
        language?: string
      }
    }
  }
}

const originalFetch = globalThis.fetch
const originalOpenAiApiKey = process.env.OPENAI_API_KEY
const originalOpenAiRealtimeModel = process.env.OPENAI_REALTIME_MODEL

integrationDescribe('Route integration: realtime translations', () => {
  before(() => {
    prepareIntegrationSuite()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.OPENAI_API_KEY = originalOpenAiApiKey
    process.env.OPENAI_REALTIME_MODEL = originalOpenAiRealtimeModel
  })

  test('POST /api/realtime/translations/client-secret creates a short-lived translation secret', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-translate'

    let requestBody: OpenAiRequestBody | undefined
    let authorizationHeader: string | null = null

    globalThis.fetch = (_input, init) => {
      authorizationHeader = new Headers(init?.headers).get('Authorization')
      const rawRequestBody = init?.body

      if (typeof rawRequestBody !== 'string') {
        throw new TypeError('Expected OpenAI request body to be a JSON string.')
      }

      requestBody = JSON.parse(rawRequestBody) as OpenAiRequestBody

      return Promise.resolve(
        Response.json({
          value: 'ek_test_secret',
          expires_at: 1_756_310_470,
          session: { id: 'sess_test', type: 'translation' },
        }),
      )
    }

    const response = await api
      .post('/api/realtime/translations/client-secret')
      .send({ targetLanguage: 'en' })
    const body = getResponseBody<ClientSecretBody>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.value, 'ek_test_secret')
    assert.strictEqual(body.expiresAt, 1_756_310_470)
    assert.strictEqual(authorizationHeader, 'Bearer test-openai-key')
    assert.strictEqual(requestBody?.session?.model, 'gpt-realtime-translate')
    assert.strictEqual(requestBody?.session?.audio?.output?.language, 'en')
    assert.strictEqual(
      requestBody?.session?.audio?.input?.transcription?.model,
      'gpt-realtime-whisper',
    )
    assert.strictEqual(requestBody?.session?.audio?.input?.noise_reduction, null)
  })

  test('POST /api/realtime/translations/client-secret rejects unsupported languages before calling OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'

    let fetchWasCalled = false
    globalThis.fetch = () => {
      fetchWasCalled = true
      return Promise.resolve(Response.json({}))
    }

    const response = await api
      .post('/api/realtime/translations/client-secret')
      .send({ targetLanguage: 'fr' })
    const body = getResponseBody<ClientSecretBody>(response)

    assert.strictEqual(response.status, 400)
    assert.match(body.error ?? '', /targetLanguage/)
    assert.strictEqual(fetchWasCalled, false)
  })

  test('POST /api/realtime/translations/client-secret requires OPENAI_API_KEY on the server', async () => {
    process.env.OPENAI_API_KEY = ''

    const response = await api
      .post('/api/realtime/translations/client-secret')
      .send({ targetLanguage: 'en' })
    const body = getResponseBody<ClientSecretBody>(response)

    assert.strictEqual(response.status, 500)
    assert.match(body.error ?? '', /OPENAI_API_KEY/)
  })
})
