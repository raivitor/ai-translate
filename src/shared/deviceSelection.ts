export type AudioDeviceLike = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>

export type DefaultAudioDeviceSelection = {
  outboundInputId: string
  outboundOutputId: string
  inboundInputId: string
  inboundOutputId: string
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

function findPreferredPhysicalInput(inputDevices: AudioDeviceLike[]): AudioDeviceLike | undefined {
  const physicalInputs = inputDevices.filter(device => !isAiTranslateDevice(device) && !isVirtualCableDevice(device))

  return (
    physicalInputs.find(device => isHyperXCloudIII(device) && !isDigitalAudioDevice(device)) ||
    physicalInputs.find(isHyperXCloudIII) ||
    physicalInputs[0] ||
    inputDevices[0]
  )
}

function findPreferredHeadsetOutput(
  outputDevices: AudioDeviceLike[],
  outboundOutputId: string,
): AudioDeviceLike | undefined {
  const physicalOutputs = outputDevices.filter(
    device => device.deviceId !== outboundOutputId && !isAiTranslateDevice(device),
  )

  return (
    physicalOutputs.find(device => isHyperXCloudIII(device) && isAnalogAudioDevice(device)) ||
    physicalOutputs.find(device => isHyperXCloudIII(device) && !isDigitalAudioDevice(device)) ||
    physicalOutputs.find(isHyperXCloudIII) ||
    physicalOutputs.find(device => isHeadphones(device) && !isDigitalAudioDevice(device)) ||
    physicalOutputs.find(isHeadphones) ||
    physicalOutputs.find(device => !isDigitalAudioDevice(device)) ||
    physicalOutputs[0] ||
    outputDevices[0]
  )
}

export function selectDefaultAudioDevices(
  inputDevices: AudioDeviceLike[],
  outputDevices: AudioDeviceLike[],
): DefaultAudioDeviceSelection {
  const outboundInput = findPreferredPhysicalInput(inputDevices)
  const outboundOutput =
    outputDevices.find(isAiTranslateToMeetOutput) || outputDevices.find(isVirtualCableDevice) || outputDevices[0]
  const outboundOutputId = outboundOutput?.deviceId || ''

  const inboundInput =
    inputDevices.find(isAiTranslateFromMeetInput) || inputDevices.find(isVirtualCableDevice) || inputDevices[0]
  const inboundOutput = findPreferredHeadsetOutput(outputDevices, outboundOutputId)

  return {
    outboundInputId: outboundInput?.deviceId || '',
    outboundOutputId,
    inboundInputId: inboundInput?.deviceId || '',
    inboundOutputId: inboundOutput?.deviceId || '',
  }
}
