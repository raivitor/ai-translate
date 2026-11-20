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
  private readonly postSdpState: RTCPeerConnectionState

  constructor(postSdpState: RTCPeerConnectionState = 'connected') {
    super()
    this.postSdpState = postSdpState
  }

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
    this.connectionState = this.postSdpState
    if (this.postSdpState === 'connected' || this.postSdpState === 'failed') {
      this.emit('connectionstatechange')
    }
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

type HarnessOptions = {
  fastTimers?: boolean
  postSdpState?: (connectionIndex: number) => RTCPeerConnectionState
  onGetUserMedia?: (callIndex: number, createDefault: () => FakeMediaStream) => Promise<FakeMediaStream>
}

function setupBrowserHarness(options?: HarnessOptions): TestHarness {
  const peerConnections: FakePeerConnection[] = []
  const audioContexts: FakeAudioContext[] = []
  const capturedTracks: FakeAudioTrack[] = []
  let trackCounter = 0
  let pcCounter = 0

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
    createElement: () =>
      Object.assign(new FakeEventTarget(), {
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
      }),
    body: {
      append: () => undefined,
    },
  }

  const createDefaultStream = (): FakeMediaStream => {
    trackCounter += 1
    const track = new FakeAudioTrack(`track-${trackCounter}`)
    capturedTracks.push(track)
    return new FakeMediaStream([track])
  }

  const fakeNavigator = {
    mediaDevices: {
      getUserMedia: async () => {
        if (options?.onGetUserMedia) {
          return options.onGetUserMedia(trackCounter + 1, createDefaultStream)
        }
        return createDefaultStream()
      },
    },
  }

  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    MediaStream: FakeMediaStream,
    RTCPeerConnection: class extends FakePeerConnection {
      constructor() {
        const index = pcCounter
        pcCounter += 1
        const state = options?.postSdpState ? options.postSdpState(index) : 'connected'
        super(state)
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

test('startTranslationSession connects, separates peer connection from playback ready, and cleans up on stop', async () => {
  activeHarness = setupBrowserHarness({ postSdpState: () => 'connecting' })
  const statuses: TranslationStatus[] = []
  const playbackStates: boolean[] = []
  let closedCalled = false

  const session = await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    noiseReduction: 'near_field',
    disableAudioDSP: true,
    callbacks: {
      onStatusChange: status => statuses.push(status),
      onPlaybackReady: ready => playbackStates.push(ready),
      onClosed: () => {
        closedCalled = true
      },
    },
  })

  // SDP applied, but peer is still connecting -> must NOT be 'connected' yet.
  assert.deepStrictEqual(statuses, ['requesting-media', 'connecting'])

  const pc = activeHarness.peerConnections[0]
  assert.ok(pc)
  pc.connectionState = 'connected'
  pc.emit('connectionstatechange')
  assert.strictEqual(statuses.at(-1), 'connected')
  assert.deepStrictEqual(playbackStates, [])

  // Remote audio track arrives -> playback becomes ready.
  pc.emit('track', {
    track: new FakeAudioTrack('remote-1'),
    streams: [new FakeMediaStream([new FakeAudioTrack('remote-1')])],
    receiver: {},
  })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.strictEqual(playbackStates.at(-1), true)

  session.stop()
  assert.strictEqual(closedCalled, true)
  assert.strictEqual(playbackStates.at(-1), false)
  assert.strictEqual(pc.closed, true)
  assert.strictEqual(activeHarness.audioContexts[0]?.closed, true)
  assert.strictEqual(activeHarness.capturedTracks[0]?.stopped, true)
  assert.deepStrictEqual(statuses.slice(-2), ['stopping', 'idle'])
})

