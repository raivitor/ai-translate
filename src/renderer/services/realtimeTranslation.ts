import type { NoiseReductionMode } from '../../shared/realtimeAudioConfig.js'
import {
  computeAudioLevel,
  DISCONNECT_GRACE_MS,
  extractConnectionStats,
  getReconnectDelayMs,
  MAX_RECONNECT_ATTEMPTS,
  SESSION_ROLLOVER_MS,
  type AudioLevels,
  type ConnectionStats,
} from './realtimeMetrics.js'

export type { AudioLevels, ConnectionStats } from './realtimeMetrics.js'

export type TranslationStatus =
  'idle' | 'requesting-media' | 'connecting' | 'connected' | 'reconnecting' | 'stopping' | 'error'

export type TranslationSessionCallbacks = {
  onStatusChange: (status: TranslationStatus) => void
  onError?: (message: string) => void
  onClosed?: () => void
  onStats?: (stats: ConnectionStats) => void
  onLevels?: (levels: AudioLevels) => void
  onPlaybackReady?: (ready: boolean) => void
}

export type StartTranslationSessionOptions = {
  inputDeviceId: string
  outputDeviceId: string
  targetLanguage: string
  noiseReduction?: NoiseReductionMode
  disableAudioDSP?: boolean
  initialMuted?: boolean
  initialOutputVolume?: number
  signal?: AbortSignal
  callbacks: TranslationSessionCallbacks
}

export type ActiveTranslationSession = {
  stop: () => void
  setMuted: (muted: boolean) => void
  setOutputVolume: (volume: number) => void
}

type RealtimeServerEvent = {
  type?: unknown
  error?: unknown
}

type AudioContextWithSinkId = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>
}

type SinkSelectableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

type RTCRtpReceiverWithJitterBufferTarget = RTCRtpReceiver & {
  jitterBufferTarget?: number | null
}

type SpeechHintAudioTrack = MediaStreamTrack & {
  contentHint?: string
}

type LatencyLogger = {
  mark: (label: string) => void
  markOnce: (label: string) => void
}

type ManagedConnection = {
  getConnectionState: () => RTCPeerConnectionState | 'closed'
  applyMute: (muted: boolean) => void
  applyVolume: (volume: number) => void
  readLevels: () => AudioLevels
  readStats: () => Promise<ConnectionStats>
  close: () => void
}

const STATS_POLL_INTERVAL_MS = 2000
const LEVELS_POLL_INTERVAL_MS = 80
const ANALYSER_FFT_SIZE = 256
const MAX_OUTPUT_VOLUME = 1.5
const AUDIO_SAMPLE_RATE = 48_000

const latencyDebugEnabled = import.meta.env?.VITE_LATENCY_DEBUG === 'true'

const NOOP_SESSION: ActiveTranslationSession = {
  stop: () => undefined,
  setMuted: () => undefined,
  setOutputVolume: () => undefined,
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 1
  }

  return Math.min(MAX_OUTPUT_VOLUME, Math.max(0, volume))
}

function createLatencyLogger(): LatencyLogger {
  const startedAt = performance.now()
  const seenLabels = new Set<string>()

  function mark(label: string): void {
    if (!latencyDebugEnabled) {
      return
    }

    console.info(`[ai-translate latency] ${label}: ${Math.round(performance.now() - startedAt)}ms`)
  }

  return {
    mark,
    markOnce: (label: string) => {
      if (seenLabels.has(label)) {
        return
      }

      seenLabels.add(label)
      mark(label)
    },
  }
}

function buildAudioConstraints(deviceId: string, disableAudioDSP?: boolean): MediaTrackConstraints {
  return {
    echoCancellation: !disableAudioDSP,
    noiseSuppression: !disableAudioDSP,
    autoGainControl: !disableAudioDSP,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: AUDIO_SAMPLE_RATE },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  }
}

function applySpeechContentHint(track: MediaStreamTrack): void {
  const hintTrack = track as SpeechHintAudioTrack
  if ('contentHint' in hintTrack) {
    hintTrack.contentHint = 'speech'
  }
}

