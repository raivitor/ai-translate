import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  filterDevicesForRole,
  findMissingActiveDevice,
  resolveSavedDeviceId,
  selectDefaultAudioDevices,
  validateDeviceForRole,
  validateSessionRoute,
  type AudioDeviceLike,
} from './deviceSelection.js'

test('selectDefaultAudioDevices prioritizes HyperX Cloud III Analog output and mic alongside AI-Translate nodes', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Audio Analog Stereo' },
    { deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-meet', kind: 'audioinput', label: 'AI-Translate-Meet-Audio-Capture' },
    { deviceId: 'mic-to-meet', kind: 'audioinput', label: 'AI-Translate-Virtual-Mic-for-Meet' },
  ]

  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-hdmi', kind: 'audiooutput', label: 'HDA NVidia Digital Stereo (HDMI)' },
    { deviceId: 'out-hyperx-digital', kind: 'audiooutput', label: 'HyperX Cloud III Digital Stereo (IEC958)' },
    { deviceId: 'out-hyperx-analog', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' },
    { deviceId: 'out-from-meet', kind: 'audiooutput', label: 'AI-Translate-From-Meet' },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-hyperx')
  assert.strictEqual(selection.outboundOutputId, 'out-to-meet')
  assert.strictEqual(selection.inboundInputId, 'mic-from-meet')
  assert.strictEqual(selection.inboundOutputId, 'out-hyperx-analog')
})

test('selectDefaultAudioDevices never falls back to speakers or physical mic when virtual Meet nodes are missing', () => {
  const inputs: AudioDeviceLike[] = [{ deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III Mono' }]
  const outputs: AudioDeviceLike[] = [{ deviceId: 'out-speakers', kind: 'audiooutput', label: 'Built-in Speakers' }]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-hyperx')
  assert.strictEqual(selection.outboundOutputId, '')
  assert.strictEqual(selection.inboundInputId, '')
  assert.strictEqual(selection.inboundOutputId, 'out-speakers')
})

test('selectDefaultAudioDevices never falls back to virtual devices when physical hardware is absent', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-from-meet', kind: 'audioinput', label: 'AI-Translate-Meet-Audio-Capture' },
  ]
  const outputs: AudioDeviceLike[] = [{ deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' }]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, '')
  assert.strictEqual(selection.outboundOutputId, 'out-to-meet')
  assert.strictEqual(selection.inboundInputId, 'mic-from-meet')
  assert.strictEqual(selection.inboundOutputId, '')
})

test('filterDevicesForRole isolates virtual Meet endpoints from physical devices', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-meet', kind: 'audioinput', label: 'AI-Translate-Meet-Audio-Capture' },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-1', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' },
  ]

  assert.deepStrictEqual(
    filterDevicesForRole('outbound', 'input', inputs).map(d => d.deviceId),
    ['mic-1'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('outbound', 'output', outputs).map(d => d.deviceId),
    ['out-to-meet'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('inbound', 'input', inputs).map(d => d.deviceId),
    ['mic-from-meet'],
  )
  assert.deepStrictEqual(
    filterDevicesForRole('inbound', 'output', outputs).map(d => d.deviceId),
    ['out-1'],
  )
})

test('validateSessionRoute rejects missing or wrong-direction devices', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' },
    { deviceId: 'mic-from-meet', kind: 'audioinput', label: 'AI-Translate-Meet-Audio-Capture' },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-1', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' },
  ]

  assert.deepStrictEqual(validateSessionRoute('outbound', 'mic-1', 'out-to-meet', inputs, outputs), { ok: true })
  assert.deepStrictEqual(validateSessionRoute('inbound', 'mic-from-meet', 'out-1', inputs, outputs), { ok: true })

  // Outbound routed to physical speakers instead of AI-Translate-To-Meet
  const badOutbound = validateSessionRoute('outbound', 'mic-1', 'out-1', inputs, outputs)
  assert.strictEqual(badOutbound.ok, false)
  assert.match(badOutbound.reason, /AI-Translate-To-Meet/)

  // Inbound routed from physical mic instead of AI-Translate-Meet-Audio-Capture
  const badInbound = validateSessionRoute('inbound', 'mic-1', 'out-1', inputs, outputs)
  assert.strictEqual(badInbound.ok, false)
  assert.match(badInbound.reason, /AI-Translate-Meet-Audio-Capture/)

  // Outbound missing virtual sink completely
  const missingVirtual = validateSessionRoute('outbound', 'mic-1', '', inputs, [outputs[0]!])
  assert.strictEqual(missingVirtual.ok, false)
  assert.match(missingVirtual.reason, /AI-Translate-To-Meet/)

  // Individual role validation still allows choosing a physical mic while idle even if the virtual sink is absent
  assert.deepStrictEqual(validateDeviceForRole('outbound', 'input', 'mic-1', inputs), { ok: true })
  assert.strictEqual(validateDeviceForRole('outbound', 'input', 'mic-from-meet', inputs).ok, false)
})

test('findMissingActiveDevice reports when an active input or output disappears', () => {
  const inputs: AudioDeviceLike[] = [{ deviceId: 'mic-1', kind: 'audioinput', label: 'HyperX Cloud III Mono' }]
  const outputs: AudioDeviceLike[] = [{ deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' }]

  const route = {
    inputId: 'mic-1',
    inputLabel: 'HyperX Cloud III Mono',
    outputId: 'out-to-meet',
    outputLabel: 'AI-Translate-To-Meet',
  }

  assert.strictEqual(findMissingActiveDevice(route, inputs, outputs), null)
  assert.deepStrictEqual(findMissingActiveDevice(route, [], outputs), {
    kind: 'input',
    label: 'HyperX Cloud III Mono',
  })
  assert.deepStrictEqual(findMissingActiveDevice(route, inputs, []), {
    kind: 'output',
    label: 'AI-Translate-To-Meet',
  })
})

test('resolveSavedDeviceId matches by deviceId, falls back to label on reconnect, then default', () => {
  const devices: AudioDeviceLike[] = [
    { deviceId: 'new-id-123', kind: 'audiooutput', label: 'HyperX Cloud III Analog Stereo' },
    { deviceId: 'other-id', kind: 'audiooutput', label: 'Built-in Speakers' },
  ]

  assert.strictEqual(
    resolveSavedDeviceId(devices, 'other-id', 'HyperX Cloud III Analog Stereo', 'new-id-123'),
    'other-id',
  )
  assert.strictEqual(
    resolveSavedDeviceId(devices, 'stale-old-id', 'HyperX Cloud III Analog Stereo', 'other-id'),
    'new-id-123',
  )
  assert.strictEqual(resolveSavedDeviceId(devices, 'stale-old-id', 'Removed Headset', 'new-id-123'), 'new-id-123')
  assert.strictEqual(resolveSavedDeviceId([], 'stale-old-id', 'Removed Headset', 'missing'), '')
})
