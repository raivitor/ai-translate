export type TranslationStatus = 'idle' | 'requesting-media' | 'connecting' | 'connected' | 'stopping' | 'error'

export type TranslationTranscriptEvent = {
  kind: 'source' | 'target'
  text: string
}

export type TranslationSessionCallbacks = {
  onStatusChange: (status: TranslationStatus) => void
  onTranscript: (event: TranslationTranscriptEvent) => void
  onError?: (message: string) => void
  onClosed?: () => void
}

export type StartTranslationSessionOptions = {
  inputDeviceId: string
  outputDeviceId: string
  targetLanguage: string
  enableTranscription?: boolean
  disableAudioDSP?: boolean
  callbacks: TranslationSessionCallbacks
}

type RealtimeServerEvent = {
  type?: unknown
  delta?: unknown
  transcript?: unknown
  error?: unknown
}

type AudioContextWithSinkId = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>
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
}

async function createTranslationClientSecret(targetLanguage: string, enableTranscription?: boolean): Promise<string> {
  const result = await window.aiTranslate!.createClientSecret({
    targetLanguage,
    enableTranscription,
  })

  return result.value
}

function parseRealtimeEvent(rawData: string): RealtimeServerEvent | undefined {
  try {
    return JSON.parse(rawData) as RealtimeServerEvent
  } catch {
    return undefined
  }
}

function shouldParseRealtimeEvent(rawData: string, enableTranscription: boolean): boolean {
  return (
    enableTranscription ||
    rawData.includes('"error"') ||
    rawData.includes('"type":"error"') ||
    rawData.includes('"type": "error"')
  )
}

function readStringProperty(value: Record<string, unknown>, property: string): string | undefined {
  const rawProperty = value[property]

  return typeof rawProperty === 'string' ? rawProperty : undefined
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
    const message = readStringProperty(errorRecord, 'message')
    const code = readStringProperty(errorRecord, 'code')

    return message ?? code ?? 'OpenAI Realtime returned an error event.'
  }

  return 'OpenAI Realtime returned an error event.'
}

function isSourceTranscriptDelta(type: unknown): boolean {
  return type === 'session.input_transcript.delta' || type === 'conversation.item.input_audio_transcription.delta'
}

function isTargetTranscriptDelta(type: unknown): boolean {
  return (
    type === 'session.output_transcript.delta' ||
    type === 'response.audio_transcript.delta' ||
    type === 'response.output_audio_transcript.delta'
  )
}

function isSourceTranscriptCompleted(type: unknown): boolean {
  return (
    type === 'session.input_transcript.completed' || type === 'conversation.item.input_audio_transcription.completed'
  )
}

function isTargetTranscriptCompleted(type: unknown): boolean {
  return (
    type === 'session.output_transcript.completed' ||
    type === 'response.audio_transcript.done' ||
    type === 'response.output_audio_transcript.done'
  )
}

function addDataChannelListeners(
  dataChannel: RTCDataChannel,
  callbacks: TranslationSessionCallbacks,
  enableTranscription: boolean,
  latencyLogger: LatencyLogger,
  closeWithError: (message: string) => void,
): void {
  let sourceTranscriptHasDelta = false
  let targetTranscriptHasDelta = false

  dataChannel.addEventListener('open', () => {
    latencyLogger.mark('data channel open')
  })

  dataChannel.addEventListener('error', () => {
    closeWithError('Realtime data channel failed.')
  })

  dataChannel.addEventListener('message', event => {
    if (typeof event.data !== 'string') {
      return
    }

    if (!shouldParseRealtimeEvent(event.data, enableTranscription)) {
      return
    }

    const realtimeEvent = parseRealtimeEvent(event.data)

    if (!realtimeEvent) {
      return
    }

    const errorMessage = getRealtimeErrorMessage(realtimeEvent)

    if (errorMessage) {
      closeWithError(errorMessage)
      return
    }

    if (!enableTranscription) {
      return
    }

    if (isSourceTranscriptDelta(realtimeEvent.type) && typeof realtimeEvent.delta === 'string') {
      sourceTranscriptHasDelta = true
      latencyLogger.markOnce('first transcript')
      callbacks.onTranscript({ kind: 'source', text: realtimeEvent.delta })
    }

    if (isTargetTranscriptDelta(realtimeEvent.type) && typeof realtimeEvent.delta === 'string') {
      targetTranscriptHasDelta = true
      latencyLogger.markOnce('first transcript')
      callbacks.onTranscript({ kind: 'target', text: realtimeEvent.delta })
    }

    if (isSourceTranscriptCompleted(realtimeEvent.type) && typeof realtimeEvent.transcript === 'string') {
      callbacks.onTranscript({
        kind: 'source',
        text: sourceTranscriptHasDelta ? '\n' : `${realtimeEvent.transcript}\n`,
      })
      sourceTranscriptHasDelta = false
    }

    if (isTargetTranscriptCompleted(realtimeEvent.type) && typeof realtimeEvent.transcript === 'string') {
      callbacks.onTranscript({
        kind: 'target',
        text: targetTranscriptHasDelta ? '\n' : `${realtimeEvent.transcript}\n`,
      })
      targetTranscriptHasDelta = false
    }
  })
}

