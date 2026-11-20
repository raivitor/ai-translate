import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveNoiseReductionMode, type NoiseReductionMode } from '../shared/realtimeAudioConfig.js'
import { resolveTranslationLanguageCode, type TranslationLanguageCode } from '../shared/translationLanguages.js'

export const MAX_API_KEY_LENGTH = 512

export type RendererSecurityConfig = {
  isDevelopment: boolean
  rendererDevUrl: string
  rendererIndexPath: string
}

export type ValidatedClientSecretParams = {
  targetLanguage: TranslationLanguageCode
  noiseReduction?: NoiseReductionMode
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAllowedRendererUrl(rawUrl: string, config: RendererSecurityConfig): boolean {
  if (!rawUrl) {
    return false
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return false
  }

  if (config.isDevelopment) {
    try {
      return parsedUrl.origin === new URL(config.rendererDevUrl).origin
    } catch {
      return false
    }
  }

  const expectedFileUrl = pathToFileURL(path.resolve(config.rendererIndexPath))

  return parsedUrl.protocol === 'file:' && parsedUrl.pathname === expectedFileUrl.pathname
}

export function isAllowedPermissionOrigin(
  rawUrl: string,
  requestingOrigin: string | undefined,
  config: RendererSecurityConfig,
): boolean {
  if (!isAllowedRendererUrl(rawUrl, config)) {
    return false
  }

  if (!requestingOrigin) {
    return true
  }

  if (config.isDevelopment) {
    try {
      return new URL(requestingOrigin).origin === new URL(config.rendererDevUrl).origin
    } catch {
      return false
    }
  }

  return requestingOrigin === 'file://' || requestingOrigin === 'null' || isAllowedRendererUrl(requestingOrigin, config)
}

export function validateApiKeyInput(rawKey: unknown): string {
  if (typeof rawKey !== 'string') {
    throw new Error('API key must be a string.')
  }

  const trimmed = rawKey.trim()

  if (!trimmed) {
    throw new Error('API key cannot be empty.')
  }

  if (trimmed.length > MAX_API_KEY_LENGTH) {
    throw new Error('API key exceeds the maximum allowed length.')
  }

  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error('API key contains invalid characters.')
  }

  return trimmed
}

export function validateCreateClientSecretParams(rawParams: unknown): ValidatedClientSecretParams {
  if (!isPlainObject(rawParams)) {
    throw new Error('Client secret parameters must be an object.')
  }

  const resolvedLanguage =
    typeof rawParams.targetLanguage === 'string' ? resolveTranslationLanguageCode(rawParams.targetLanguage) : undefined

  if (!resolvedLanguage) {
    throw new Error('targetLanguage must be a supported language code.')
  }

  if (rawParams.noiseReduction !== undefined) {
    const resolvedNoiseReduction = resolveNoiseReductionMode(rawParams.noiseReduction)

    if (!resolvedNoiseReduction) {
      throw new Error('noiseReduction must be one of: off, near_field, far_field.')
    }

    return {
      targetLanguage: resolvedLanguage,
      noiseReduction: resolvedNoiseReduction,
    }
  }

  return {
    targetLanguage: resolvedLanguage,
  }
}
