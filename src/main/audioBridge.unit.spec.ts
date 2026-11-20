import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLoopbackArgs,
  computeAudioBridgeStatus,
  DEFAULT_LOOPBACK_LATENCY_MS,
  DEFAULT_LOOPBACK_QUANTUM,
  DEFAULT_LOOPBACK_SAMPLE_RATE,
  EXPECTED_NODE_NAMES,
  LOOPBACK_PAIRS,
  parsePipeWireNodeNames,
  resolveLoopbackConfig,
} from './audioBridge.js'

test('parsePipeWireNodeNames extracts node.name only from PipeWire Node entries', () => {
  const dump = JSON.stringify([
    {
      id: 1,
      type: 'PipeWire:Interface:Core',
      info: { props: { 'node.name': 'should_be_ignored' } },
    },
    {
      id: 42,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'node.name': 'ai_translate_to_meet_sink' } },
    },
    {
      id: 43,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'node.name': 'ai_translate_to_meet_mic' } },
    },
    {
      id: 44,
      type: 'PipeWire:Interface:Node',
      info: { props: {} },
    },
  ])

  const names = parsePipeWireNodeNames(dump)

  assert.strictEqual(names.has('ai_translate_to_meet_sink'), true)
  assert.strictEqual(names.has('ai_translate_to_meet_mic'), true)
  assert.strictEqual(names.has('should_be_ignored'), false)
  assert.strictEqual(names.size, 2)
})

test('parsePipeWireNodeNames returns empty set on invalid JSON', () => {
  assert.strictEqual(parsePipeWireNodeNames('not json').size, 0)
  assert.strictEqual(parsePipeWireNodeNames('{}').size, 0)
})

test('resolveLoopbackConfig validates environment overrides and falls back safely', () => {
  assert.deepStrictEqual(resolveLoopbackConfig({}), {
    latencyMs: DEFAULT_LOOPBACK_LATENCY_MS,
    quantum: DEFAULT_LOOPBACK_QUANTUM,
    sampleRate: DEFAULT_LOOPBACK_SAMPLE_RATE,
  })

  assert.deepStrictEqual(
    resolveLoopbackConfig({
      AI_TRANSLATE_LOOPBACK_LATENCY_MS: '15',
      AI_TRANSLATE_LOOPBACK_QUANTUM: '128',
    }),
    {
      latencyMs: 15,
      quantum: 128,
      sampleRate: 48_000,
    },
  )

  // Non power-of-two quantum and invalid latency fall back to defaults.
  assert.deepStrictEqual(
    resolveLoopbackConfig({
      AI_TRANSLATE_LOOPBACK_LATENCY_MS: '-5',
      AI_TRANSLATE_LOOPBACK_QUANTUM: '300',
    }),
    {
      latencyMs: DEFAULT_LOOPBACK_LATENCY_MS,
      quantum: DEFAULT_LOOPBACK_QUANTUM,
      sampleRate: DEFAULT_LOOPBACK_SAMPLE_RATE,
    },
  )
})

test('buildLoopbackArgs configures mono 48kHz loopback props for each pair', () => {
  const [toMeet] = LOOPBACK_PAIRS
  assert.ok(toMeet)

  const args = buildLoopbackArgs(toMeet, {
    latencyMs: 10,
    quantum: 256,
    sampleRate: 48_000,
  })

  assert.ok(args.includes('-c'))
  assert.strictEqual(args[args.indexOf('-c') + 1], '1')
  assert.strictEqual(args[args.indexOf('-m') + 1], '[ MONO ]')
  assert.strictEqual(args[args.indexOf('-l') + 1], '10')

  const captureProps = args[args.indexOf('--capture-props') + 1] ?? ''
  const playbackProps = args[args.indexOf('--playback-props') + 1] ?? ''

  assert.match(captureProps, /Audio\/Sink/)
  assert.match(captureProps, /audio\.rate = 48000/)
  assert.match(captureProps, /audio\.position = \[ MONO \]/)
  assert.match(playbackProps, /Audio\/Source/)
  assert.match(playbackProps, /audio\.rate = 48000/)
})

test('computeAudioBridgeStatus reports ready when all expected nodes exist', () => {
  const readyStatus = computeAudioBridgeStatus(new Set(EXPECTED_NODE_NAMES), 2)

  assert.strictEqual(readyStatus.ready, true)
  assert.strictEqual(readyStatus.managedByApp, true)
  assert.deepStrictEqual(readyStatus.missingNodes, [])

  const partialStatus = computeAudioBridgeStatus(new Set(['ai_translate_to_meet_sink']), 0, 'Missing nodes')

  assert.strictEqual(partialStatus.ready, false)
  assert.strictEqual(partialStatus.managedByApp, false)
  assert.strictEqual(partialStatus.missingNodes.length, 3)
  assert.strictEqual(partialStatus.error, 'Missing nodes')
})
