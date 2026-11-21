import { VIRTUAL_AUDIO_NODES } from './audioBridgeTypes.js'

export const REQUIRED_HEADSET_NAME = 'HyperX Cloud III'

export type AudioDeviceLike = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>
export type SessionDirection = 'outbound' | 'inbound'
export type DeviceRole = 'input' | 'output'

export type DefaultAudioDeviceSelection = {
  outboundInputId: string
  outboundOutputId: string
  inboundInputId: string
  inboundOutputId: string
}

export type ActiveAudioRoute = {
  inputId: string
  inputLabel: string
  outputId: string
  outputLabel: string
}

export type RouteValidationResult =
  | { ok: true }
  | {
      ok: false
      reason: string
    }

export type MissingActiveDevice = {
  kind: DeviceRole
  label: string
}

function normalizeLabel(device: AudioDeviceLike): string {
  return device.label.toLowerCase().replaceAll(/[\s_]+/g, '-')
}

function hasAny(text: string, terms: readonly string[]): boolean {
  return terms.some(term => text.includes(term))
}

function isAiTranslateDevice(device: AudioDeviceLike): boolean {
  return normalizeLabel(device).includes('ai-translate')
}

function isMonitorDevice(device: AudioDeviceLike): boolean {
  const normalized = normalizeLabel(device)
  return normalized.startsWith('monitor-of-') || normalized.startsWith('monitor-de-') || normalized.endsWith('-monitor')
}

function isAiTranslateToCallOutput(device: AudioDeviceLike): boolean {
  return normalizeLabel(device).includes('ai-translate-to-call')
}

function isAiTranslateFromCallInput(device: AudioDeviceLike): boolean {
  return hasAny(normalizeLabel(device), ['ai-translate-call-capture', 'ai-translate-from-call-capture'])
}

function isDigitalAudioDevice(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['digital', 'iec958', 'spdif', 's/pdif', 'hdmi'])
}

function isAnalogAudioDevice(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['analog', 'analógico', 'analogico'])
}

export function isHyperXCloudIII(device: AudioDeviceLike): boolean {
  if (isAiTranslateDevice(device) || isMonitorDevice(device)) {
    return false
  }

  const normalized = normalizeLabel(device)
  return normalized.includes('hyperx') && hasAny(normalized, ['cloud-iii', 'cloud-3', 'cloudiii'])
}

function isSyntheticDefaultDevice(device: AudioDeviceLike): boolean {
  return device.deviceId === 'default' || device.deviceId === 'communications'
}

function matchesDeviceRole(direction: SessionDirection, role: DeviceRole, device: AudioDeviceLike): boolean {
  if (isSyntheticDefaultDevice(device)) {
    return false
  }

  if (direction === 'outbound' && role === 'output') {
    return isAiTranslateToCallOutput(device)
  }

  if (direction === 'inbound' && role === 'input') {
    return isAiTranslateFromCallInput(device)
  }

  return isHyperXCloudIII(device)
}

export function filterDevicesForRole<T extends AudioDeviceLike>(
  direction: SessionDirection,
  role: DeviceRole,
  devices: readonly T[],
): T[] {
  return devices.filter(device => matchesDeviceRole(direction, role, device))
}

export function selectDefaultAudioDevices(
  inputDevices: readonly AudioDeviceLike[],
  outputDevices: readonly AudioDeviceLike[],
): DefaultAudioDeviceSelection {
  const headsetInputs = filterDevicesForRole('outbound', 'input', inputDevices)
  const headsetOutputs = filterDevicesForRole('inbound', 'output', outputDevices)

  const outboundInput = headsetInputs.find(device => !isDigitalAudioDevice(device)) ?? headsetInputs[0]
  const outboundOutput = filterDevicesForRole('outbound', 'output', outputDevices)[0]
  const inboundInput = filterDevicesForRole('inbound', 'input', inputDevices)[0]
  const inboundOutput =
    headsetOutputs.find(device => isAnalogAudioDevice(device) && !isDigitalAudioDevice(device)) ??
    headsetOutputs.find(device => !isDigitalAudioDevice(device)) ??
    headsetOutputs[0]

  return {
    outboundInputId: outboundInput?.deviceId || '',
    outboundOutputId: outboundOutput?.deviceId || '',
    inboundInputId: inboundInput?.deviceId || '',
    inboundOutputId: inboundOutput?.deviceId || '',
  }
}

export function validateDeviceForRole(
  direction: SessionDirection,
  role: DeviceRole,
  deviceId: string,
  devices: readonly AudioDeviceLike[],
): RouteValidationResult {
  const device = deviceId ? devices.find(item => item.deviceId === deviceId) : undefined

  if (device && matchesDeviceRole(direction, role, device)) {
    return { ok: true }
  }

  if (direction === 'outbound' && role === 'output') {
    return {
      ok: false,
      reason: `Dispositivo virtual ${VIRTUAL_AUDIO_NODES.toCallSinkLabel} ausente. Recrie o áudio virtual para enviar áudio à chamada.`,
    }
  }

  if (direction === 'inbound' && role === 'input') {
    return {
      ok: false,
      reason: `Dispositivo virtual ${VIRTUAL_AUDIO_NODES.fromCallCaptureLabel} ausente. Recrie o áudio virtual para ouvir a chamada.`,
    }
  }

  return {
    ok: false,
    reason:
      role === 'input'
        ? `Microfone "${REQUIRED_HEADSET_NAME}" não encontrado. Conecte o headset ${REQUIRED_HEADSET_NAME} para iniciar.`
        : `Saída de áudio "${REQUIRED_HEADSET_NAME}" não encontrada. Conecte o headset ${REQUIRED_HEADSET_NAME} para iniciar.`,
  }
}

export function validateSessionRoute(
  direction: SessionDirection,
  inputDeviceId: string,
  outputDeviceId: string,
  inputDevices: readonly AudioDeviceLike[],
  outputDevices: readonly AudioDeviceLike[],
): RouteValidationResult {
  const inputValidation = validateDeviceForRole(direction, 'input', inputDeviceId, inputDevices)
  if (!inputValidation.ok) {
    return inputValidation
  }

  return validateDeviceForRole(direction, 'output', outputDeviceId, outputDevices)
}

export function findMissingActiveDevice(
  activeRoute: ActiveAudioRoute,
  inputDevices: readonly AudioDeviceLike[],
  outputDevices: readonly AudioDeviceLike[],
): MissingActiveDevice | null {
  if (!inputDevices.some(device => device.deviceId === activeRoute.inputId)) {
    return { kind: 'input', label: activeRoute.inputLabel || 'dispositivo de entrada' }
  }

  if (!outputDevices.some(device => device.deviceId === activeRoute.outputId)) {
    return { kind: 'output', label: activeRoute.outputLabel || 'dispositivo de saída' }
  }

  return null
}
