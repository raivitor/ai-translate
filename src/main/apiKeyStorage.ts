import fs from 'node:fs'
import path from 'node:path'

export type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export type ApiKeyStoreDeps = {
  getUserDataDir: () => string
  safeStorage: SafeStorageLike
}

export type ApiKeyStore = {
  saveApiKey: (key: string) => void
  loadApiKey: () => string | null
  clearApiKey: () => void
  hasApiKey: () => boolean
}

export function createApiKeyStore({ getUserDataDir, safeStorage }: ApiKeyStoreDeps): ApiKeyStore {
  const getKeyFilePath = (): string => path.join(getUserDataDir(), 'api-key.enc')

  return {
    saveApiKey: (key: string): void => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage encryption is not available on this system.')
      }

      const encrypted = safeStorage.encryptString(key)
      fs.writeFileSync(getKeyFilePath(), encrypted)
    },

    loadApiKey: (): string | null => {
      const filePath = getKeyFilePath()

      if (!fs.existsSync(filePath)) {
        return null
      }

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage encryption is not available on this system.')
      }

      const encrypted = fs.readFileSync(filePath)
      return safeStorage.decryptString(encrypted)
    },

    clearApiKey: (): void => {
      const filePath = getKeyFilePath()

      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath)
      }
    },

    hasApiKey: (): boolean => fs.existsSync(getKeyFilePath()),
  }
}
