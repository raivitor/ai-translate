import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './schema.js'

const isIntegrationTest =
  process.env.NODE_ENV === 'test' && process.env.RUN_INTEGRATION_TESTS === 'true'

const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL || (isIntegrationTest ? undefined : process.env.DATABASE_URL)
    : process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    isIntegrationTest
      ? 'TEST_DATABASE_URL is not defined for integration tests'
      : 'DATABASE_URL is not defined',
  )
}

// Cria o pool de conexões (melhor para produção que um Client único)
export const pool = new pg.Pool({ connectionString })

// Inicializa o Drizzle
export const db = drizzle(pool, { schema })
