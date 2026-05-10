import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

async function reset() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined')
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const db = drizzle(pool)

  console.warn('Resetting database schema...')

  await db.execute(sql`DROP SCHEMA public CASCADE;`)
  await db.execute(sql`CREATE SCHEMA public;`)
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public;`)

  console.warn('Database schema reset complete.')

  await pool.end()
}

try {
  await reset()
} catch (error) {
  console.error(error)
  throw error
}
