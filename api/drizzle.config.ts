import { defineConfig } from 'drizzle-kit'

const isIntegrationTest =
  process.env.NODE_ENV === 'test' && process.env.RUN_INTEGRATION_TESTS === 'true'

if (isIntegrationTest && !process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for integration tests')
}

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.NODE_ENV === 'test'
        ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!)
        : process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
})
