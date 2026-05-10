import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import { formatZodError } from './validation.js'

test('formatZodError returns standardized payload', () => {
  const schema = z.object({
    name: z.string().min(3),
    age: z.number().min(18),
  })

  const parsed = schema.safeParse({
    name: 'Al',
    age: 16,
  })

  assert.strictEqual(parsed.success, false)
  if (parsed.success) {
    assert.fail('Expected validation to fail')
  }

  const formatted = formatZodError(parsed.error)

  assert.strictEqual(formatted.message, 'Dados inválidos')
  assert.ok(formatted.errors.some(error => error.startsWith('name: ')))
  assert.ok(formatted.errors.some(error => error.startsWith('age: ')))
})
