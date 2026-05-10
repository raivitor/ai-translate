import { Router } from 'express'

import itemRouter from './itemRoutes.js'

const router = Router()

router.use('/items', itemRouter)

export default router
