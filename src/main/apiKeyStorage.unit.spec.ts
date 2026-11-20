import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { createApiKeyStore, type SafeStorageLike } from './apiKeyStorage.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translate-key-test-'))
  tempDirs.push(dir)
  return dir
}

function makeFakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: plainText => Buffer.from(`enc:${plainText}`, 'utf8'),
    decryptString: encrypted => {
      const raw = encrypted.toString('utf8')
      return raw.startsWith('enc:') ? raw.slice(4) : raw
    },
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('createApiKeyStore encrypts, persists, loads, and clears the API key', () => {
  const dir = makeTempDir()
  const store = createApiKeyStore({
    getUserDataDir: () => dir,
    safeStorage: makeFakeSafeStorage(true),
  })

  assert.strictEqual(store.hasApiKey(), false)
  assert.strictEqual(store.loadApiKey(), null)

  store.saveApiKey('sk-secret-123')
  assert.strictEqual(store.hasApiKey(), true)
  assert.strictEqual(store.loadApiKey(), 'sk-secret-123')

  const rawBytes = fs.readFileSync(path.join(dir, 'api-key.enc'), 'utf8')
  assert.strictEqual(rawBytes, 'enc:sk-secret-123')

  store.clearApiKey()
  assert.strictEqual(store.hasApiKey(), false)
  assert.strictEqual(store.loadApiKey(), null)
})

test('createApiKeyStore throws when safeStorage encryption is unavailable', () => {
  const dir = makeTempDir()
  const enabledStore = createApiKeyStore({
    getUserDataDir: () => dir,
    safeStorage: makeFakeSafeStorage(true),
  })
  const disabledStore = createApiKeyStore({
    getUserDataDir: () => dir,
    safeStorage: makeFakeSafeStorage(false),
  })

  assert.throws(() => disabledStore.saveApiKey('sk-secret'), /safeStorage encryption is not available/i)

  enabledStore.saveApiKey('sk-secret')
  assert.throws(() => disabledStore.loadApiKey(), /safeStorage encryption is not available/i)
})
