import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'

import { createItemFixture } from '../test/fixtures/factories.js'
import { getResponseBody } from '../test/helpers/supertest.js'
import {
  api,
  integrationDescribe,
  prepareIntegrationSuite,
  resetDatabase,
} from '../test/setup/integration.js'

type ValidationErrorBody = {
  message: string
  errors: string[]
}

type ErrorBody = {
  error: string
}

type ItemBody = {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

type SingleItemResponse = {
  item: ItemBody
}

type ListItemsResponse = {
  items: ItemBody[]
}

type MessageWithItemResponse = {
  message: string
  item: ItemBody
}

type MessageResponse = {
  message: string
}

integrationDescribe('Route integration: items', () => {
  before(async () => {
    await prepareIntegrationSuite()
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  test('POST /api/items returns 400 for invalid payload', async () => {
    const response = await api.post('/api/items').send({
      name: '',
    })

    const body = getResponseBody<ValidationErrorBody>(response)

    assert.strictEqual(response.status, 400)
    assert.strictEqual(body.message, 'Dados inválidos')
    assert.ok(body.errors.some(error => error.includes('Nome é obrigatório')))
  })

  test('POST /api/items returns 201 for valid payload', async () => {
    const response = await api.post('/api/items').send({
      name: 'Item principal',
      description: 'Descricao inicial',
    })

    const body = getResponseBody<MessageWithItemResponse>(response)

    assert.strictEqual(response.status, 201)
    assert.strictEqual(body.message, 'Item criado com sucesso')
    assert.strictEqual(body.item.name, 'Item principal')
    assert.strictEqual(body.item.description, 'Descricao inicial')
    assert.ok(body.item.id.length > 10)
  })

  test('GET /api/items returns created items', async () => {
    const firstItem = await createItemFixture({ name: 'Primeiro item' })
    const secondItem = await createItemFixture({ name: 'Segundo item' })

    const response = await api.get('/api/items')
    const body = getResponseBody<ListItemsResponse>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.items.length, 2)
    assert.ok(body.items.some(item => item.id === firstItem.id))
    assert.ok(body.items.some(item => item.id === secondItem.id))
  })

  test('GET /api/items/:id returns item details', async () => {
    const createdItem = await createItemFixture({
      name: 'Detalhe do item',
      description: 'Descricao detalhada',
    })

    const response = await api.get(`/api/items/${createdItem.id}`)
    const body = getResponseBody<SingleItemResponse>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.item.id, createdItem.id)
    assert.strictEqual(body.item.name, 'Detalhe do item')
    assert.strictEqual(body.item.description, 'Descricao detalhada')
  })

  test('GET /api/items/:id returns 404 when item does not exist', async () => {
    const response = await api.get('/api/items/8d8df7f4-a789-43cf-a86f-9ba76d4f0e16')
    const body = getResponseBody<ErrorBody>(response)

    assert.strictEqual(response.status, 404)
    assert.strictEqual(body.error, 'Item não encontrado')
  })

  test('PUT /api/items/:id returns 400 when body is empty', async () => {
    const createdItem = await createItemFixture()

    const response = await api.put(`/api/items/${createdItem.id}`).send({})
    const body = getResponseBody<ValidationErrorBody>(response)

    assert.strictEqual(response.status, 400)
    assert.strictEqual(body.message, 'Dados inválidos')
    assert.ok(
      body.errors.some(error => error.includes('Informe ao menos um campo para atualização')),
    )
  })

  test('PUT /api/items/:id updates the item', async () => {
    const createdItem = await createItemFixture({
      name: 'Nome antigo',
      description: 'Descricao antiga',
    })

    const response = await api.put(`/api/items/${createdItem.id}`).send({
      name: 'Nome novo',
      description: 'Descricao nova',
    })

    const body = getResponseBody<MessageWithItemResponse>(response)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.message, 'Item atualizado com sucesso')
    assert.strictEqual(body.item.name, 'Nome novo')
    assert.strictEqual(body.item.description, 'Descricao nova')
    assert.notStrictEqual(body.item.updatedAt, createdItem.updatedAt.toISOString())
  })

  test('DELETE /api/items/:id removes the item', async () => {
    const createdItem = await createItemFixture()

    const deleteResponse = await api.delete(`/api/items/${createdItem.id}`)
    const deleteBody = getResponseBody<MessageResponse>(deleteResponse)

    assert.strictEqual(deleteResponse.status, 200)
    assert.strictEqual(deleteBody.message, 'Item removido com sucesso')

    const getResponse = await api.get(`/api/items/${createdItem.id}`)
    const getBody = getResponseBody<ErrorBody>(getResponse)

    assert.strictEqual(getResponse.status, 404)
    assert.strictEqual(getBody.error, 'Item não encontrado')
  })
})
