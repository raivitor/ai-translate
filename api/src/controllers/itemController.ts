import type { Request, Response } from 'express'

import type { CreateItemInput, ItemIdParameters, UpdateItemInput } from '../schemas/item.schema.js'
import { itemService } from '../services/itemService.js'

export const itemController = {
  listItems: async (_req: Request, res: Response) => {
    const items = await itemService.listItems()

    return res.status(200).json({ items })
  },

  getItemById: async (req: Request, res: Response) => {
    const { id } = req.params as ItemIdParameters
    const item = await itemService.getItemById(id)

    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado' })
    }

    return res.status(200).json({ item })
  },

  createItem: async (req: Request, res: Response) => {
    const item = await itemService.createItem(req.body as CreateItemInput)

    return res.status(201).json({
      message: 'Item criado com sucesso',
      item,
    })
  },

  updateItem: async (req: Request, res: Response) => {
    const { id } = req.params as ItemIdParameters
    const item = await itemService.updateItem(id, req.body as UpdateItemInput)

    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado' })
    }

    return res.status(200).json({
      message: 'Item atualizado com sucesso',
      item,
    })
  },

  deleteItem: async (req: Request, res: Response) => {
    const { id } = req.params as ItemIdParameters
    const item = await itemService.deleteItem(id)

    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado' })
    }

    return res.status(200).json({
      message: 'Item removido com sucesso',
    })
  },
}
