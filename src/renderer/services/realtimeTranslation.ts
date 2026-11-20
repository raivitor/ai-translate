import type { NoiseReductionMode } from '../../shared/realtimeAudioConfig.js'

export type TranslationStatus = 'idle' | 'requesting-media' | 'connecting' | 'connected' | 'stopping' | 'error'

export type TranslationSessionCallbacks = {
  onStatusChange: (status: TranslationStatus) => void
  onError?: (message: string) => void
  onClosed?: () => void
}

export type StartTranslationSessionOptions = {
  inputDeviceId: string
  outputDeviceId: string
  targetLanguage: string
  noiseReduction?: NoiseReductionMode
  disableAudioDSP?: boolean
  signal?: AbortSignal
  callbacks: TranslationSessionCallbacks
}

type RealtimeServerEvent = {
  type?: unknown
  error?: unknown
}

type AudioContextOptionsWithSinkId = AudioContextOptions & {
  sinkId?: string
}

type AudioContextWithSinkId = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>
}

type SinkSelectableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

type RTCRtpReceiverWithJitterBufferTarget = RTCRtpReceiver & {
  jitterBufferTarget?: number
}

type LatencyLogger = {
  mark: (label: string) => void
  markOnce: (label: string) => void
}

const latencyDebugEnabled = import.meta.env.VITE_LATENCY_DEBUG === 'true'

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

export type ActiveTranslationSession = {
  stop: () => void
  setInputDevice: (deviceId: string) => Promise<void>
  setOutputDevice: (deviceId: string) => Promise<void>
}

const NOOP_SESSION: ActiveTranslationSession = {
  stop: () => undefined,
  setInputDevice: async () => undefined,
  setOutputDevice: async () => undefined,
}

