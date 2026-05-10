import type { Response } from 'supertest'

export function getResponseBody<T>(response: Response): T {
  const body: unknown = response.body

  return body as T
}

export function getSetCookieHeaders(response: Response): string[] {
  const setCookieHeader = response.headers['set-cookie']

  if (!setCookieHeader) {
    return []
  }

  return Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
}
