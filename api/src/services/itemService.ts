import { desc, eq } from 'drizzle-orm'

import { db } from '../database/client.js'
import { items } from '../database/schema.js'
import type { CreateItemInput, UpdateItemInput } from '../schemas/item.schema.js'

export const itemService = {
  async listItems() {
    return db
      .select({
        id: items.id,
        name: items.name,
        description: items.description,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .orderBy(desc(items.createdAt), desc(items.id))
  },

  async getItemById(id: string) {
    const [item] = await db
      .select({
        id: items.id,
        name: items.name,
        description: items.description,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .where(eq(items.id, id))

    return item ?? null
  },

  async createItem(input: CreateItemInput) {
    const [item] = await db
      .insert(items)
      .values({
        name: input.name,
        description: input.description ?? null,
      })
      .returning({
        id: items.id,
        name: items.name,
        description: items.description,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })

    if (!item) {
      throw new Error('Não foi possível criar o item')
    }

    return item
  },

  async updateItem(id: string, input: UpdateItemInput) {
    const payload: {
      name?: string
      description?: string | null
      updatedAt: Date
    } = {
      updatedAt: new Date(),
    }

    if (input.name !== undefined) {
      payload.name = input.name
    }

    if ('description' in input) {
      payload.description = input.description ?? null
    }

    const [item] = await db.update(items).set(payload).where(eq(items.id, id)).returning({
      id: items.id,
      name: items.name,
      description: items.description,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    return item ?? null
  },

  async deleteItem(id: string) {
    const [item] = await db.delete(items).where(eq(items.id, id)).returning({
      id: items.id,
    })

    return item ?? null
  },
}
