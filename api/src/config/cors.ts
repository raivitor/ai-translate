import type { CorsOptions } from 'cors'

type EnvironmentLike = Record<string, string | undefined>

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000']
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

function normalizeOrigin(rawOrigin: string): string | undefined {
  const trimmedOrigin = rawOrigin.trim()

  if (!trimmedOrigin) {
    return undefined
  }

  try {
    const parsedOrigin = new URL(trimmedOrigin)

    if (!HTTP_PROTOCOLS.has(parsedOrigin.protocol)) {
      return undefined
    }

    return parsedOrigin.origin
  } catch {
    return trimmedOrigin.replace(/\/+$/, '')
  }
}

function parseOriginsFromEnvironment(rawOrigins: string | undefined): string[] {
  const parsedOrigins: string[] = []

  for (const origin of (rawOrigins ?? '').split(',')) {
    const normalizedOrigin = normalizeOrigin(origin)

    if (normalizedOrigin) {
      parsedOrigins.push(normalizedOrigin)
    }
  }

  return parsedOrigins
}

export function resolveAllowedOrigins(env: EnvironmentLike = process.env): Set<string> {
  const originsFromList = parseOriginsFromEnvironment(env.FRONTEND_URLS)

  if (originsFromList.length > 0) {
    return new Set(originsFromList)
  }

  const singleOrigin = normalizeOrigin(env.FRONTEND_URL ?? '')

  if (singleOrigin) {
    return new Set([singleOrigin])
  }

  return new Set(DEFAULT_ALLOWED_ORIGINS)
}

export function createCorsOptions(env: EnvironmentLike = process.env): CorsOptions {
  const allowedOrigins = resolveAllowedOrigins(env)

  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }

      const normalizedOrigin = normalizeOrigin(origin)

      if (!normalizedOrigin) {
        callback(null, false)
        return
      }

      callback(null, allowedOrigins.has(normalizedOrigin))
    },
  }
}