function getRealtimeErrorMessage(realtimeEvent: RealtimeServerEvent): string | undefined {
  if (realtimeEvent.type !== 'error') {
    return undefined
  }

  if (typeof realtimeEvent.error === 'string') {
    return realtimeEvent.error
  }

  if (typeof realtimeEvent.error === 'object' && realtimeEvent.error !== null && !Array.isArray(realtimeEvent.error)) {
    const errorRecord = realtimeEvent.error as Record<string, unknown>
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : undefined
    const code = typeof errorRecord.code === 'string' ? errorRecord.code : undefined

    return message ?? code ?? 'OpenAI Realtime returned an error event.'
  }

  return 'OpenAI Realtime returned an error event.'
}

function addDataChannelListeners(
  dataChannel: RTCDataChannel,
  latencyLogger: LatencyLogger,
  onFatalError: (message: string) => void,
): void {
  dataChannel.addEventListener('open', () => {
    latencyLogger.mark('data channel open')
  })

  dataChannel.addEventListener('error', () => {
    onFatalError('Realtime data channel failed.')
  })

  dataChannel.addEventListener('message', event => {
    if (typeof event.data !== 'string' || !event.data.includes('error')) {
      return
    }

    try {
      const realtimeEvent = JSON.parse(event.data) as RealtimeServerEvent
      const errorMessage = getRealtimeErrorMessage(realtimeEvent)

      if (errorMessage) {
        onFatalError(errorMessage)
      }
    } catch {
      // Ignore malformed server events.
    }
  })
}

async function getErrorResponseMessage(response: Response): Promise<string> {
  const trimmedBody = (await response.text().catch(() => '')).trim()
  const statusLine = `HTTP ${response.status} ${response.statusText}`.trim()

  return trimmedBody ? `${statusLine}: ${trimmedBody}` : statusLine
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function applyStreamMute(stream: MediaStream | undefined, muted: boolean): void {
  if (!stream) {
    return
  }

  for (const track of stream.getAudioTracks()) {
    track.enabled = !muted
  }
}

async function createOutputAudioContext(outputDeviceId: string): Promise<AudioContextWithSinkId | undefined> {
  const ctx = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: AUDIO_SAMPLE_RATE,
  }) as AudioContextWithSinkId

  if (!ctx.setSinkId) {
    void ctx.close().catch(() => undefined)
    return undefined
  }

  try {
    await ctx.setSinkId(outputDeviceId)
    return ctx
  } catch {
    void ctx.close().catch(() => undefined)
    return undefined
  }
}

type OpenConnectionParams = {
  inputDeviceId: string
  outputDeviceId: string
  targetLanguage: string
  noiseReduction?: NoiseReductionMode | undefined
  disableAudioDSP?: boolean | undefined
  getMuted: () => boolean
  getOutputVolume: () => number
  enableLevels: boolean
  signal?: AbortSignal | undefined
  onMediaCaptured?: (() => void) | undefined
  onFatalError: (message: string) => void
  onDisconnected: (reason?: string) => void
  onPeerConnected: () => void
  onPlaybackReady: (ready: boolean) => void
}

