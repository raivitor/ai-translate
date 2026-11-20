export const NOISE_REDUCTION_OPTIONS = [
  { value: 'off', label: 'Desativada' },
  { value: 'near_field', label: 'Microfone próximo (near_field)' },
  { value: 'far_field', label: 'Ambiente / distante (far_field)' },
] as const

export type NoiseReductionMode = (typeof NOISE_REDUCTION_OPTIONS)[number]['value']

export const SUPPORTED_NOISE_REDUCTION_MODES = new Set<string>(NOISE_REDUCTION_OPTIONS.map(option => option.value))

export function resolveNoiseReductionMode(rawMode: unknown): NoiseReductionMode | undefined {
  if (typeof rawMode !== 'string') {
    return undefined
  }

  const normalized = rawMode.trim().toLowerCase()

  return SUPPORTED_NOISE_REDUCTION_MODES.has(normalized) ? (normalized as NoiseReductionMode) : undefined
}