function buildAudioConstraints(deviceId: string, disableAudioDSP?: boolean): MediaTrackConstraints {
  return {
    echoCancellation: !disableAudioDSP,
    noiseSuppression: !disableAudioDSP,
    autoGainControl: !disableAudioDSP,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
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
  closeWithError: (message: string) => void,
): void {
  dataChannel.addEventListener('open', () => {
    latencyLogger.mark('data channel open')
  })

  dataChannel.addEventListener('error', () => {
    closeWithError('Realtime data channel failed.')
  })

  dataChannel.addEventListener('message', event => {
    if (typeof event.data !== 'string' || !event.data.includes('error')) {
      return
    }

    try {
      const realtimeEvent = JSON.parse(event.data) as RealtimeServerEvent
      const errorMessage = getRealtimeErrorMessage(realtimeEvent)

      if (errorMessage) {
        closeWithError(errorMessage)
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

async function createOutputAudioContext(outputDeviceId: string): Promise<AudioContextWithSinkId | undefined> {
  let ctx: AudioContextWithSinkId

  try {
    ctx = new AudioContext({
      latencyHint: 'interactive',
      sinkId: outputDeviceId,
    } as AudioContextOptionsWithSinkId) as AudioContextWithSinkId
  } catch {
    ctx = new AudioContext({ latencyHint: 'interactive' }) as AudioContextWithSinkId
  }

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

export async function startTranslationSession({
  inputDeviceId,
  outputDeviceId,
  targetLanguage,
  noiseReduction,
  disableAudioDSP,
  signal,
  callbacks,
}: StartTranslationSessionOptions): Promise<ActiveTranslationSession> {
  if (signal?.aborted) {
    return NOOP_SESSION
  }

  if (!window.aiTranslate) {
    throw new Error('Electron bridge is not available.')
  }

  const latencyLogger = createLatencyLogger()
  latencyLogger.mark('start')
  callbacks.onStatusChange('requesting-media')

  const audioConstraints = buildAudioConstraints(inputDeviceId, disableAudioDSP)

  let inputStream: MediaStream | undefined
  let peerConnection: RTCPeerConnection | undefined
  let audioSender: RTCRtpSender | undefined
  let dataChannel: RTCDataChannel | undefined
  let audioContext: AudioContextWithSinkId | undefined
  let remoteAudioSource: MediaStreamAudioSourceNode | undefined
  let isClosed = false
  const audioElement = document.createElement('audio') as SinkSelectableAudioElement
  audioElement.controls = false
  audioElement.hidden = true
  audioElement.autoplay = true
  audioElement.volume = 1

  audioElement.addEventListener('playing', () => {
    latencyLogger.markOnce('first playing')
  })

  const inputStreamPromise = navigator.mediaDevices
    .getUserMedia({ audio: audioConstraints, video: false })
    .then(stream => {
      inputStream = stream
      latencyLogger.mark('media captured')
      return stream
    })

  const clientSecretPromise = window.aiTranslate.createClientSecret({ targetLanguage, noiseReduction }).then(result => {
    latencyLogger.mark('client secret received')
    return result.value
  })

  function closeSession(): void {
    if (isClosed) {
      return
    }

    isClosed = true
    signal?.removeEventListener('abort', closeSession)

    if (dataChannel && dataChannel.readyState !== 'closed') {
      dataChannel.close()
    }

    peerConnection?.close()

    if (remoteAudioSource) {
      remoteAudioSource.disconnect()
      remoteAudioSource = undefined
    }

    const ctx = audioContext
    audioContext = undefined
    void ctx?.close().catch(() => undefined)

    audioElement.pause()
    audioElement.srcObject = null
    audioElement.remove()

    if (inputStream) {
      stopStream(inputStream)
    } else {
      void inputStreamPromise.then(stopStream).catch(() => undefined)
    }

    callbacks.onClosed?.()
  }

  function closeWithError(message: string): void {
    if (isClosed) {
      return
    }

    closeSession()
    callbacks.onError?.(message)
    callbacks.onStatusChange('error')
  }

  signal?.addEventListener('abort', closeSession, { once: true })

  try {
    peerConnection = new RTCPeerConnection()
    dataChannel = peerConnection.createDataChannel('oai-events')
    addDataChannelListeners(dataChannel, latencyLogger, closeWithError)

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
    callbacks.onStatusChange('connecting')

    const [capturedInputStream, clientSecret] = await Promise.all([
      inputStreamPromise,
      clientSecretPromise,
      outputSinkPromise,
    ])

    if (isClosed) {
      return NOOP_SESSION
    }

    const [inputTrack] = capturedInputStream.getAudioTracks()

    if (!inputTrack) {
      throw new Error('No microphone audio track was captured.')
    }

    audioSender = peerConnection.addTrack(inputTrack, capturedInputStream)

    peerConnection.addEventListener('track', event => {
      if (isClosed || audioElement.srcObject) {
        return
      }

      const remoteStream = event.streams[0] ?? new MediaStream([event.track])
      latencyLogger.markOnce('first remote track')
      event.track.addEventListener('unmute', () => {
        latencyLogger.markOnce('remote track unmuted')
      })

      const receiver = event.receiver as RTCRtpReceiverWithJitterBufferTarget
      if (receiver.jitterBufferTarget !== undefined) {
        receiver.jitterBufferTarget = 0
      }

      audioElement.srcObject = remoteStream

      if (audioContext) {
        // Keep Chromium's WebRTC remote audio pipeline active for MediaStreamAudioSourceNode.
        void audioElement.play().catch(() => undefined)
        remoteAudioSource = audioContext.createMediaStreamSource(remoteStream)
        remoteAudioSource.connect(audioContext.destination)
        void audioContext
          .resume()
          .then(() => {
            latencyLogger.markOnce('first playing')
          })
          .catch(() => {
            closeWithError('Could not play translated audio.')
          })
      } else {
        void audioElement.play().catch(() => {
          closeWithError('Could not play translated audio.')
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
      return NOOP_SESSION
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text(),
    })
    latencyLogger.mark('remote description applied')

    if (isClosed) {
      return NOOP_SESSION
    }

    callbacks.onStatusChange('connected')

    return {
      stop: () => {
        if (isClosed) {
          return
        }
        callbacks.onStatusChange('stopping')
        closeSession()
        callbacks.onStatusChange('idle')
      },
      setInputDevice: async (nextDeviceId: string) => {
        if (isClosed || !audioSender) {
          return
        }

        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints(nextDeviceId, disableAudioDSP),
          video: false,
        })

        if (isClosed) {
          stopStream(nextStream)
          return
        }

        const [nextTrack] = nextStream.getAudioTracks()

        if (!nextTrack) {
          stopStream(nextStream)
          throw new Error('No microphone audio track was captured.')
        }

        try {
          await audioSender.replaceTrack(nextTrack)
        } catch (error) {
          stopStream(nextStream)
          throw error
        }

        if (isClosed) {
          stopStream(nextStream)
          return
        }

        const previousStream = inputStream
        inputStream = nextStream
        if (previousStream) {
          stopStream(previousStream)
        }
      },
      setOutputDevice: async (nextDeviceId: string) => {
        if (isClosed) {
          return
        }

        if (audioContext?.setSinkId) {
          await audioContext.setSinkId(nextDeviceId)
          return
        }

        if (audioElement.setSinkId) {
          await audioElement.setSinkId(nextDeviceId)
          return
        }

        throw new Error('This runtime does not support selecting an audio output device.')
      },
    }
  } catch (error) {
    closeSession()

    if (signal?.aborted) {
      return NOOP_SESSION
    }

    throw error
  }
}
