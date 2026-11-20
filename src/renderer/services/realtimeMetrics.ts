export type ConnectionStats = {
  rttMs: number | null
  packetsLost: number
  jitterMs: number | null
}

export type AudioLevels = {
  input: number
  output: number
}

export const MAX_RECONNECT_ATTEMPTS = 3
export const SESSION_ROLLOVER_MS = 55 * 60 * 1000
export const DISCONNECT_GRACE_MS = 4000

const BASE_RECONNECT_DELAY_MS = 1000

export function getReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt)
  return BASE_RECONNECT_DELAY_MS * 2 ** (safeAttempt - 1)
}

export function computeAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }

  let sumSquares = 0
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0
    sumSquares += sample * sample
  }

  const rms = Math.sqrt(sumSquares / samples.length)
  // Scale typical speech RMS (~0.02..0.25) into a responsive 0..1 meter range.
  return Math.min(1, Math.max(0, rms * 4))
}

export function extractConnectionStats(entries: Iterable<Record<string, unknown>>): ConnectionStats {
  let rttMs: number | null = null
  let packetsLost = 0
  let jitterMs: number | null = null

  for (const report of entries) {
    if (report.type === 'candidate-pair') {
      const isActivePair = report.state === 'succeeded' && (report.nominated === true || report.selected === true)
      if (
        isActivePair &&
        typeof report.currentRoundTripTime === 'number' &&
        Number.isFinite(report.currentRoundTripTime)
      ) {
        rttMs = Math.round(report.currentRoundTripTime * 1000)
      }
    }

    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
      if (typeof report.packetsLost === 'number' && Number.isFinite(report.packetsLost)) {
        packetsLost = Math.max(0, Math.round(report.packetsLost))
      }

      if (typeof report.jitter === 'number' && Number.isFinite(report.jitter)) {
        jitterMs = Math.round(report.jitter * 1000)
      }
    }
  }

  return { rttMs, packetsLost, jitterMs }
}
