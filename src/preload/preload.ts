import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiTranslate', {
  platform: process.platform,
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('aiTranslate:setApiKey', key),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('aiTranslate:hasApiKey'),
  clearApiKey: (): Promise<void> => ipcRenderer.invoke('aiTranslate:clearApiKey'),
  createClientSecret: (params: {
    targetLanguage: string
    enableTranscription?: boolean
    transcriptionLanguage?: string
  }): Promise<{ value: string; expiresAt: number }> => ipcRenderer.invoke('aiTranslate:createClientSecret', params),
})
