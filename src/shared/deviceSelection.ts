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

function isVirtualCableDevice(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['cable', 'voicemeeter', 'vb-audio'])
}

function isAiTranslateDevice(device: AudioDeviceLike): boolean {
  return normalizeLabel(device).includes('ai-translate')
}

function isVirtualDevice(device: AudioDeviceLike): boolean {
  return isAiTranslateDevice(device) || isVirtualCableDevice(device)
}

function isAiTranslateToMeetOutput(device: AudioDeviceLike): boolean {
  return normalizeLabel(device).includes('ai-translate-to-meet')
}

function isAiTranslateFromMeetInput(device: AudioDeviceLike): boolean {
  return hasAny(normalizeLabel(device), ['ai-translate-meet-audio-capture', 'ai-translate-from-meet-capture'])
}

function isDigitalAudioDevice(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['digital', 'iec958', 'spdif', 's/pdif', 'hdmi'])
}

function isAnalogAudioDevice(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['analog', 'analógico', 'analogico'])
}

function isHyperXCloudIII(device: AudioDeviceLike): boolean {
  const lower = device.label.toLowerCase()
  return lower.includes('hyperx') && hasAny(lower, ['cloud iii', 'cloud 3', 'cloud-iii'])
}

function isHeadphones(device: AudioDeviceLike): boolean {
  return hasAny(device.label.toLowerCase(), ['headphone', 'fones', 'earbud', 'headset'])
}

export function filterDevicesForRole<T extends AudioDeviceLike>(
  direction: SessionDirection,
  role: DeviceRole,
  devices: readonly T[],
): T[] {
  if (direction === 'outbound' && role === 'output') {
    return devices.filter(isAiTranslateToMeetOutput)
  }

  if (direction === 'inbound' && role === 'input') {
    return devices.filter(isAiTranslateFromMeetInput)
  }

  return devices.filter(device => !isVirtualDevice(device))
}

function findPreferredPhysicalInput(inputDevices: readonly AudioDeviceLike[]): AudioDeviceLike | undefined {
  const physicalInputs = filterDevicesForRole('outbound', 'input', inputDevices)

  return (
    physicalInputs.find(device => isHyperXCloudIII(device) && !isDigitalAudioDevice(device)) ||
    physicalInputs.find(isHyperXCloudIII) ||
    physicalInputs[0]
  )
}

function findPreferredHeadsetOutput(outputDevices: readonly AudioDeviceLike[]): AudioDeviceLike | undefined {
  const physicalOutputs = filterDevicesForRole('inbound', 'output', outputDevices)

  return (
    physicalOutputs.find(device => isHyperXCloudIII(device) && isAnalogAudioDevice(device)) ||
    physicalOutputs.find(device => isHyperXCloudIII(device) && !isDigitalAudioDevice(device)) ||
    physicalOutputs.find(isHyperXCloudIII) ||
    physicalOutputs.find(device => isHeadphones(device) && !isDigitalAudioDevice(device)) ||
    physicalOutputs.find(isHeadphones) ||
    physicalOutputs.find(device => !isDigitalAudioDevice(device)) ||
    physicalOutputs[0]
  )
}

export function selectDefaultAudioDevices(
  inputDevices: readonly AudioDeviceLike[],
  outputDevices: readonly AudioDeviceLike[],
): DefaultAudioDeviceSelection {
  const outboundInput = findPreferredPhysicalInput(inputDevices)
  const outboundOutput = filterDevicesForRole('outbound', 'output', outputDevices)[0]
  const inboundInput = filterDevicesForRole('inbound', 'input', inputDevices)[0]
  const inboundOutput = findPreferredHeadsetOutput(outputDevices)

  return {
    outboundInputId: outboundInput?.deviceId || '',
    outboundOutputId: outboundOutput?.deviceId || '',
    inboundInputId: inboundInput?.deviceId || '',
    inboundOutputId: inboundOutput?.deviceId || '',
  }
}

export function resolveSavedDeviceId(
  devices: readonly AudioDeviceLike[],
  savedDeviceId: string,
  savedDeviceLabel: string,
  fallbackDeviceId: string,
): string {
  if (savedDeviceId && devices.some(device => device.deviceId === savedDeviceId)) {
    return savedDeviceId
  }

  if (savedDeviceLabel) {
    const matchedByLabel = devices.find(device => device.label === savedDeviceLabel)

    if (matchedByLabel) {
      return matchedByLabel.deviceId
    }
  }

  if (fallbackDeviceId && devices.some(device => device.deviceId === fallbackDeviceId)) {
    return fallbackDeviceId
  }

  return devices[0]?.deviceId || ''
}

export function validateDeviceForRole(
  direction: SessionDirection,
  role: DeviceRole,
  deviceId: string,
  devices: readonly AudioDeviceLike[],
): RouteValidationResult {
  const device = devices.find(item => item.deviceId === deviceId)

  if (direction === 'outbound' && role === 'output') {
    if (!device || !isAiTranslateToMeetOutput(device)) {
      return {
        ok: false,
        reason: 'Dispositivo virtual AI-Translate-To-Meet ausente. Recrie o áudio virtual para enviar ao Meet.',
      }
    }
    return { ok: true }
  }

  if (direction === 'inbound' && role === 'input') {
    if (!device || !isAiTranslateFromMeetInput(device)) {
      return {
        ok: false,
        reason:
          'Dispositivo virtual AI-Translate-Meet-Audio-Capture ausente. Recrie o áudio virtual para ouvir o Meet.',
      }
    }
    return { ok: true }
  }

  if (!device) {
    return {
      ok: false,
      reason:
        role === 'input'
          ? 'Microfone físico indisponível. Conecte um microfone para iniciar.'
          : 'Saída de áudio física indisponível. Conecte seus fones para iniciar.',
    }
  }

  if (isVirtualDevice(device)) {
    return {
      ok: false,
      reason:
        role === 'input'
          ? 'A entrada do Outbound precisa ser um microfone físico, não um nó virtual.'
          : 'A saída do Inbound precisa ser um fone ou alto-falante físico, não um nó virtual.',
    }
  }

  return { ok: true }
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
