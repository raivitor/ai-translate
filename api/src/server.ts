import { sql } from 'drizzle-orm'

import app from './app.js'
import { db } from './database/client.js'

const PORT = process.env.PORT || 3000

try {
  await db.execute(sql`SELECT 1`)
  console.warn('Database connected successfully')

  app.listen(PORT, () => {
    console.warn(`Server is running on http://localhost:${PORT}`)
  })
} catch (error) {
  console.error('Failed to connect to database or start server:', error)
  throw error
}
