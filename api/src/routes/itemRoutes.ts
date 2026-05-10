import { Router } from 'express'

import { itemController } from '../controllers/itemController.js'
import { validateBody, validateParameters } from '../middlewares/validation.js'
import {
  createItemSchema,
  itemIdParametersSchema,
  updateItemSchema,
} from '../schemas/item.schema.js'

const router = Router()

router.get('/', itemController.listItems)
router.get('/:id', validateParameters(itemIdParametersSchema), itemController.getItemById)
router.post('/', validateBody(createItemSchema), itemController.createItem)
router.put(
  '/:id',
  validateParameters(itemIdParametersSchema),
  validateBody(updateItemSchema),
  itemController.updateItem,
)
router.delete('/:id', validateParameters(itemIdParametersSchema), itemController.deleteItem)

export default router
