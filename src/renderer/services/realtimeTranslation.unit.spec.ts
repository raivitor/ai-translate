import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { startTranslationSession, type TranslationStatus } from './realtimeTranslation.js'

type Listener = (event: unknown) => void

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

class FakeAudioTrack extends FakeEventTarget {
  enabled = true
  stopped = false
  readonly id: string

  constructor(id: string) {
    super()
    this.id = id
  }

  stop(): void {
    this.stopped = true
  }
}

class FakeMediaStream {
  readonly tracks: FakeAudioTrack[]

  constructor(tracks: FakeAudioTrack[]) {
    this.tracks = tracks
  }

  getTracks(): FakeAudioTrack[] {
    return this.tracks
  }

  getAudioTracks(): FakeAudioTrack[] {
    return this.tracks
  }
}

class FakeDataChannel extends FakeEventTarget {
  readyState: RTCDataChannelState = 'open'
  closed = false

  close(): void {
    this.readyState = 'closed'
    this.closed = true
  }
}

class FakeAudioContext {
  sinkIds: string[] = []
  closed = false
  resumed = false
  lastGainNode: { gain: { value: number } } | undefined

  async setSinkId(sinkId: string): Promise<void> {
    this.sinkIds.push(sinkId)
  }

  createMediaStreamSource() {
    return {
      connect: () => undefined,
      disconnect: () => undefined,
    }
  }

  createGain() {
    const node = {
      gain: { value: 1 },
      connect: () => undefined,
      disconnect: () => undefined,
    }
    this.lastGainNode = node
    return node
  }

  createAnalyser() {
    return {
      fftSize: 256,
      connect: () => undefined,
      disconnect: () => undefined,
      getFloatTimeDomainData: (arr: Float32Array) => {
        arr.fill(0)
      },
    }
  }

  async resume(): Promise<void> {
    this.resumed = true
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class FakePeerConnection extends FakeEventTarget {
  connectionState: RTCPeerConnectionState = 'new'
  closed = false
  dataChannel = new FakeDataChannel()
  replacedTracks: FakeAudioTrack[] = []
  addedTracks: FakeAudioTrack[] = []

  createDataChannel(): FakeDataChannel {
    return this.dataChannel
  }

  addTrack(track: FakeAudioTrack) {
    this.addedTracks.push(track)
    return {
      replaceTrack: async (nextTrack: FakeAudioTrack) => {
        this.replacedTracks.push(nextTrack)
      },
    }
  }

  async createOffer() {
    return { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }
  }

  async setLocalDescription(): Promise<void> {}

  async setRemoteDescription(): Promise<void> {
    this.connectionState = 'connected'
  }

  async getStats() {
    return new Map()
  }

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }
}

type TestHarness = {
  peerConnections: FakePeerConnection[]
  audioContexts: FakeAudioContext[]
  capturedTracks: FakeAudioTrack[]
  restore: () => void
}

function setupBrowserHarness(options?: { fastTimers?: boolean }): TestHarness {
  const peerConnections: FakePeerConnection[] = []
  const audioContexts: FakeAudioContext[] = []
  const capturedTracks: FakeAudioTrack[] = []
  let trackCounter = 0

  const originalFetch = globalThis.fetch
  const originalWindow = (globalThis as Record<string, unknown>).window
  const originalDocument = (globalThis as Record<string, unknown>).document
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalRTCPeerConnection = (globalThis as Record<string, unknown>).RTCPeerConnection
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext
  const originalMediaStream = (globalThis as Record<string, unknown>).MediaStream

  const fakeWindow = {
    setTimeout: (fn: () => void, ms?: number) => {
      const delay = options?.fastTimers && ms && ms < 60_000 ? 1 : ms
      const timer = globalThis.setTimeout(fn, delay)
      timer.unref()
      return timer
    },
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: (fn: () => void, ms?: number) => {
      const timer = globalThis.setInterval(fn, ms)
      timer.unref()
      return timer
    },
    clearInterval: globalThis.clearInterval.bind(globalThis),
    aiTranslate: {
      createClientSecret: async () => ({ value: 'ek_unit_test', expiresAt: 0 }),
    },
  }

  const fakeDocument = {
    createElement: () => {
      const el = Object.assign(new FakeEventTarget(), {
        controls: false,
        hidden: false,
        autoplay: false,
        muted: false,
        volume: 1,
        srcObject: null as unknown,
        play: async () => undefined,
        pause: () => undefined,
        remove: () => undefined,
        setSinkId: async () => undefined,
      })
      return el
    },
    body: {
      append: () => undefined,
    },
  }

  const fakeNavigator = {
    mediaDevices: {
      getUserMedia: async () => {
        trackCounter += 1
        const track = new FakeAudioTrack(`track-${trackCounter}`)
        capturedTracks.push(track)
        return new FakeMediaStream([track])
      },
    },
  }

  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    MediaStream: FakeMediaStream,
    RTCPeerConnection: class extends FakePeerConnection {
      constructor() {
        super()
        peerConnections.push(this)
      }
    },
    AudioContext: class extends FakeAudioContext {
      constructor() {
        super()
        audioContexts.push(this)
      }
    },
  })

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: fakeNavigator,
  })

  globalThis.fetch = async () => new Response('v=0\r\na=answer\r\n', { status: 200 })

  return {
    peerConnections,
    audioContexts,
    capturedTracks,
    restore: () => {
      globalThis.fetch = originalFetch
      ;(globalThis as Record<string, unknown>).window = originalWindow
      ;(globalThis as Record<string, unknown>).document = originalDocument
      ;(globalThis as Record<string, unknown>).RTCPeerConnection = originalRTCPeerConnection
      ;(globalThis as Record<string, unknown>).AudioContext = originalAudioContext
      ;(globalThis as Record<string, unknown>).MediaStream = originalMediaStream
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator)
      }
    },
  }
}

