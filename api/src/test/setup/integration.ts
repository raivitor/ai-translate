import { describe } from 'node:test'

import request from 'supertest'

import app from '../../app.js'

export const isIntegrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true'
export const integrationDescribe = isIntegrationEnabled ? describe : describe.skip

// Supertest testa o app diretamente, sem abrir porta/listen
export const api = request(app)

export function createApiAgent() {
  return request.agent(app)
}

function assertSafeIntegrationEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test')
  }
}

export function prepareIntegrationSuite(): void {
  if (!isIntegrationEnabled) {
    return
  }

  assertSafeIntegrationEnvironment()
}
