import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { createClientSecret, SUPPORTED_TARGET_LANGUAGES } from './openaiRealtimeHandler.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('createClientSecret returns value and expiresAt on success with noise reduction off by default', async () => {
  let capturedUrl = ''
  let capturedAuthHeader = ''
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (input, init) => {
    capturedUrl = String(input)
    capturedAuthHeader = new Headers(init?.headers).get('Authorization') ?? ''
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 1_756_310_470 }))
  }

  const result = await createClientSecret({
    targetLanguage: 'en',
    apiKey: 'test-key',
  })

  assert.strictEqual(result.value, 'ek_test_secret')
  assert.strictEqual(result.expiresAt, 1_756_310_470)
  assert.strictEqual(capturedUrl, 'https://api.openai.com/v1/realtime/translations/client_secrets')
  assert.strictEqual(capturedAuthHeader, 'Bearer test-key')

  const session = capturedBody.session as Record<string, unknown>
  const audio = session.audio as Record<string, unknown>
  const output = audio.output as Record<string, unknown>
  const input = audio.input as Record<string, unknown>
  assert.strictEqual(output.language, 'en')
  assert.strictEqual(input.noise_reduction, null)
  assert.ok(!('transcription' in input))
})

test('createClientSecret sends near_field noise reduction when requested', async () => {
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 1_756_310_470 }))
  }

  await createClientSecret({
    targetLanguage: 'en',
    noiseReduction: 'near_field',
    apiKey: 'test-key',
  })

  const session = capturedBody.session as Record<string, unknown>
  const audio = session.audio as Record<string, unknown>
  const inputConfig = audio.input as Record<string, unknown>
  assert.deepStrictEqual(inputConfig.noise_reduction, { type: 'near_field' })
  assert.ok(!('transcription' in inputConfig))
})

test('createClientSecret sends far_field noise reduction when requested', async () => {
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 0 }))
  }

  await createClientSecret({
    targetLanguage: 'pt',
    noiseReduction: 'far_field',
    apiKey: 'test-key',
  })

  const session = capturedBody.session as Record<string, unknown>
  const audio = session.audio as Record<string, unknown>
  const inputConfig = audio.input as Record<string, unknown>
  assert.deepStrictEqual(inputConfig.noise_reduction, { type: 'far_field' })
})

test('createClientSecret sends null noise_reduction when explicitly set to off', async () => {
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 0 }))
  }

  await createClientSecret({
    targetLanguage: 'en',
    noiseReduction: 'off',
    apiKey: 'test-key',
  })

  const session = capturedBody.session as Record<string, unknown>
  const audio = session.audio as Record<string, unknown>
  const inputConfig = audio.input as Record<string, unknown>
  assert.strictEqual(inputConfig.noise_reduction, null)
})

test('createClientSecret rejects invalid noiseReduction without calling OpenAI', async () => {
  let fetchWasCalled = false

  globalThis.fetch = () => {
    fetchWasCalled = true
    return Promise.resolve(Response.json({}))
  }

  await assert.rejects(
    () =>
      createClientSecret({
        targetLanguage: 'en',
        noiseReduction: 'invalid' as never,
        apiKey: 'test-key',
      }),
    (err: Error) => {
      assert.match(err.message, /noiseReduction/)
      return true
    },
  )

  assert.strictEqual(fetchWasCalled, false)
})

test('createClientSecret uses custom model when provided', async () => {
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 0 }))
  }

  await createClientSecret({
    targetLanguage: 'en',
    apiKey: 'test-key',
    model: 'gpt-realtime-custom',
  })

  const session = capturedBody.session as Record<string, unknown>
  assert.strictEqual(session.model, 'gpt-realtime-custom')
})

test('createClientSecret throws for unsupported language without calling OpenAI', async () => {
  let fetchWasCalled = false

  globalThis.fetch = () => {
    fetchWasCalled = true
    return Promise.resolve(Response.json({}))
  }

  await assert.rejects(
    () => createClientSecret({ targetLanguage: 'ar', apiKey: 'test-key' }),
    (err: Error) => {
      assert.match(err.message, /targetLanguage/)
      return true
    },
  )

  assert.strictEqual(fetchWasCalled, false)
})

test('createClientSecret accepts normalized supported languages', async () => {
  let capturedBody: Record<string, unknown> = {}

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 0 }))
  }

  await createClientSecret({
    targetLanguage: 'PT-BR',
    apiKey: 'test-key',
  })

  const session = capturedBody.session as Record<string, unknown>
  const audio = session.audio as Record<string, unknown>
  const output = audio.output as Record<string, unknown>
  assert.strictEqual(output.language, 'pt')
})

test('createClientSecret accepts only English and Brazilian Portuguese target languages', async () => {
  const supportedLanguages: ReadonlyArray<readonly [string, string]> = [
    ['en', 'en'],
    ['en-US', 'en'],
    ['pt', 'pt'],
    ['pt-BR', 'pt'],
  ]

  for (const [inputLang, expectedApiLang] of supportedLanguages) {
    let capturedBody: Record<string, unknown> = {}

    globalThis.fetch = (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return Promise.resolve(Response.json({ value: 'ek_test_secret', expires_at: 0 }))
    }

    await createClientSecret({
      targetLanguage: inputLang,
      apiKey: 'test-key',
    })

    const session = capturedBody.session as Record<string, unknown>
    const audio = session.audio as Record<string, unknown>
    const output = audio.output as Record<string, unknown>
    assert.strictEqual(output.language, expectedApiLang)
  }
})

test('createClientSecret rejects all unsupported target languages', async () => {
  const unsupported = ['es', 'fr', 'de', 'pt-PT', 'ar', 'nl', 'pl', 'tr', 'sv', '']

  for (const lang of unsupported) {
    if (SUPPORTED_TARGET_LANGUAGES.has(lang)) {
      continue
    }

    globalThis.fetch = () => Promise.resolve(Response.json({}))

    await assert.rejects(
      () => createClientSecret({ targetLanguage: lang, apiKey: 'test-key' }),
      `Expected rejection for language: ${lang}`,
    )
  }
})

test('createClientSecret throws when OpenAI returns a non-OK response', async () => {
  globalThis.fetch = () => {
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), {
        status: 401,
      }),
    )
  }

  await assert.rejects(
    () => createClientSecret({ targetLanguage: 'en', apiKey: 'bad-key' }),
    (err: Error) => {
      assert.match(err.message, /401/)
      assert.match(err.message, /invalid_api_key/)
      return true
    },
  )
})

test('createClientSecret throws when OpenAI response lacks a value field', async () => {
  globalThis.fetch = () => {
    return Promise.resolve(Response.json({ expires_at: 123 }))
  }

  await assert.rejects(
    () => createClientSecret({ targetLanguage: 'en', apiKey: 'test-key' }),
    (err: Error) => {
      assert.match(err.message, /client secret/i)
      return true
    },
  )
})
