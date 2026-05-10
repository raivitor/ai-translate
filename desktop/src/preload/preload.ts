import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('aiTranslate', {
  platform: process.platform,
})
