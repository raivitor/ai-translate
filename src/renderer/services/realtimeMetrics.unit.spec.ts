import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeAudioLevel, extractConnectionStats, getReconnectDelayMs } from './realtimeMetrics.js'

test('getReconnectDelayMs applies exponential backoff starting at 1s', () => {
  assert.strictEqual(getReconnectDelayMs(1), 1000)
  assert.strictEqual(getReconnectDelayMs(2), 2000)
  assert.strictEqual(getReconnectDelayMs(3), 4000)
  assert.strictEqual(getReconnectDelayMs(0), 1000)
})

test('computeAudioLevel returns 0 for silence and clamps loud signals to 1', () => {
  assert.strictEqual(computeAudioLevel(new Float32Array(0)), 0)
  assert.strictEqual(computeAudioLevel(new Float32Array([0, 0, 0, 0])), 0)

  const moderate = computeAudioLevel(new Float32Array([0.1, -0.1, 0.1, -0.1]))
  assert.ok(moderate > 0.35 && moderate < 0.45)

  const loud = computeAudioLevel(new Float32Array([0.9, -0.9, 0.9, -0.9]))
  assert.strictEqual(loud, 1)
})

test('extractConnectionStats reads RTT, packetsLost, and jitter from WebRTC stats entries', () => {
  const stats = extractConnectionStats([
    {
      type: 'candidate-pair',
      state: 'waiting',
      nominated: false,
      currentRoundTripTime: 0.999,
    },
    {
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: 0.048,
    },
    {
      type: 'inbound-rtp',
      kind: 'audio',
      packetsLost: 3,
      jitter: 0.012,
    },
  ])

  assert.deepStrictEqual(stats, {
    rttMs: 48,
    packetsLost: 3,
    jitterMs: 12,
  })
})

test('extractConnectionStats returns safe defaults when stats are absent', () => {
  assert.deepStrictEqual(extractConnectionStats([]), {
    rttMs: null,
    packetsLost: 0,
    jitterMs: null,
  })
})
