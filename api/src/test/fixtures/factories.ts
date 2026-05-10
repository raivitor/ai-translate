import { randomUUID } from 'node:crypto'

import { db } from '../../database/client.js'
import { items } from '../../database/schema.js'

export async function createItemFixture(
  overrides: Partial<{
    name: string
    description: string | null
  }> = {},
) {
  const suffix = randomUUID().slice(0, 8)

  const [item] = await db
    .insert(items)
    .values({
      name: overrides.name ?? `Item Teste ${suffix}`,
      description:
        overrides.description === undefined ? `Descricao do item ${suffix}` : overrides.description,
    })
    .returning({
      id: items.id,
      name: items.name,
      description: items.description,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })

  if (!item) {
    throw new Error('Failed to create item fixture')
  }

  return item
}
