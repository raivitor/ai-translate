import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'

import { getResponseBody } from '../test/helpers/supertest.js'
import {
  api,
  integrationDescribe,
  prepareIntegrationSuite,
  resetDatabase,
} from '../test/setup/integration.js'

type HealthcheckBody = {
  status: string
  database: string
  timestamp?: string
}

integrationDescribe('Route integration: healthcheck', () => {
  before(async () => {
    await prepareIntegrationSuite()
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  test('GET /healthcheck returns database connectivity status', async () => {
    const response = await api.get('/healthcheck')
    const body = getResponseBody<HealthcheckBody>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.status, 'OK')
    assert.strictEqual(body.database, 'connected')
    assert.ok((body.timestamp ?? '').length > 10)
  })

  test('GET /api/healthcheck returns 200', async () => {
    const response = await api.get('/api/healthcheck')
    const body = getResponseBody<HealthcheckBody>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.status, 'OK')
    assert.strictEqual(body.database, 'connected')
  })
})
