import { app, safeStorage } from 'electron'

import { createApiKeyStore } from './apiKeyStorage.js'

const defaultStore = createApiKeyStore({
  getUserDataDir: () => app.getPath('userData'),
  safeStorage,
})

export const saveApiKey = defaultStore.saveApiKey
export const loadApiKey = defaultStore.loadApiKey
export const clearApiKey = defaultStore.clearApiKey
export const hasApiKey = defaultStore.hasApiKey
