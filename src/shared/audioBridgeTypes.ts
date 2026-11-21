export const VIRTUAL_AUDIO_NODES = {
  toCallGroup: 'ai_translate_to_call_loopback',
  toCallSinkName: 'ai_translate_to_call_sink',
  toCallSinkLabel: 'AI-Translate-To-Call',
  toCallMicName: 'ai_translate_to_call_mic',
  toCallMicLabel: 'AI-Translate-Virtual-Mic',
  fromCallGroup: 'ai_translate_from_call_loopback',
  fromCallSinkName: 'ai_translate_from_call_sink',
  fromCallSinkLabel: 'AI-Translate-Call-Speaker',
  fromCallCaptureName: 'ai_translate_from_call_capture',
  fromCallCaptureLabel: 'AI-Translate-Call-Capture',
} as const

export type AudioBridgeStatus = {
  supported: boolean
  ready: boolean
  managedByApp: boolean
  missingNodes: string[]
  error?: string
}
