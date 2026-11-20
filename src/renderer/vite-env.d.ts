/// <reference types="vite/client" />

import type { AudioBridgeStatus } from '../shared/audioBridgeTypes.js'
import type { NoiseReductionMode } from '../shared/realtimeAudioConfig.js'

declare global {
  interface Window {
    aiTranslate?: {
      platform: NodeJS.Platform
      setApiKey: (key: string) => Promise<void>
      hasApiKey: () => Promise<boolean>
      clearApiKey: () => Promise<void>
      createClientSecret: (params: {
        targetLanguage: string
        noiseReduction?: NoiseReductionMode | undefined
      }) => Promise<{ value: string; expiresAt: number }>
      getAudioBridgeStatus: () => Promise<AudioBridgeStatus>
      restartAudioBridge: () => Promise<AudioBridgeStatus>
      onToggleOutboundMute: (callback: () => void) => () => void
    }
  }
}
