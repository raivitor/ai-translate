import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

import { VIRTUAL_AUDIO_NODES, type AudioBridgeStatus } from '../shared/audioBridgeTypes.js'

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

export type ManagedProcessLike = {
  readonly exitCode: number | null
  readonly killed: boolean
  kill: (signal?: NodeJS.Signals | number) => boolean
  on: {
    (event: 'error', listener: (error: Error) => void): unknown
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  }
  once: {
    (event: 'error', listener: (error: Error) => void): unknown
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  }
}

export type AudioBridgeDeps = {
  platform?: NodeJS.Platform
  listNodes?: () => Promise<Set<string>>
  spawnLoopback?: (args: string[], env: NodeJS.ProcessEnv) => ManagedProcessLike
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  pollIntervalMs?: number
}

export const DEFAULT_LOOPBACK_LATENCY_MS = 5
export const DEFAULT_LOOPBACK_QUANTUM = 128
export const DEFAULT_LOOPBACK_SAMPLE_RATE = 48_000

const NODE_READY_TIMEOUT_MS = 3000
const STOP_TIMEOUT_MS = 1500
const NODE_POLL_INTERVAL_MS = 100
const PW_DUMP_TIMEOUT_MS = 3000

export const LOOPBACK_PAIRS: readonly LoopbackPairSpec[] = [
  {
    group: VIRTUAL_AUDIO_NODES.toCallGroup,
    sinkName: VIRTUAL_AUDIO_NODES.toCallSinkName,
    sinkLabel: VIRTUAL_AUDIO_NODES.toCallSinkLabel,
    sourceName: VIRTUAL_AUDIO_NODES.toCallMicName,
    sourceLabel: VIRTUAL_AUDIO_NODES.toCallMicLabel,
  },
  {
    group: VIRTUAL_AUDIO_NODES.fromCallGroup,
    sinkName: VIRTUAL_AUDIO_NODES.fromCallSinkName,
    sinkLabel: VIRTUAL_AUDIO_NODES.fromCallSinkLabel,
    sourceName: VIRTUAL_AUDIO_NODES.fromCallCaptureName,
    sourceLabel: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel,
  },
] as const

export const EXPECTED_NODE_NAMES: readonly string[] = LOOPBACK_PAIRS.flatMap(pair => [pair.sinkName, pair.sourceName])

const NODE_LABEL_BY_NAME = new Map<string, string>(
  LOOPBACK_PAIRS.flatMap(pair => [
    [pair.sinkName, pair.sinkLabel],
    [pair.sourceName, pair.sourceLabel],
  ]),
)

const PAIR_BY_GROUP = new Map<string, LoopbackPairSpec>(LOOPBACK_PAIRS.map(pair => [pair.group, pair]))

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

export function formatMissingNodeLabels(missingNodes: readonly string[]): string {
  return missingNodes.map(name => NODE_LABEL_BY_NAME.get(name) ?? name).join(', ')
}

