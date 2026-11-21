import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VIRTUAL_AUDIO_NODES } from './audioBridgeTypes.js'
import {
  filterDevicesForRole,
  findMissingActiveDevice,
  isHyperXCloudIII,
  REQUIRED_HEADSET_NAME,
  selectDefaultAudioDevices,
  validateDeviceForRole,
  validateSessionRoute,
  type AudioDeviceLike,
} from './deviceSelection.js'

test('isHyperXCloudIII matches HyperX Cloud III variants and rejects other headsets or monitors', () => {
  assert.strictEqual(isHyperXCloudIII({ deviceId: '1', kind: 'audioinput', label: 'HyperX Cloud III Mono' }), true)
  assert.strictEqual(
    isHyperXCloudIII({ deviceId: '2', kind: 'audiooutput', label: 'HyperX Cloud III Estéreo analógico' }),
    true,
  )
  assert.strictEqual(isHyperXCloudIII({ deviceId: '3', kind: 'audiooutput', label: 'HyperX Cloud 3' }), true)
  assert.strictEqual(isHyperXCloudIII({ deviceId: '4', kind: 'audiooutput', label: 'HyperX Cloud II Stereo' }), false)
  assert.strictEqual(
    isHyperXCloudIII({ deviceId: '5', kind: 'audioinput', label: 'Monitor of HyperX Cloud III Estéreo analógico' }),
    false,
  )
  assert.strictEqual(
    isHyperXCloudIII({ deviceId: '6', kind: 'audioinput', label: 'Monitor de HyperX Cloud III Estéreo analógico' }),
    false,
  )
  assert.strictEqual(
    isHyperXCloudIII({ deviceId: '7', kind: 'audioinput', label: 'Intelbras FHD WCI1080P Estéreo analógico' }),
    false,
  )
})

test('selectDefaultAudioDevices selects HyperX Cloud III Analog output and mic alongside AI-Translate call nodes', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Audio Analog Stereo' },
    { deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel },
    { deviceId: 'mic-to-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.toCallMicLabel },
  ]

  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-hdmi', kind: 'audiooutput', label: 'HDA NVidia Digital Stereo (HDMI)' },
    { deviceId: 'out-hyperx-digital', kind: 'audiooutput', label: 'HyperX Cloud III Digital Stereo (IEC958)' },
    { deviceId: 'out-hyperx-analog', kind: 'audiooutput', label: 'HyperX Cloud III Estéreo analógico' },
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
    { deviceId: 'out-from-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.fromCallSinkLabel },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-hyperx')
  assert.strictEqual(selection.outboundOutputId, 'out-to-call')
  assert.strictEqual(selection.inboundInputId, 'mic-from-call')
  assert.strictEqual(selection.inboundOutputId, 'out-hyperx-analog')
})

test('selectDefaultAudioDevices ignores Chromium default aliases and binds to concrete HyperX Cloud III and virtual IDs', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'default', kind: 'audioinput', label: 'Padrão - HyperX Cloud III Mono' },
    { deviceId: 'communications', kind: 'audioinput', label: 'Communications - HyperX Cloud III Mono' },
    { deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'default', kind: 'audiooutput', label: 'Padrão - HyperX Cloud III Estéreo analógico' },
    { deviceId: 'out-hyperx-analog', kind: 'audiooutput', label: 'HyperX Cloud III Estéreo analógico' },
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-hyperx')
  assert.strictEqual(selection.outboundOutputId, 'out-to-call')
  assert.strictEqual(selection.inboundInputId, 'mic-from-call')
  assert.strictEqual(selection.inboundOutputId, 'out-hyperx-analog')
  assert.strictEqual(validateDeviceForRole('outbound', 'input', 'default', inputs).ok, false)
  assert.strictEqual(validateDeviceForRole('inbound', 'output', 'default', outputs).ok, false)
})

test('selectDefaultAudioDevices never falls back to other physical hardware when HyperX Cloud III is disconnected', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-webcam', kind: 'audioinput', label: 'Intelbras FHD WCI1080P Estéreo analógico' },
    { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Audio Estéreo analógico' },
    { deviceId: 'mic-from-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-speakers', kind: 'audiooutput', label: 'Built-in Speakers' },
    { deviceId: 'out-other-headset', kind: 'audiooutput', label: 'HyperX Cloud II Headphones' },
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, '')
  assert.strictEqual(selection.outboundOutputId, 'out-to-call')
  assert.strictEqual(selection.inboundInputId, 'mic-from-call')
  assert.strictEqual(selection.inboundOutputId, '')
})

