import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

import type { AudioBridgeStatus } from '../shared/audioBridgeTypes.js'

const execFileAsync = promisify(execFile)

export type LoopbackPairSpec = {
  group: string
  sinkName: string
  sinkLabel: string
  sourceName: string
  sourceLabel: string
}

export type LoopbackConfig = {
  latencyMs: number
  quantum: number
  sampleRate: number
}

export const DEFAULT_LOOPBACK_LATENCY_MS = 10
export const DEFAULT_LOOPBACK_QUANTUM = 256
export const DEFAULT_LOOPBACK_SAMPLE_RATE = 48_000

const NODE_READY_TIMEOUT_MS = 3000
const NODE_POLL_INTERVAL_MS = 100
const PW_DUMP_TIMEOUT_MS = 3000

export const LOOPBACK_PAIRS: readonly LoopbackPairSpec[] = [
  {
    group: 'ai_translate_to_meet_loopback',
    sinkName: 'ai_translate_to_meet_sink',
    sinkLabel: 'AI-Translate-To-Meet',
    sourceName: 'ai_translate_to_meet_mic',
    sourceLabel: 'AI-Translate-Virtual-Mic-for-Meet',
  },
  {
    group: 'ai_translate_from_meet_loopback',
    sinkName: 'ai_translate_from_meet_sink',
    sinkLabel: 'AI-Translate-From-Meet',
    sourceName: 'ai_translate_from_meet_capture',
    sourceLabel: 'AI-Translate-Meet-Audio-Capture',
  },
] as const

export const EXPECTED_NODE_NAMES: readonly string[] = LOOPBACK_PAIRS.flatMap(pair => [pair.sinkName, pair.sourceName])

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue || !/^\d+$/.test(rawValue.trim())) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue.trim(), 10)
  return parsed > 0 ? parsed : fallback
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

export function resolveLoopbackConfig(env: NodeJS.ProcessEnv = process.env): LoopbackConfig {
  const latencyMs = parsePositiveInt(env.AI_TRANSLATE_LOOPBACK_LATENCY_MS, DEFAULT_LOOPBACK_LATENCY_MS)
  const rawQuantum = parsePositiveInt(env.AI_TRANSLATE_LOOPBACK_QUANTUM, DEFAULT_LOOPBACK_QUANTUM)
  const quantum = isPowerOfTwo(rawQuantum) ? rawQuantum : DEFAULT_LOOPBACK_QUANTUM

  return {
    latencyMs,
    quantum,
    sampleRate: DEFAULT_LOOPBACK_SAMPLE_RATE,
  }
}

export function parsePipeWireNodeNames(pwDumpJson: string): Set<string> {
  const nodeNames = new Set<string>()
  let parsed: unknown

  try {
    parsed = JSON.parse(pwDumpJson)
  } catch {
    return nodeNames
  }

  if (!Array.isArray(parsed)) {
    return nodeNames
  }

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }

    const record = entry as { type?: unknown; info?: { props?: Record<string, unknown> } }

    if (record.type !== 'PipeWire:Interface:Node') {
      continue
    }

    const nodeName = record.info?.props?.['node.name']

    if (typeof nodeName === 'string' && nodeName) {
      nodeNames.add(nodeName)
    }
  }

  return nodeNames
}

export function buildLoopbackArgs(pair: LoopbackPairSpec, config: LoopbackConfig): string[] {
  const captureProps = `{ media.class = "Audio/Sink" node.name = "${pair.sinkName}" node.description = "${pair.sinkLabel}" node.virtual = true audio.rate = ${config.sampleRate} audio.position = [ MONO ] }`
  const playbackProps = `{ media.class = "Audio/Source" node.name = "${pair.sourceName}" node.description = "${pair.sourceLabel}" node.virtual = true audio.rate = ${config.sampleRate} audio.position = [ MONO ] }`

  return [
    '-n',
    pair.group,
    '-g',
    pair.group,
    '-c',
    '1',
    '-l',
    String(config.latencyMs),
    '-m',
    '[ MONO ]',
    '--capture-props',
    captureProps,
    '--playback-props',
    playbackProps,
  ]
}

