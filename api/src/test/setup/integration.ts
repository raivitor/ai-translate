import { describe } from 'node:test'

import { sql } from 'drizzle-orm'
import request from 'supertest'

import app from '../../app.js'
import { db } from '../../database/client.js'

const SAFE_TEST_DB_MARKERS = ['test', 'spec', 'ci']

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

  const testDatabaseUrl = process.env.TEST_DATABASE_URL

  if (!testDatabaseUrl) {
    throw new Error('Integration tests require TEST_DATABASE_URL to be defined')
  }

  const normalizedUrl = testDatabaseUrl.toLowerCase()

  if (!SAFE_TEST_DB_MARKERS.some(marker => normalizedUrl.includes(marker))) {
    throw new Error(
      `Refusing integration tests on non-test database URL: ${testDatabaseUrl}. Use a dedicated test database.`,
    )
  }
}

export async function prepareIntegrationSuite(): Promise<void> {
  if (!isIntegrationEnabled) {
    return
  }

  assertSafeIntegrationEnvironment()
  await db.execute(sql`SELECT 1`)
}

export async function resetDatabase(): Promise<void> {
  if (!isIntegrationEnabled) {
    return
  }

  await db.execute(sql`TRUNCATE TABLE "items" RESTART IDENTITY CASCADE`)
}