let activeHarness: TestHarness | undefined

afterEach(() => {
  activeHarness?.restore()
  activeHarness = undefined
})

test('startTranslationSession connects, supports live mute and device hot-swap, and cleans up on stop', async () => {
  activeHarness = setupBrowserHarness()
  const statuses: TranslationStatus[] = []
  let closedCalled = false

  const session = await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    noiseReduction: 'near_field',
    disableAudioDSP: true,
    callbacks: {
      onStatusChange: status => statuses.push(status),
      onClosed: () => {
        closedCalled = true
      },
    },
  })

  assert.deepStrictEqual(statuses, ['requesting-media', 'connecting', 'connected'])
  assert.strictEqual(activeHarness.peerConnections.length, 1)
  assert.strictEqual(activeHarness.capturedTracks.length, 1)
  assert.strictEqual(activeHarness.capturedTracks[0]?.enabled, true)

  // Live mute
  session.setMuted(true)
  assert.strictEqual(activeHarness.capturedTracks[0]?.enabled, false)

  // Live input hot-swap preserves mute state and stops old track
  await session.setInputDevice('mic-2')
  assert.strictEqual(activeHarness.capturedTracks.length, 2)
  assert.strictEqual(activeHarness.capturedTracks[0]?.stopped, true)
  assert.strictEqual(activeHarness.capturedTracks[1]?.enabled, false)
  assert.strictEqual(activeHarness.peerConnections[0]?.replacedTracks.length, 1)

  // Live output hot-swap calls AudioContext.setSinkId
  await session.setOutputDevice('out-2')
  assert.deepStrictEqual(activeHarness.audioContexts[0]?.sinkIds, ['out-1', 'out-2'])

  // Clean stop
  session.stop()
  assert.strictEqual(closedCalled, true)
  assert.strictEqual(activeHarness.peerConnections[0]?.closed, true)
  assert.strictEqual(activeHarness.audioContexts[0]?.closed, true)
  assert.strictEqual(activeHarness.capturedTracks[1]?.stopped, true)
  assert.deepStrictEqual(statuses.slice(-2), ['stopping', 'idle'])
})

test('startTranslationSession returns noop session immediately when AbortSignal is already aborted', async () => {
  activeHarness = setupBrowserHarness()
  const controller = new AbortController()
  controller.abort()
  const statuses: TranslationStatus[] = []

  await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    signal: controller.signal,
    callbacks: {
      onStatusChange: status => statuses.push(status),
    },
  })

  assert.deepStrictEqual(statuses, [])
  assert.strictEqual(activeHarness.peerConnections.length, 0)
  assert.strictEqual(activeHarness.capturedTracks.length, 0)
})

test('startTranslationSession closes with error when server sends a Realtime error event', async () => {
  activeHarness = setupBrowserHarness()
  const statuses: TranslationStatus[] = []
  let errorMessage = ''

  await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'pt',
    callbacks: {
      onStatusChange: status => statuses.push(status),
      onError: message => {
        errorMessage = message
      },
    },
  })

  const pc = activeHarness.peerConnections[0]
  assert.ok(pc)
  pc.dataChannel.emit('message', {
    data: JSON.stringify({ type: 'error', error: { message: 'insufficient_quota' } }),
  })

  assert.strictEqual(errorMessage, 'insufficient_quota')
  assert.strictEqual(statuses.at(-1), 'error')
  assert.strictEqual(pc.closed, true)
})

test('startTranslationSession reconnects automatically on peer failure while preserving mute and volume', async () => {
  activeHarness = setupBrowserHarness({ fastTimers: true })
  const statuses: TranslationStatus[] = []

  const session = await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    initialMuted: true,
    initialOutputVolume: 1.25,
    callbacks: {
      onStatusChange: status => statuses.push(status),
    },
  })

  const firstPc = activeHarness.peerConnections[0]
  assert.ok(firstPc)

  // Emit remote track to verify GainNode volume wiring
  firstPc.emit('track', {
    track: new FakeAudioTrack('remote-1'),
    streams: [new FakeMediaStream([new FakeAudioTrack('remote-1')])],
    receiver: {},
  })
  assert.strictEqual(activeHarness.audioContexts[0]?.lastGainNode?.gain.value, 1.25)

  session.setOutputVolume(0.75)
  assert.strictEqual(activeHarness.audioContexts[0]?.lastGainNode?.gain.value, 0.75)

  // Trigger connection failure -> should reconnect automatically
  firstPc.connectionState = 'failed'
  firstPc.emit('connectionstatechange')

  await new Promise(resolve => setTimeout(resolve, 30))

  assert.strictEqual(activeHarness.peerConnections.length, 2)
  assert.strictEqual(firstPc.closed, true)
  assert.strictEqual(activeHarness.capturedTracks[1]?.enabled, false)
  assert.ok(statuses.includes('reconnecting'))
  assert.strictEqual(statuses.at(-1), 'connected')

  session.stop()
})
