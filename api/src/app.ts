import cors from 'cors'
import type { Application, NextFunction, Request, Response } from 'express'
import express from 'express'

import { createCorsOptions } from './config/cors.js'
import router from './routes/routes.js'

const app: Application = express()

app.use(cors(createCorsOptions()))
app.use(express.json())

app.use('/api', router)

app.get(['/healthcheck', '/api/healthcheck'], (_req: Request, res: Response) => {
  return res.status(200).json({
    status: 'OK',
    service: 'ai-translate-api',
    timestamp: new Date().toISOString(),
  })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal Server Error' })
})

export default app
