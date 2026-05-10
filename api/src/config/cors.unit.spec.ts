import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCorsOptions, resolveAllowedOrigins } from './cors.js'

async function evaluateOrigin(
  origin: string | undefined,
  environment: Record<string, string | undefined>,
): Promise<unknown> {
  const corsOptions = createCorsOptions(environment)
  const originOption = corsOptions.origin

  if (typeof originOption !== 'function') {
    throw new TypeError('CORS origin callback is not configured')
  }

  return await new Promise((resolve, reject) => {
    originOption(origin, (error, result) => {
      if (error) {
        reject(error)
        return
      }

      resolve(result)
    })
  })
}

test('resolveAllowedOrigins prioriza FRONTEND_URLS quando presente', () => {
  const allowedOrigins = resolveAllowedOrigins({
    FRONTEND_URL: 'https://legacy.example.com',
    FRONTEND_URLS: 'https://frontend.example.com, http://localhost:3000',
  })

  assert.deepStrictEqual([...allowedOrigins].toSorted(), [
    'http://localhost:3000',
    'https://frontend.example.com',
  ])
})

test('resolveAllowedOrigins usa FRONTEND_URL quando FRONTEND_URLS esta vazio', () => {
  const allowedOrigins = resolveAllowedOrigins({
    FRONTEND_URL: 'https://frontend.example.com',
    FRONTEND_URLS: '',
  })

  assert.deepStrictEqual([...allowedOrigins], ['https://frontend.example.com'])
})

test('resolveAllowedOrigins usa localhost por padrao', () => {
  const allowedOrigins = resolveAllowedOrigins({})

  assert.deepStrictEqual([...allowedOrigins], ['http://localhost:3000'])
})

test('resolveAllowedOrigins normaliza origem unica com barra final', () => {
  const allowedOrigins = resolveAllowedOrigins({
    FRONTEND_URL: 'https://frontend.example.com/',
  })

  assert.deepStrictEqual([...allowedOrigins], ['https://frontend.example.com'])
})

test('createCorsOptions permite origem configurada', async () => {
  const result = await evaluateOrigin('https://frontend.example.com', {
    FRONTEND_URLS: 'https://frontend.example.com/',
  })

  assert.strictEqual(result, true)
})

test('createCorsOptions normaliza porta padrao para comparar origem', async () => {
  const result = await evaluateOrigin('https://frontend.example.com', {
    FRONTEND_URLS: 'https://frontend.example.com:443',
  })

  assert.strictEqual(result, true)
})

test('createCorsOptions bloqueia origem nao configurada', async () => {
  const result = await evaluateOrigin('https://malicioso.example.com', {
    FRONTEND_URLS: 'https://frontend.example.com,http://localhost:3000',
  })

  assert.strictEqual(result, false)
})

test('createCorsOptions permite requisicoes sem header origin', async () => {
  const result = await evaluateOrigin(undefined, {
    FRONTEND_URLS: 'https://frontend.example.com',
  })

  assert.strictEqual(result, true)
})