test('selectDefaultAudioDevices never falls back to speakers or physical mic when virtual call nodes are missing', () => {
  const inputs: AudioDeviceLike[] = [{ deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III Mono' }]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-hyperx', kind: 'audiooutput', label: 'HyperX Cloud III Estéreo analógico' },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-hyperx')
  assert.strictEqual(selection.outboundOutputId, '')
  assert.strictEqual(selection.inboundInputId, '')
  assert.strictEqual(selection.inboundOutputId, 'out-hyperx')
})

test('filterDevicesForRole isolates HyperX Cloud III and virtual call endpoints', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Audio' },
    { deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-hdmi', kind: 'audiooutput', label: 'HDA NVidia HDMI' },
    { deviceId: 'out-1', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
  ]

  assert.deepStrictEqual(
    filterDevicesForRole('outbound', 'input', inputs).map(d => d.deviceId),
    ['mic-1'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('outbound', 'output', outputs).map(d => d.deviceId),
    ['out-to-call'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('inbound', 'input', inputs).map(d => d.deviceId),
    ['mic-from-call'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('inbound', 'output', outputs).map(d => d.deviceId),
    ['out-1'],
  )
})

test('validateSessionRoute rejects missing, non-HyperX, or wrong-direction devices', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Audio' },
    { deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-call', kind: 'audioinput', label: VIRTUAL_AUDIO_NODES.fromCallCaptureLabel },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-speakers', kind: 'audiooutput', label: 'Built-in Speakers' },
    { deviceId: 'out-1', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
  ]

  assert.deepStrictEqual(validateSessionRoute('outbound', 'mic-1', 'out-to-call', inputs, outputs), { ok: true })
  assert.deepStrictEqual(validateSessionRoute('inbound', 'mic-from-call', 'out-1', inputs, outputs), { ok: true })

  // Outbound using a non-HyperX microphone
  const nonHyperXMic = validateSessionRoute('outbound', 'mic-builtin', 'out-to-call', inputs, outputs)
  assert.strictEqual(nonHyperXMic.ok, false)
  assert.match(nonHyperXMic.reason, new RegExp(REQUIRED_HEADSET_NAME))

  // Inbound using non-HyperX speakers
  const nonHyperXOutput = validateSessionRoute('inbound', 'mic-from-call', 'out-speakers', inputs, outputs)
  assert.strictEqual(nonHyperXOutput.ok, false)
  assert.match(nonHyperXOutput.reason, new RegExp(REQUIRED_HEADSET_NAME))

  // Outbound routed to physical headset instead of AI-Translate-To-Call
  const badOutbound = validateSessionRoute('outbound', 'mic-1', 'out-1', inputs, outputs)
  assert.strictEqual(badOutbound.ok, false)
  assert.match(badOutbound.reason, /AI-Translate-To-Call/)

  // Inbound routed from physical mic instead of AI-Translate-Call-Capture
  const badInbound = validateSessionRoute('inbound', 'mic-1', 'out-1', inputs, outputs)
  assert.strictEqual(badInbound.ok, false)
  assert.match(badInbound.reason, /AI-Translate-Call-Capture/)

  // Outbound missing virtual sink completely
  const missingVirtual = validateSessionRoute('outbound', 'mic-1', '', inputs, [outputs[1]!])
  assert.strictEqual(missingVirtual.ok, false)
  assert.match(missingVirtual.reason, /AI-Translate-To-Call/)

  // Individual role validation accepts HyperX Cloud III and rejects virtual, non-HyperX, or empty-id devices
  assert.deepStrictEqual(validateDeviceForRole('outbound', 'input', 'mic-1', inputs), { ok: true })
  assert.strictEqual(validateDeviceForRole('outbound', 'input', 'mic-builtin', inputs).ok, false)
  assert.strictEqual(validateDeviceForRole('outbound', 'input', 'mic-from-call', inputs).ok, false)
  assert.strictEqual(
    validateDeviceForRole('outbound', 'input', '', [{ deviceId: '', kind: 'audioinput', label: '' }]).ok,
    false,
  )
})

test('findMissingActiveDevice reports when an active input or output disappears', () => {
  const inputs: AudioDeviceLike[] = [{ deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' }]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-to-call', kind: 'audiooutput', label: VIRTUAL_AUDIO_NODES.toCallSinkLabel },
  ]

  const route = {
    inputId: 'mic-1',
    inputLabel: 'HyperX Cloud III Mono',
    outputId: 'out-to-call',
    outputLabel: VIRTUAL_AUDIO_NODES.toCallSinkLabel,
  }

  assert.strictEqual(findMissingActiveDevice(route, inputs, outputs), null)
  assert.deepStrictEqual(findMissingActiveDevice(route, [], outputs), {
    kind: 'input',
    label: 'HyperX Cloud III Mono',
  })
  assert.deepStrictEqual(findMissingActiveDevice(route, inputs, []), {
    kind: 'output',
    label: VIRTUAL_AUDIO_NODES.toCallSinkLabel,
  })
})
