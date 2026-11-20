import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import {
  buildLoopbackArgs,
  computeAudioBridgeStatus,
  DEFAULT_LOOPBACK_LATENCY_MS,
  DEFAULT_LOOPBACK_QUANTUM,
  DEFAULT_LOOPBACK_SAMPLE_RATE,
  EXPECTED_NODE_NAMES,
  formatCommandError,
  formatMissingNodeLabels,
  LOOPBACK_PAIRS,
  parsePipeWireNodeNames,
  PipeWireAudioBridge,
  resolveLoopbackConfig,
  type ManagedProcessLike,
} from './audioBridge.js'

class FakeChildProcess extends EventEmitter implements ManagedProcessLike {
  exitCode: number | null = null
  killed = false
  signals: string[] = []
  private readonly onKill: ((signal: string) => void) | undefined

  constructor(onKill?: (signal: string) => void) {
    super()
    this.onKill = onKill
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.killed = true
    const signalName = String(signal)
    this.signals.push(signalName)
    this.onKill?.(signalName)
    return true
  }

  finish(code = 0): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

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

test('computeAudioBridgeStatus formats missing nodes and dependency errors clearly', () => {
  const readyStatus = computeAudioBridgeStatus(new Set(EXPECTED_NODE_NAMES), 2)

  assert.strictEqual(readyStatus.ready, true)
  assert.strictEqual(readyStatus.managedByApp, true)
  assert.deepStrictEqual(readyStatus.missingNodes, [])

  const partialStatus = computeAudioBridgeStatus(new Set(['ai_translate_to_meet_sink']), 0)
  assert.strictEqual(partialStatus.ready, false)
  assert.strictEqual(partialStatus.missingNodes.length, 3)
  assert.match(partialStatus.error ?? '', /AI-Translate-Virtual-Mic-for-Meet/)

  assert.strictEqual(formatMissingNodeLabels(['ai_translate_to_meet_sink']), 'AI-Translate-To-Meet')
  assert.match(
    formatCommandError('pw-loopback', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
    /pw-loopback/,
  )
})

test('PipeWireAudioBridge cleans up only processes opened in a failed partial startup attempt', async () => {
  const activeNodes = new Set<string>(['ai_translate_to_meet_sink', 'ai_translate_to_meet_mic'])
  const spawnedChildren: FakeChildProcess[] = []

  const bridge = new PipeWireAudioBridge(
    {},
    {
      platform: 'linux',
      readyTimeoutMs: 40,
      stopTimeoutMs: 50,
      pollIntervalMs: 10,
      listNodes: async () => new Set(activeNodes),
      spawnLoopback: () => {
        const child = new FakeChildProcess(() => {
          child.finish(0)
        })
        spawnedChildren.push(child)
        return child
      },
    },
  )

  const status = await bridge.ensureStarted()

  assert.strictEqual(status.ready, false)
  assert.strictEqual(spawnedChildren.length, 1)
  assert.deepStrictEqual(spawnedChildren[0]?.signals, ['SIGTERM'])
  assert.match(status.error ?? '', /AI-Translate-From-Meet/)
  assert.strictEqual(status.managedByApp, false)
})

test('PipeWireAudioBridge restart waits for process exit and node removal before respawning', async () => {
  const activeNodes = new Set<string>()
  const events: string[] = []
  const spawnedChildren: FakeChildProcess[] = []

  const bridge = new PipeWireAudioBridge(
    {},
    {
      platform: 'linux',
      readyTimeoutMs: 200,
      stopTimeoutMs: 200,
      pollIntervalMs: 10,
      listNodes: async () => new Set(activeNodes),
      spawnLoopback: args => {
        const group = args[args.indexOf('-g') + 1] ?? ''
        const pair = LOOPBACK_PAIRS.find(item => item.group === group)
        events.push(`spawn:${group}`)

        const child = new FakeChildProcess(() => {
          events.push(`kill:${group}`)
          setTimeout(() => {
            if (pair) {
              activeNodes.delete(pair.sinkName)
              activeNodes.delete(pair.sourceName)
            }
            events.push(`exited:${group}`)
            child.finish(0)
          }, 15)
        })

        if (pair) {
          activeNodes.add(pair.sinkName)
          activeNodes.add(pair.sourceName)
        }

        spawnedChildren.push(child)
        return child
      },
    },
  )

  const initial = await bridge.ensureStarted()
  assert.strictEqual(initial.ready, true)
  assert.strictEqual(spawnedChildren.length, 2)

  const restartPromise = bridge.restart()
  const concurrentStatus = await bridge.getStatus()
  const restarted = await restartPromise
  assert.strictEqual(concurrentStatus.ready, true)
  assert.strictEqual(restarted.ready, true)
  assert.strictEqual(spawnedChildren.length, 4)

  const lastExitIndex = Math.max(
    events.indexOf('exited:ai_translate_to_meet_loopback'),
    events.indexOf('exited:ai_translate_from_meet_loopback'),
  )
  const secondSpawnIndex = events.lastIndexOf('spawn:ai_translate_to_meet_loopback')
  assert.ok(lastExitIndex >= 0 && secondSpawnIndex > lastExitIndex)

  bridge.stopManaged()
})