async function openConnection({
  inputDeviceId,
  outputDeviceId,
  targetLanguage,
  noiseReduction,
  disableAudioDSP,
  getMuted,
  getOutputVolume,
  enableLevels,
  signal,
  onMediaCaptured,
  onFatalError,
  onDisconnected,
  onPeerConnected,
  onPlaybackReady,
}: OpenConnectionParams): Promise<ManagedConnection> {
  const latencyLogger = createLatencyLogger()
  latencyLogger.mark('start')

  let inputStream: MediaStream | undefined
  let peerConnection: RTCPeerConnection | undefined
  let dataChannel: RTCDataChannel | undefined
  let audioContext: AudioContextWithSinkId | undefined
  let monitorContext: AudioContext | undefined
  let inputAnalyserSource: MediaStreamAudioSourceNode | undefined
  let inputAnalyser: AnalyserNode | undefined
  let remoteAudioSource: MediaStreamAudioSourceNode | undefined
  let outputGainNode: GainNode | undefined
  let outputAnalyser: AnalyserNode | undefined
  let isClosed = false
  let disconnectGraceTimer: number | undefined

  const inputSamples = new Float32Array(ANALYSER_FFT_SIZE)
  const outputSamples = new Float32Array(ANALYSER_FFT_SIZE)

  const audioElement = document.createElement('audio') as SinkSelectableAudioElement
  audioElement.controls = false
  audioElement.hidden = true
  audioElement.autoplay = true
  audioElement.volume = Math.min(1, clampVolume(getOutputVolume()))

  audioElement.addEventListener('playing', () => {
    latencyLogger.markOnce('first playing')
  })

  const clearDisconnectTimer = (): void => {
    if (disconnectGraceTimer !== undefined) {
      window.clearTimeout(disconnectGraceTimer)
      disconnectGraceTimer = undefined
    }
  }

  const attachInputMeter = (stream: MediaStream): void => {
    if (!enableLevels || isClosed) {
      return
    }

    inputAnalyserSource?.disconnect()
    inputAnalyserSource = undefined

    const meterCtx =
      audioContext ??
      monitorContext ??
      (monitorContext = new AudioContext({ latencyHint: 'interactive', sampleRate: AUDIO_SAMPLE_RATE }))
    if (!inputAnalyser) {
      inputAnalyser = meterCtx.createAnalyser()
      inputAnalyser.fftSize = ANALYSER_FFT_SIZE
    }

    inputAnalyserSource = meterCtx.createMediaStreamSource(stream)
    inputAnalyserSource.connect(inputAnalyser)
    void meterCtx.resume().catch(() => undefined)
  }

  const inputStreamPromise = navigator.mediaDevices
    .getUserMedia({ audio: buildAudioConstraints(inputDeviceId, disableAudioDSP), video: false })
    .then(stream => {
      inputStream = stream
      applyStreamMute(stream, getMuted())
      latencyLogger.mark('media captured')
      if (!isClosed) {
        onMediaCaptured?.()
      }
      return stream
    })

  const clientSecretPromise = window
    .aiTranslate!.createClientSecret({ targetLanguage, noiseReduction })
    .then(result => {
      latencyLogger.mark('client secret received')
      return result.value
    })

  const close = (): void => {
    if (isClosed) {
      return
    }

    isClosed = true
    clearDisconnectTimer()
    signal?.removeEventListener('abort', close)
    onPlaybackReady(false)

    if (dataChannel && dataChannel.readyState !== 'closed') {
      dataChannel.close()
    }

    peerConnection?.close()
    inputAnalyserSource?.disconnect()
    inputAnalyserSource = undefined
    inputAnalyser = undefined

    remoteAudioSource?.disconnect()
    remoteAudioSource = undefined
    outputGainNode?.disconnect()
    outputGainNode = undefined
    outputAnalyser?.disconnect()
    outputAnalyser = undefined

    const outCtx = audioContext
    audioContext = undefined
    void outCtx?.close().catch(() => undefined)

    const monCtx = monitorContext
    monitorContext = undefined
    void monCtx?.close().catch(() => undefined)

    audioElement.pause()
    audioElement.srcObject = null
    audioElement.remove()

    if (inputStream) {
      stopStream(inputStream)
    } else {
      void inputStreamPromise.then(stopStream).catch(() => undefined)
    }
  }

  const triggerFatal = (message: string): void => {
    if (isClosed) {
      return
    }
    close()
    onFatalError(message)
  }

  const applyVolume = (nextVolume: number): void => {
    const clamped = clampVolume(nextVolume)
    if (outputGainNode) {
      outputGainNode.gain.value = clamped
    } else {
      audioElement.volume = Math.min(1, clamped)
    }
  }

  signal?.addEventListener('abort', close, { once: true })

  try {
    peerConnection = new RTCPeerConnection()
    dataChannel = peerConnection.createDataChannel('oai-events')
    addDataChannelListeners(dataChannel, latencyLogger, triggerFatal)

    peerConnection.addEventListener('connectionstatechange', () => {
      if (isClosed || !peerConnection) {
        return
      }

      const state = peerConnection.connectionState
      if (state === 'connected') {
        clearDisconnectTimer()
        onPeerConnected()
      } else if (state === 'failed') {
        clearDisconnectTimer()
        onDisconnected('Falha na conexão WebRTC.')
      } else if (state === 'disconnected' && disconnectGraceTimer === undefined) {
        disconnectGraceTimer = window.setTimeout(() => {
          disconnectGraceTimer = undefined
          if (!isClosed && peerConnection && peerConnection.connectionState !== 'connected') {
            onDisconnected('Conexão WebRTC interrompida.')
          }
        }, DISCONNECT_GRACE_MS)
      }
    })

    const outputSinkPromise = (async () => {
      if (!outputDeviceId) {
        return
      }

      const ctx = await createOutputAudioContext(outputDeviceId)

      if (isClosed) {
        void ctx?.close().catch(() => undefined)
        return
      }

      if (ctx) {
        audioContext = ctx
        audioElement.muted = true
        latencyLogger.mark('audio context sink selected')
      } else if (audioElement.setSinkId) {
        await audioElement.setSinkId(outputDeviceId)
        latencyLogger.mark('audio element sink selected')
      } else {
        throw new Error('This runtime does not support selecting an audio output device.')
      }
    })()

    document.body.append(audioElement)

    const [capturedInputStream, clientSecret] = await Promise.all([
      inputStreamPromise,
      clientSecretPromise,
      outputSinkPromise,
    ])

    if (isClosed) {
      throw new Error('Connection aborted.')
    }

    const [inputTrack] = capturedInputStream.getAudioTracks()

    if (!inputTrack) {
      throw new Error('No microphone audio track was captured.')
    }

    applyStreamMute(capturedInputStream, getMuted())
    applySpeechContentHint(inputTrack)
    attachInputMeter(capturedInputStream)
    peerConnection.addTrack(inputTrack, capturedInputStream)

    peerConnection.addEventListener('track', event => {
      if (isClosed || audioElement.srcObject) {
        return
      }

      const receiver = event.receiver as RTCRtpReceiverWithJitterBufferTarget | undefined
      if (receiver && 'jitterBufferTarget' in receiver) {
        try {
          receiver.jitterBufferTarget = 0
        } catch {
          // Ignore runtimes with read-only or unsupported jitterBufferTarget.
        }
      }

      const remoteStream = event.streams[0] ?? new MediaStream([event.track])
      latencyLogger.markOnce('first remote track')
      event.track.addEventListener('unmute', () => {
        latencyLogger.markOnce('remote track unmuted')
      })

      audioElement.srcObject = remoteStream
      const volume = clampVolume(getOutputVolume())

      if (audioContext) {
        // Keep Chromium's WebRTC remote audio pipeline active for MediaStreamAudioSourceNode.
        void audioElement.play().catch(() => undefined)
        remoteAudioSource = audioContext.createMediaStreamSource(remoteStream)
        outputGainNode = audioContext.createGain()
        outputGainNode.gain.value = volume
        remoteAudioSource.connect(outputGainNode)
        outputGainNode.connect(audioContext.destination)

        if (enableLevels) {
          outputAnalyser = audioContext.createAnalyser()
          outputAnalyser.fftSize = ANALYSER_FFT_SIZE
          outputGainNode.connect(outputAnalyser)
        }

        void audioContext
          .resume()
          .then(() => {
            if (!isClosed) {
              latencyLogger.markOnce('first playing')
              onPlaybackReady(true)
            }
          })
          .catch(() => {
            triggerFatal('Could not play translated audio.')
          })
      } else {
        audioElement.volume = Math.min(1, volume)
        void audioElement
          .play()
          .then(() => {
            if (!isClosed) {
              onPlaybackReady(true)
            }
          })
          .catch(() => {
            triggerFatal('Could not play translated audio.')
          })
      }
    })

    const offer = await peerConnection.createOffer()
    latencyLogger.mark('SDP offer created')
    await peerConnection.setLocalDescription(offer)

    if (!offer.sdp) {
      throw new Error('WebRTC did not create an SDP offer.')
    }

    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
      method: 'POST',
      body: offer.sdp,
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    })
    latencyLogger.mark('SDP answer received')

    if (!sdpResponse.ok) {
      throw new Error(`OpenAI rejected the WebRTC SDP offer: ${await getErrorResponseMessage(sdpResponse)}`)
    }

    if (isClosed) {
      throw new Error('Connection aborted.')
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text(),
    })
    latencyLogger.mark('remote description applied')

    if (isClosed) {
      throw new Error('Connection aborted.')
    }

    return {
      getConnectionState: () => (isClosed ? 'closed' : (peerConnection?.connectionState ?? 'closed')),
      applyMute: (nextMuted: boolean) => {
        applyStreamMute(inputStream, nextMuted)
      },
      applyVolume,
      readLevels: () => {
        let input = 0
        let output = 0

        if (!getMuted() && inputAnalyser) {
          inputAnalyser.getFloatTimeDomainData(inputSamples)
          input = computeAudioLevel(inputSamples)
        }

        if (outputAnalyser) {
          outputAnalyser.getFloatTimeDomainData(outputSamples)
          output = computeAudioLevel(outputSamples)
        }

        return { input, output }
      },
      readStats: async () => {
        if (isClosed || !peerConnection) {
          return { rttMs: null, packetsLost: 0, jitterMs: null }
        }

        const report = await peerConnection.getStats()
        return extractConnectionStats(report.values() as Iterable<Record<string, unknown>>)
      },
      close,
    }
  } catch (error) {
    close()
    throw error
  }
}

