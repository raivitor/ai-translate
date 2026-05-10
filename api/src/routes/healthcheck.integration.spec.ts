import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { getResponseBody } from '../test/helpers/supertest.js'
import { api, integrationDescribe, prepareIntegrationSuite } from '../test/setup/integration.js'

type HealthcheckBody = {
  status: string
  service: string
  timestamp?: string
}

integrationDescribe('Route integration: healthcheck', () => {
  before(() => {
    prepareIntegrationSuite()
  })

  test('GET /healthcheck returns local service status', async () => {
    const response = await api.get('/healthcheck')
    const body = getResponseBody<HealthcheckBody>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.status, 'OK')
    assert.strictEqual(body.service, 'ai-translate-api')
    assert.ok((body.timestamp ?? '').length > 10)
  })

  test('GET /api/healthcheck returns 200', async () => {
    const response = await api.get('/api/healthcheck')
    const body = getResponseBody<HealthcheckBody>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.status, 'OK')
    assert.strictEqual(body.service, 'ai-translate-api')
  })
})
