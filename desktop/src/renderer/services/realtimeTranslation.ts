export type TranslationStatus =
  | 'idle'
  | 'requesting-media'
  | 'connecting'
  | 'connected'
  | 'stopping'
  | 'error'

export type TranslationTranscriptEvent = {
  kind: 'source' | 'target'
  text: string
}

export type TranslationSessionCallbacks = {
  onStatusChange: (status: TranslationStatus) => void
  onTranscript: (event: TranslationTranscriptEvent) => void
}

export type StartTranslationSessionOptions = {
  apiBaseUrl: string
  inputDeviceId: string
  outputDeviceId: string
  targetLanguage: string
  callbacks: TranslationSessionCallbacks
}

type TranslationClientSecretResponse = {
  value?: unknown
}

type RealtimeServerEvent = {
  type?: unknown
  delta?: unknown
}

type AudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

export type ActiveTranslationSession = {
  stop: () => void
}

async function createTranslationClientSecret(
  apiBaseUrl: string,
  targetLanguage: string,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/api/realtime/translations/client-secret`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetLanguage }),
  })

  const body = (await response.json().catch(() => ({}))) as TranslationClientSecretResponse

  if (!response.ok) {
    throw new Error('Could not create a Realtime translation client secret.')
  }

  if (typeof body.value !== 'string') {
    throw new Error('The local API returned an invalid translation client secret.')
  }

  return body.value
}

function parseRealtimeEvent(rawData: string): RealtimeServerEvent | undefined {
  try {
    return JSON.parse(rawData) as RealtimeServerEvent
  } catch {
    return undefined
  }
}

function addDataChannelListeners(
  dataChannel: RTCDataChannel,
  callbacks: TranslationSessionCallbacks,
): void {
  dataChannel.addEventListener('message', event => {
    if (typeof event.data !== 'string') {
      return
    }

    const realtimeEvent = parseRealtimeEvent(event.data)

    if (!realtimeEvent || typeof realtimeEvent.delta !== 'string') {
      return
    }

    if (realtimeEvent.type === 'session.input_transcript.delta') {
      callbacks.onTranscript({ kind: 'source', text: realtimeEvent.delta })
    }

    if (realtimeEvent.type === 'session.output_transcript.delta') {
      callbacks.onTranscript({ kind: 'target', text: realtimeEvent.delta })
    }
  })
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
  apiBaseUrl,
  inputDeviceId,
  outputDeviceId,
  targetLanguage,
  callbacks,
}: StartTranslationSessionOptions): Promise<ActiveTranslationSession> {
  callbacks.onStatusChange('requesting-media')

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }

  if (inputDeviceId) {
    audioConstraints.deviceId = { exact: inputDeviceId }
  }

  const inputStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  })

  callbacks.onStatusChange('connecting')

  let peerConnection: RTCPeerConnection | undefined
  let dataChannel: RTCDataChannel | undefined
  const audioElement: AudioElementWithSink = document.createElement('audio')

  try {
    const clientSecret = await createTranslationClientSecret(apiBaseUrl, targetLanguage)
    peerConnection = new RTCPeerConnection()

    audioElement.autoplay = true
    audioElement.controls = false
    audioElement.style.display = 'none'

    if (outputDeviceId) {
      if (!audioElement.setSinkId) {
        throw new Error('This runtime does not support selecting an audio output device.')
      }

      await audioElement.setSinkId(outputDeviceId)
    }

    document.body.append(audioElement)

    const [inputTrack] = inputStream.getAudioTracks()

    if (!inputTrack) {
      throw new Error('No microphone audio track was captured.')
    }

    peerConnection.addTrack(inputTrack, inputStream)

    dataChannel = peerConnection.createDataChannel('oai-events')
    addDataChannelListeners(dataChannel, callbacks)

    peerConnection.addEventListener('track', event => {
      const [remoteStream] = event.streams

      if (!remoteStream) {
        return
      }

      audioElement.srcObject = remoteStream
      void audioElement.play().catch(() => {
        callbacks.onStatusChange('error')
      })
    })

    const offer = await peerConnection.createOffer()
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

    if (!sdpResponse.ok) {
      throw new Error('OpenAI rejected the WebRTC SDP offer.')
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text(),
    })

    callbacks.onStatusChange('connected')

    return {
      stop: () => {
        callbacks.onStatusChange('stopping')
        closeDataChannel(dataChannel as RTCDataChannel)
        peerConnection?.close()
        stopStream(inputStream)
        audioElement.srcObject = null
        audioElement.remove()
        callbacks.onStatusChange('idle')
      },
    }
  } catch (error) {
    if (dataChannel) {
      closeDataChannel(dataChannel)
    }

    peerConnection?.close()
    audioElement.srcObject = null
    audioElement.remove()
    stopStream(inputStream)

    throw error
  }
}
