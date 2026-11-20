import { contextBridge, ipcRenderer } from 'electron'

import type { NoiseReductionMode } from '../shared/realtimeAudioConfig.js'

contextBridge.exposeInMainWorld('aiTranslate', {
  platform: process.platform,
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('aiTranslate:setApiKey', key),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('aiTranslate:hasApiKey'),
  clearApiKey: (): Promise<void> => ipcRenderer.invoke('aiTranslate:clearApiKey'),
  createClientSecret: (params: {
    targetLanguage: string
    noiseReduction?: NoiseReductionMode
  }): Promise<{ value: string; expiresAt: number }> => ipcRenderer.invoke('aiTranslate:createClientSecret', params),
})