test('startTranslationSession preserves mute toggled while input device hot-swap is in flight', async () => {
  let releaseSwapMedia: (() => void) | undefined

  activeHarness = setupBrowserHarness({
    onGetUserMedia: async (callIndex, createDefault) => {
      if (callIndex === 2) {
        await new Promise<void>(resolve => {
          releaseSwapMedia = resolve
        })
      }
      return createDefault()
    },
  })

  const session = await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    callbacks: { onStatusChange: () => undefined },
  })

  assert.strictEqual(activeHarness.capturedTracks[0]?.enabled, true)

  // Start hot-swap, then toggle mute WHILE getUserMedia is still pending.
  const swapPromise = session.setInputDevice('mic-2')
  session.setMuted(true)
  assert.strictEqual(activeHarness.capturedTracks[0]?.enabled, false)

  releaseSwapMedia?.()
  await swapPromise

  assert.strictEqual(activeHarness.capturedTracks.length, 2)
  assert.strictEqual(activeHarness.capturedTracks[0]?.stopped, true)
  assert.strictEqual(activeHarness.capturedTracks[1]?.enabled, false)
  assert.strictEqual(activeHarness.peerConnections[0]?.replacedTracks.length, 1)

  await session.setOutputDevice('out-2')
  assert.deepStrictEqual(activeHarness.audioContexts[0]?.sinkIds, ['out-1', 'out-2'])

  session.stop()
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

test('startTranslationSession stops retrying when repeated failures occur after SDP negotiation', async () => {
  // Initial connection succeeds, reconnect peers either fail during SDP apply or after staying 'connecting'.
  activeHarness = setupBrowserHarness({
    fastTimers: true,
    postSdpState: index => (index === 0 ? 'connected' : index === 1 ? 'failed' : 'connecting'),
  })
  const statuses: TranslationStatus[] = []
  let errorMessage = ''

  await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    callbacks: {
      onStatusChange: status => statuses.push(status),
      onError: message => {
        errorMessage = message
      },
    },
  })

  // Fail initial peer; peer #1 fails immediately during setRemoteDescription; fail peers #2 and #3 asynchronously.
  const firstPc = activeHarness.peerConnections[0]
  assert.ok(firstPc)
  firstPc.connectionState = 'failed'
  firstPc.emit('connectionstatechange')
  await new Promise(resolve => setTimeout(resolve, 40))

  for (const index of [2, 3]) {
    const pc = activeHarness.peerConnections[index]
    assert.ok(pc, `Expected peer connection #${index} to exist`)
    pc.connectionState = 'failed'
    pc.emit('connectionstatechange')
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  // Must exhaust MAX_RECONNECT_ATTEMPTS (1 initial + 3 retries = 4 total PCs) and stop in 'error'.
  assert.strictEqual(activeHarness.peerConnections.length, 4)
  assert.strictEqual(statuses.at(-1), 'error')
  assert.match(errorMessage, /reconexão/i)
})

test('startTranslationSession reconnects automatically and reapplies latest mute and volume', async () => {
  activeHarness = setupBrowserHarness({ fastTimers: true })
  const statuses: TranslationStatus[] = []

  const session = await startTranslationSession({
    inputDeviceId: 'mic-1',
    outputDeviceId: 'out-1',
    targetLanguage: 'en',
    initialMuted: false,
    initialOutputVolume: 1,
    callbacks: {
      onStatusChange: status => statuses.push(status),
    },
  })

  const firstPc = activeHarness.peerConnections[0]
  assert.ok(firstPc)

  firstPc.connectionState = 'failed'
  firstPc.emit('connectionstatechange')

  // Change mute & volume while reconnecting.
  session.setMuted(true)
  session.setOutputVolume(0.6)

  await new Promise(resolve => setTimeout(resolve, 30))

  assert.strictEqual(activeHarness.peerConnections.length, 2)
  assert.strictEqual(firstPc.closed, true)
  assert.strictEqual(activeHarness.capturedTracks[1]?.enabled, false)

  const secondPc = activeHarness.peerConnections[1]
  assert.ok(secondPc)
  secondPc.emit('track', {
    track: new FakeAudioTrack('remote-2'),
    streams: [new FakeMediaStream([new FakeAudioTrack('remote-2')])],
    receiver: {},
  })
  assert.strictEqual(activeHarness.audioContexts[1]?.lastGainNode?.gain.value, 0.6)
  assert.ok(statuses.includes('reconnecting'))
  assert.strictEqual(statuses.at(-1), 'connected')
  assert.strictEqual(statuses.filter(status => status === 'connected').length, 2)

  session.stop()
})