export function formatCommandError(command: string, error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : ''

  if (code === 'ENOENT') {
    return `Dependência "${command}" não encontrada. Instale o PipeWire.`
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return `Falha ao executar "${command}".`
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
  const nodeLatency = `${config.quantum}/${config.sampleRate}`
  const captureProps = `{ media.class = "Audio/Sink" node.name = "${pair.sinkName}" node.description = "${pair.sinkLabel}" node.virtual = true audio.rate = ${config.sampleRate} audio.position = [ MONO ] node.latency = "${nodeLatency}" }`
  const playbackProps = `{ media.class = "Audio/Source" node.name = "${pair.sourceName}" node.description = "${pair.sourceLabel}" node.virtual = true audio.rate = ${config.sampleRate} audio.position = [ MONO ] node.latency = "${nodeLatency}" }`

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
  const resolvedError =
    error ?? (missingNodes.length > 0 ? `Nós ausentes: ${formatMissingNodeLabels(missingNodes)}` : undefined)

  return {
    supported: true,
    ready: missingNodes.length === 0,
    managedByApp: managedCount > 0,
    missingNodes,
    ...(resolvedError ? { error: resolvedError } : {}),
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function defaultListPipeWireNodeNames(): Promise<Set<string>> {
  const { stdout } = await execFileAsync('pw-dump', [], {
    timeout: PW_DUMP_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })

  return parsePipeWireNodeNames(stdout)
}

function defaultSpawnLoopback(args: string[], env: NodeJS.ProcessEnv): ManagedProcessLike {
  return spawn('pw-loopback', args, { stdio: 'ignore', env })
}

export class PipeWireAudioBridge {
  private readonly managedProcesses = new Map<string, ManagedProcessLike>()
  private readonly config: LoopbackConfig
  private readonly platform: NodeJS.Platform
  private readonly listNodes: () => Promise<Set<string>>
  private readonly spawnLoopback: (args: string[], env: NodeJS.ProcessEnv) => ManagedProcessLike
  private readonly readyTimeoutMs: number
  private readonly stopTimeoutMs: number
  private readonly pollIntervalMs: number
  private inFlightStart: Promise<AudioBridgeStatus> | undefined
  private inFlightRestart: Promise<AudioBridgeStatus> | undefined

  constructor(env: NodeJS.ProcessEnv = process.env, deps: AudioBridgeDeps = {}) {
    this.config = resolveLoopbackConfig(env)
    this.platform = deps.platform ?? process.platform
    this.listNodes = deps.listNodes ?? defaultListPipeWireNodeNames
    this.spawnLoopback = deps.spawnLoopback ?? defaultSpawnLoopback
    this.readyTimeoutMs = deps.readyTimeoutMs ?? NODE_READY_TIMEOUT_MS
    this.stopTimeoutMs = deps.stopTimeoutMs ?? STOP_TIMEOUT_MS
    this.pollIntervalMs = deps.pollIntervalMs ?? NODE_POLL_INTERVAL_MS
  }

  async getStatus(): Promise<AudioBridgeStatus> {
    if (this.platform !== 'linux') {
      return {
        supported: false,
        ready: false,
        managedByApp: false,
        missingNodes: [],
      }
    }

    if (this.inFlightRestart) {
      return this.inFlightRestart
    }

    if (this.inFlightStart) {
      return this.inFlightStart
    }

    try {
      const nodes = await this.listNodes()
      return computeAudioBridgeStatus(nodes, this.managedProcesses.size)
    } catch (error) {
      return computeAudioBridgeStatus(new Set(), this.managedProcesses.size, formatCommandError('pw-dump', error))
    }
  }

  async ensureStarted(): Promise<AudioBridgeStatus> {
    if (this.platform !== 'linux') {
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
    if (this.inFlightRestart) {
      return this.inFlightRestart
    }

    const restartPromise = (async () => {
      if (this.inFlightStart) {
        await this.inFlightStart.catch(() => undefined)
      }

      const managedGroups = [...this.managedProcesses.keys()]
      await this.stopGroupsAndWait(managedGroups)
      return this.ensureStarted()
    })().finally(() => {
      if (this.inFlightRestart === restartPromise) {
        this.inFlightRestart = undefined
      }
    })

    this.inFlightRestart = restartPromise
    return restartPromise
  }

  stopManaged(): void {
    for (const child of this.managedProcesses.values()) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
      }
    }

    this.managedProcesses.clear()
  }

  private async stopGroupsAndWait(groups: readonly string[]): Promise<void> {
    if (groups.length === 0) {
      return
    }

    const expectedRemovedNodes = groups.flatMap(group => {
      const pair = PAIR_BY_GROUP.get(group)
      return pair ? [pair.sinkName, pair.sourceName] : []
    })

    const exitPromises: Promise<void>[] = []

    for (const group of groups) {
      const child = this.managedProcesses.get(group)
      if (!child) {
        continue
      }

      this.managedProcesses.delete(group)

      if (child.exitCode !== null) {
        continue
      }

      exitPromises.push(
        new Promise<void>(resolve => {
          let settled = false
          const finish = (): void => {
            if (!settled) {
              settled = true
              clearTimeout(killTimer)
              resolve()
            }
          }

          child.once('exit', finish)
          child.once('error', finish)

          const killTimer = setTimeout(() => {
            if (!settled) {
              if (child.exitCode === null) {
                child.kill('SIGKILL')
              }
              finish()
            }
          }, this.stopTimeoutMs)
          killTimer.unref?.()

          if (!child.killed) {
            child.kill('SIGTERM')
          }
        }),
      )
    }

    await Promise.all(exitPromises)

    // Wait for PipeWire to unregister the stopped managed nodes before recreating them.
    if (expectedRemovedNodes.length === 0) {
      return
    }

    const deadline = Date.now() + this.stopTimeoutMs
    while (Date.now() < deadline) {
      try {
        const nodes = await this.listNodes()
        if (expectedRemovedNodes.every(nodeName => !nodes.has(nodeName))) {
          return
        }
      } catch {
        return
      }

      await delay(this.pollIntervalMs)
    }
  }

  private async startMissingPairs(): Promise<AudioBridgeStatus> {
    let nodes: Set<string>

    try {
      nodes = await this.listNodes()
    } catch (error) {
      return computeAudioBridgeStatus(new Set(), this.managedProcesses.size, formatCommandError('pw-dump', error))
    }

    const pairsToSpawn = LOOPBACK_PAIRS.filter(pair => !nodes.has(pair.sinkName) || !nodes.has(pair.sourceName))
    const spawnedInAttempt: string[] = []
    let lastSpawnError: string | undefined

    for (const pair of pairsToSpawn) {
      // Avoid creating duplicate nodes if only one half exists externally.
      if ((nodes.has(pair.sinkName) || nodes.has(pair.sourceName)) && !this.managedProcesses.has(pair.group)) {
        continue
      }

      const spawned = this.spawnPair(pair, errorMessage => {
        lastSpawnError = errorMessage
      })

      if (spawned) {
        spawnedInAttempt.push(pair.group)
      }
    }

    if (spawnedInAttempt.length === 0) {
      return computeAudioBridgeStatus(nodes, this.managedProcesses.size)
    }

    const deadline = Date.now() + this.readyTimeoutMs

    while (Date.now() < deadline) {
      await delay(this.pollIntervalMs)

      if (lastSpawnError && spawnedInAttempt.every(group => !this.managedProcesses.has(group))) {
        break
      }

      try {
        nodes = await this.listNodes()
        const status = computeAudioBridgeStatus(nodes, this.managedProcesses.size)

        if (status.ready) {
          return status
        }
      } catch {
        // Keep polling until deadline in case PipeWire is briefly reloading.
      }
    }

    // Partial failure cleanup: stop only the processes opened in this failed attempt.
    await this.stopGroupsAndWait(spawnedInAttempt)

    try {
      nodes = await this.listNodes()
    } catch {
      // Keep last known node snapshot.
    }

    const missingNodes = EXPECTED_NODE_NAMES.filter(nodeName => !nodes.has(nodeName))
    const errorMessage =
      lastSpawnError ??
      `Falha ao criar áudio virtual. Faltando: ${formatMissingNodeLabels(missingNodes) || 'dispositivos PipeWire'}.`

    return computeAudioBridgeStatus(nodes, this.managedProcesses.size, errorMessage)
  }

  private spawnPair(pair: LoopbackPairSpec, onSpawnError: (message: string) => void): boolean {
    const existing = this.managedProcesses.get(pair.group)

    if (existing && existing.exitCode === null && !existing.killed) {
      return false
    }

    const child = this.spawnLoopback(buildLoopbackArgs(pair, this.config), {
      ...process.env,
      PIPEWIRE_LATENCY: `${this.config.quantum}/${this.config.sampleRate}`,
    })

    const cleanup = (): void => {
      if (this.managedProcesses.get(pair.group) === child) {
        this.managedProcesses.delete(pair.group)
      }
    }

    child.on('error', error => {
      const formatted = formatCommandError('pw-loopback', error)
      console.error(`Failed to start pw-loopback (${pair.group}):`, formatted)
      onSpawnError(formatted)
      cleanup()
    })

    child.on('exit', cleanup)
    this.managedProcesses.set(pair.group, child)
    return true
  }
}