async function getErrorResponseMessage(response: Response): Promise<string> {
  const responseBody = await response.text().catch(() => '')
  const trimmedBody = responseBody.trim()

  if (!trimmedBody) {
    return `HTTP ${response.status} ${response.statusText}`.trim()
  }

  return `HTTP ${response.status} ${response.statusText}: ${trimmedBody}`.trim()
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function closeDataChannel(dataChannel: RTCDataChannel): void {
  if (dataChannel.readyState !== 'closed') {
    dataChannel.close()
  }
}

export async function startTranslationSession({
  inputDeviceId,
  outputDeviceId,
  targetLanguage,
  enableTranscription,
  disableAudioDSP,
  callbacks,
}: StartTranslationSessionOptions): Promise<ActiveTranslationSession> {
  const latencyLogger = createLatencyLogger()
  latencyLogger.mark('start')
  callbacks.onStatusChange('requesting-media')

  const audioConstraints: MediaTrackConstraints = disableAudioDSP
    ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }

  if (inputDeviceId) {
    audioConstraints.deviceId = { exact: inputDeviceId }
  }

  let inputStream: MediaStream | undefined
  let peerConnection: RTCPeerConnection | undefined
  let dataChannel: RTCDataChannel | undefined
  let audioContext: AudioContextWithSinkId | undefined
  let isClosed = false
  const audioElement = document.createElement('audio')
  audioElement.controls = false
  audioElement.style.display = 'none'
  audioElement.volume = 0

  audioElement.addEventListener('playing', () => {
    latencyLogger.markOnce('first playing')
  })

  const inputStreamPromise = navigator.mediaDevices
    .getUserMedia({
      audio: audioConstraints,
      video: false,
    })
    .then(stream => {
      inputStream = stream
      latencyLogger.mark('media captured')

      return stream
    })

  const clientSecretPromise = createTranslationClientSecret(targetLanguage, enableTranscription).then(clientSecret => {
    latencyLogger.mark('client secret received')

    return clientSecret
  })

  function closeSession(): void {
    if (isClosed) {
      return
    }

    isClosed = true

    if (dataChannel) {
      closeDataChannel(dataChannel)
    }

    peerConnection?.close()
    const ctx = audioContext
    audioContext = undefined
    void ctx?.close().catch(() => undefined)
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
    closeSession()
    callbacks.onError?.(message)
    callbacks.onStatusChange('error')
  }

  try {
    peerConnection = new RTCPeerConnection()
    dataChannel = peerConnection.createDataChannel('oai-events')
    addDataChannelListeners(dataChannel, callbacks, enableTranscription === true, latencyLogger, closeWithError)

    const outputSinkPromise = (async () => {
      const ctx: AudioContextWithSinkId = new AudioContext()
      audioContext = ctx

      if (outputDeviceId) {
        if (!ctx.setSinkId) {
          throw new Error('This runtime does not support selecting an audio output device.')
        }

        await ctx.setSinkId(outputDeviceId)
        latencyLogger.mark('audio sink selected')
      }
    })()

    document.body.append(audioElement)
    callbacks.onStatusChange('connecting')

    const [capturedInputStream, clientSecret] = await Promise.all([
      inputStreamPromise,
      clientSecretPromise,
      outputSinkPromise,
    ])

    inputStream = capturedInputStream

    const [inputTrack] = inputStream.getAudioTracks()

    if (!inputTrack) {
      throw new Error('No microphone audio track was captured.')
    }

    peerConnection.addTrack(inputTrack, inputStream)

    peerConnection.addEventListener('track', event => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track])

      latencyLogger.markOnce('first remote track')

      // Activate WebRTC audio rendering; element output is silenced via volume=0
      if (audioElement.srcObject) return
      audioElement.srcObject = remoteStream
      void audioElement.play().catch(() => {
        closeWithError('Could not play translated audio.')
      })

      // Route audio to the correct output device via AudioContext
      if (audioContext) {
        const source = audioContext.createMediaStreamSource(remoteStream)
        source.connect(audioContext.destination)
        void audioContext.resume().catch(() => undefined)
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
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    })
    latencyLogger.mark('SDP answer received')

    if (!sdpResponse.ok) {
      throw new Error(`OpenAI rejected the WebRTC SDP offer: ${await getErrorResponseMessage(sdpResponse)}`)
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text(),
    })
    latencyLogger.mark('remote description applied')

    callbacks.onStatusChange('connected')

    return {
      stop: () => {
        callbacks.onStatusChange('stopping')
        closeSession()
        callbacks.onStatusChange('idle')
      },
    }
  } catch (error) {
    closeSession()

    throw error
  }
}
