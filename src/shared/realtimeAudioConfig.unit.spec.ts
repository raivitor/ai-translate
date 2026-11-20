import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveNoiseReductionMode } from './realtimeAudioConfig.js'

test('resolveNoiseReductionMode normalizes valid modes', () => {
  assert.strictEqual(resolveNoiseReductionMode('off'), 'off')
  assert.strictEqual(resolveNoiseReductionMode('near_field'), 'near_field')
  assert.strictEqual(resolveNoiseReductionMode('far_field'), 'far_field')
  assert.strictEqual(resolveNoiseReductionMode('  NEAR_FIELD  '), 'near_field')
})

test('resolveNoiseReductionMode returns undefined for invalid values', () => {
  assert.strictEqual(resolveNoiseReductionMode(''), undefined)
  assert.strictEqual(resolveNoiseReductionMode('auto'), undefined)
  assert.strictEqual(resolveNoiseReductionMode(null), undefined)
  assert.strictEqual(resolveNoiseReductionMode(undefined), undefined)
  assert.strictEqual(resolveNoiseReductionMode(123), undefined)
})