export function computeAudioBridgeStatus(
  presentNodes: ReadonlySet<string>,
  managedCount: number,
  error?: string,
): AudioBridgeStatus {
  const missingNodes = EXPECTED_NODE_NAMES.filter(nodeName => !presentNodes.has(nodeName))

  return {
    supported: true,
    ready: missingNodes.length === 0,
    managedByApp: managedCount > 0,
    missingNodes,
    ...(error ? { error } : {}),
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function listPipeWireNodeNames(): Promise<Set<string>> {
  const { stdout } = await execFileAsync('pw-dump', [], {
    timeout: PW_DUMP_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })

  return parsePipeWireNodeNames(stdout)
}

export class PipeWireAudioBridge {
  private readonly managedProcesses = new Map<string, ChildProcess>()
  private readonly config: LoopbackConfig
  private inFlightStart: Promise<AudioBridgeStatus> | undefined

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = resolveLoopbackConfig(env)
  }

  async getStatus(): Promise<AudioBridgeStatus> {
    if (process.platform !== 'linux') {
      return {
        supported: false,
        ready: false,
        managedByApp: false,
        missingNodes: [],
      }
    }

    if (this.inFlightStart) {
      return this.inFlightStart
    }

    try {
      const nodes = await listPipeWireNodeNames()
      return computeAudioBridgeStatus(nodes, this.managedProcesses.size)
    } catch (error) {
      return computeAudioBridgeStatus(
        new Set(),
        this.managedProcesses.size,
        error instanceof Error ? error.message : 'PipeWire (pw-dump) indisponível.',
      )
    }
  }

  async ensureStarted(): Promise<AudioBridgeStatus> {
    if (process.platform !== 'linux') {
      return {
        supported: false,
        ready: false,
        managedByApp: false,
        missingNodes: [],
      }
    }

    if (this.inFlightStart) {
      return this.inFlightStart
    }

    const startPromise = this.startMissingPairs().finally(() => {
      if (this.inFlightStart === startPromise) {
        this.inFlightStart = undefined
      }
    })

    this.inFlightStart = startPromise
    return startPromise
  }

  async restart(): Promise<AudioBridgeStatus> {
    if (this.inFlightStart) {
      await this.inFlightStart.catch(() => undefined)
    }

    this.stopManaged()
    await delay(150)
    return this.ensureStarted()
  }

  stopManaged(): void {
    for (const child of this.managedProcesses.values()) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
      }
    }

    this.managedProcesses.clear()
  }

  private async startMissingPairs(): Promise<AudioBridgeStatus> {
    let nodes: Set<string>

    try {
      nodes = await listPipeWireNodeNames()
    } catch (error) {
      return computeAudioBridgeStatus(
        new Set(),
        this.managedProcesses.size,
        error instanceof Error ? error.message : 'Não foi possível conectar ao PipeWire.',
      )
    }

    const pairsToSpawn = LOOPBACK_PAIRS.filter(pair => !nodes.has(pair.sinkName) || !nodes.has(pair.sourceName))
    let spawnedAny = false

    for (const pair of pairsToSpawn) {
      // Avoid creating duplicate nodes if only one half exists externally.
      if ((nodes.has(pair.sinkName) || nodes.has(pair.sourceName)) && !this.managedProcesses.has(pair.group)) {
        continue
      }

      if (this.spawnPair(pair)) {
        spawnedAny = true
      }
    }

    if (!spawnedAny) {
      return computeAudioBridgeStatus(nodes, this.managedProcesses.size)
    }

    const deadline = Date.now() + NODE_READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      await delay(NODE_POLL_INTERVAL_MS)

      try {
        nodes = await listPipeWireNodeNames()
        const status = computeAudioBridgeStatus(nodes, this.managedProcesses.size)

        if (status.ready) {
          return status
        }
      } catch {
        // Keep polling until deadline in case PipeWire is briefly reloading.
      }
    }

    return computeAudioBridgeStatus(
      nodes,
      this.managedProcesses.size,
      'Os dispositivos virtuais do PipeWire não ficaram prontos a tempo.',
    )
  }

  private spawnPair(pair: LoopbackPairSpec): boolean {
    const existing = this.managedProcesses.get(pair.group)

    if (existing && existing.exitCode === null && !existing.killed) {
      return false
    }

    const child = spawn('pw-loopback', buildLoopbackArgs(pair, this.config), {
      stdio: 'ignore',
      env: {
        ...process.env,
        PIPEWIRE_LATENCY: `${this.config.quantum}/${this.config.sampleRate}`,
      },
    })

    const cleanup = (): void => {
      if (this.managedProcesses.get(pair.group) === child) {
        this.managedProcesses.delete(pair.group)
      }
    }

    child.on('error', error => {
      console.error(`Failed to start pw-loopback (${pair.group}):`, error.message)
      cleanup()
    })

    child.on('exit', cleanup)
    this.managedProcesses.set(pair.group, child)
    return true
  }
}