export async function startTranslationSession({
  inputDeviceId,
  outputDeviceId,
  targetLanguage,
  noiseReduction,
  disableAudioDSP,
  initialMuted = false,
  initialOutputVolume = 1,
  signal,
  callbacks,
}: StartTranslationSessionOptions): Promise<ActiveTranslationSession> {
  if (signal?.aborted) {
    return NOOP_SESSION
  }

  if (!window.aiTranslate) {
    throw new Error('Electron bridge is not available.')
  }

  let currentMuted = initialMuted
  let currentOutputVolume = clampVolume(initialOutputVolume)
  let activeConnection: ManagedConnection | undefined
  let isStopped = false
  let isReconnecting = false
  let isPeerConnected = false
  let reconnectAttempt = 0
  let reconnectTimer: number | undefined
  let cancelReconnectWait: (() => void) | undefined
  let rolloverTimer: number | undefined
  let statsInterval: number | undefined
  let levelsInterval: number | undefined

  const sessionAbortController = new AbortController()

  const clearTimers = (): void => {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    cancelReconnectWait?.()
    cancelReconnectWait = undefined
    if (rolloverTimer !== undefined) {
      window.clearTimeout(rolloverTimer)
      rolloverTimer = undefined
    }
    if (statsInterval !== undefined) {
      window.clearInterval(statsInterval)
      statsInterval = undefined
    }
    if (levelsInterval !== undefined) {
      window.clearInterval(levelsInterval)
      levelsInterval = undefined
    }
  }

  const stopSession = (): void => {
    if (isStopped) {
      return
    }

    isStopped = true
    signal?.removeEventListener('abort', stopSession)
    sessionAbortController.abort()
    clearTimers()
    activeConnection?.close()
    activeConnection = undefined
    callbacks.onPlaybackReady?.(false)
    callbacks.onLevels?.({ input: 0, output: 0 })
    callbacks.onClosed?.()
  }

  const failSession = (message: string): void => {
    if (isStopped) {
      return
    }

    stopSession()
    callbacks.onError?.(message)
    callbacks.onStatusChange('error')
  }

  const startTelemetry = (): void => {
    clearTimers()

    rolloverTimer = window.setTimeout(() => {
      if (!isStopped) {
        reconnectAttempt = 0
        void triggerReconnect(0)
      }
    }, SESSION_ROLLOVER_MS)

    if (callbacks.onStats) {
      statsInterval = window.setInterval(() => {
        if (!isStopped && activeConnection) {
          void activeConnection
            .readStats()
            .then(stats => {
              if (!isStopped) {
                callbacks.onStats?.(stats)
              }
            })
            .catch(() => undefined)
        }
      }, STATS_POLL_INTERVAL_MS)
    }

    if (callbacks.onLevels) {
      levelsInterval = window.setInterval(() => {
        if (!isStopped && activeConnection) {
          callbacks.onLevels?.(activeConnection.readLevels())
        }
      }, LEVELS_POLL_INTERVAL_MS)
    }
  }

  const markPeerConnected = (): void => {
    if (isStopped || isPeerConnected) {
      return
    }

    isPeerConnected = true
    reconnectAttempt = 0
    isReconnecting = false
    callbacks.onStatusChange('connected')
    startTelemetry()
  }

  const establishConnection = async (notifyConnectingOnCapture: boolean): Promise<ManagedConnection> => {
    const conn = await openConnection({
      inputDeviceId,
      outputDeviceId,
      targetLanguage,
      noiseReduction,
      disableAudioDSP,
      getMuted: () => currentMuted,
      getOutputVolume: () => currentOutputVolume,
      enableLevels: Boolean(callbacks.onLevels),
      signal: sessionAbortController.signal,
      onMediaCaptured: notifyConnectingOnCapture
        ? () => {
            if (!isStopped) {
              callbacks.onStatusChange('connecting')
            }
          }
        : undefined,
      onFatalError: failSession,
      onDisconnected: reason => {
        if (!isStopped && !isReconnecting) {
          void triggerReconnect(reconnectAttempt + 1, reason)
        }
      },
      onPeerConnected: markPeerConnected,
      onPlaybackReady: ready => {
        if (!isStopped) {
          callbacks.onPlaybackReady?.(ready)
        }
      },
    })

    // Always re-apply the latest mute and volume in case they changed during handshake.
    conn.applyMute(currentMuted)
    conn.applyVolume(currentOutputVolume)
    return conn
  }

  const triggerReconnect = async (nextAttempt: number, lastError?: string): Promise<void> => {
    if (isStopped || isReconnecting) {
      return
    }

    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      const reason = lastError ? ` (${lastError})` : ''
      failSession(`Conexão WebRTC perdida após tentativas de reconexão${reason}.`)
      return
    }

    isReconnecting = true
    isPeerConnected = false
    reconnectAttempt = nextAttempt
    clearTimers()
    activeConnection?.close()
    activeConnection = undefined
    callbacks.onPlaybackReady?.(false)
    callbacks.onLevels?.({ input: 0, output: 0 })
    callbacks.onStatusChange('reconnecting')

    const waitMs = nextAttempt > 0 ? getReconnectDelayMs(nextAttempt) : 0

    if (waitMs > 0) {
      await new Promise<void>(resolve => {
        cancelReconnectWait = resolve
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined
          cancelReconnectWait = undefined
          resolve()
        }, waitMs)
      })
    }

    if (isStopped) {
      isReconnecting = false
      return
    }

    try {
      const nextConnection = await establishConnection(false)
      if (isStopped) {
        nextConnection.close()
        return
      }

      activeConnection = nextConnection
      isReconnecting = false

      // Only reset reconnectAttempt and mark 'connected' once the peer actually connects.
      const peerState = nextConnection.getConnectionState()
      if (peerState === 'connected') {
        markPeerConnected()
      } else if (peerState === 'failed') {
        void triggerReconnect(nextAttempt + 1, 'Falha na conexão WebRTC.')
      }
    } catch (caughtError) {
      isReconnecting = false
      if (!isStopped) {
        const errorDetail = caughtError instanceof Error ? caughtError.message : undefined
        void triggerReconnect(nextAttempt + 1, errorDetail)
      }
    }
  }

  signal?.addEventListener('abort', stopSession, { once: true })
  callbacks.onStatusChange('requesting-media')

  try {
    const initialConnection = await establishConnection(true)

    if (isStopped) {
      initialConnection.close()
      return NOOP_SESSION
    }

    activeConnection = initialConnection
    const peerState = initialConnection.getConnectionState()
    if (peerState === 'connected') {
      markPeerConnected()
    } else if (peerState === 'failed') {
      void triggerReconnect(1, 'Falha na conexão WebRTC.')
    }

    return {
      stop: () => {
        if (isStopped) {
          return
        }
        callbacks.onStatusChange('stopping')
        stopSession()
        callbacks.onStatusChange('idle')
      },
      setMuted: (muted: boolean) => {
        currentMuted = muted
        activeConnection?.applyMute(muted)
      },
      setOutputVolume: (volume: number) => {
        currentOutputVolume = clampVolume(volume)
        activeConnection?.applyVolume(currentOutputVolume)
      },
    }
  } catch (error) {
    stopSession()

    if (signal?.aborted) {
      return NOOP_SESSION
    }

    throw error
  }
}
