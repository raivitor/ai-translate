import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  isAllowedPermissionOrigin,
  isAllowedRendererUrl,
  MAX_API_KEY_LENGTH,
  validateApiKeyInput,
  validateCreateClientSecretParams,
  type RendererSecurityConfig,
} from './security.js'

const devConfig: RendererSecurityConfig = {
  isDevelopment: true,
  rendererDevUrl: 'http://127.0.0.1:5173',
  rendererIndexPath: '/app/dist/renderer/index.html',
}

const prodIndexPath = path.resolve('/app/dist/renderer/index.html')
const prodConfig: RendererSecurityConfig = {
  isDevelopment: false,
  rendererDevUrl: 'http://127.0.0.1:5173',
  rendererIndexPath: prodIndexPath,
}

test('isAllowedRendererUrl allows exact dev origin and rejects external origins', () => {
  assert.strictEqual(isAllowedRendererUrl('http://127.0.0.1:5173/', devConfig), true)
  assert.strictEqual(isAllowedRendererUrl('http://127.0.0.1:5173/index.html?foo=1', devConfig), true)
  assert.strictEqual(isAllowedRendererUrl('http://127.0.0.1:5174/', devConfig), false)
  assert.strictEqual(isAllowedRendererUrl('http://127.0.0.1:5173.evil.com/', devConfig), false)
  assert.strictEqual(isAllowedRendererUrl('https://example.com/', devConfig), false)
  assert.strictEqual(isAllowedRendererUrl('', devConfig), false)
})

test('isAllowedRendererUrl allows exact production index.html file URL and rejects other files', () => {
  const indexUrl = pathToFileURL(prodIndexPath).href
  const otherFileUrl = pathToFileURL(path.resolve('/etc/passwd')).href

  assert.strictEqual(isAllowedRendererUrl(indexUrl, prodConfig), true)
  assert.strictEqual(isAllowedRendererUrl(`${indexUrl}#settings`, prodConfig), true)
  assert.strictEqual(isAllowedRendererUrl(otherFileUrl, prodConfig), false)
  assert.strictEqual(isAllowedRendererUrl('http://127.0.0.1:5173/', prodConfig), false)
})

test('isAllowedPermissionOrigin validates both page URL and requesting origin', () => {
  const indexUrl = pathToFileURL(prodIndexPath).href

  assert.strictEqual(isAllowedPermissionOrigin('http://127.0.0.1:5173/', 'http://127.0.0.1:5173', devConfig), true)
  assert.strictEqual(isAllowedPermissionOrigin('http://127.0.0.1:5173/', 'https://evil.com', devConfig), false)
  assert.strictEqual(isAllowedPermissionOrigin('https://evil.com/', 'http://127.0.0.1:5173', devConfig), false)

  assert.strictEqual(isAllowedPermissionOrigin(indexUrl, 'file://', prodConfig), true)
  assert.strictEqual(isAllowedPermissionOrigin(indexUrl, 'null', prodConfig), true)
  assert.strictEqual(isAllowedPermissionOrigin(indexUrl, indexUrl, prodConfig), true)
  assert.strictEqual(isAllowedPermissionOrigin(indexUrl, 'https://evil.com', prodConfig), false)
})

test('validateApiKeyInput trims valid keys and rejects invalid inputs', () => {
  assert.strictEqual(validateApiKeyInput('  sk-test-123  '), 'sk-test-123')

  assert.throws(() => validateApiKeyInput(null), /string/i)
  assert.throws(() => validateApiKeyInput(12345), /string/i)
  assert.throws(() => validateApiKeyInput('   '), /empty/i)
  assert.throws(() => validateApiKeyInput('a'.repeat(MAX_API_KEY_LENGTH + 1)), /length/i)
  assert.throws(() => validateApiKeyInput('sk-test\nheader: bad'), /invalid characters/i)
})

test('validateCreateClientSecretParams accepts valid payloads and rejects invalid ones', () => {
  assert.deepStrictEqual(validateCreateClientSecretParams({ targetLanguage: 'en' }), {
    targetLanguage: 'en',
  })

  assert.deepStrictEqual(validateCreateClientSecretParams({ targetLanguage: 'pt-BR', noiseReduction: 'near_field' }), {
    targetLanguage: 'pt',
    noiseReduction: 'near_field',
  })

  assert.throws(() => validateCreateClientSecretParams(null), /object/i)
  assert.throws(() => validateCreateClientSecretParams([]), /object/i)
  assert.throws(() => validateCreateClientSecretParams({ targetLanguage: 'ar' }), /targetLanguage/i)
  assert.throws(() => validateCreateClientSecretParams({ targetLanguage: 'es' }), /targetLanguage/i)
  assert.throws(() => validateCreateClientSecretParams({ targetLanguage: 'pt-PT' }), /targetLanguage/i)
  assert.throws(
    () => validateCreateClientSecretParams({ targetLanguage: 'en', noiseReduction: 'ultra' }),
    /noiseReduction/i,
  )
})
