import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectDefaultAudioDevices, type AudioDeviceLike } from './deviceSelection.js'

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

test('selectDefaultAudioDevices prefers non-digital HyperX Cloud III when Analog is not in label', () => {
  const inputs: AudioDeviceLike[] = [{ deviceId: 'mic-hyperx', kind: 'audioinput', label: 'HyperX Cloud III' }]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-hyperx-digital', kind: 'audiooutput', label: 'HyperX Cloud III Digital Stereo (IEC958)' },
    { deviceId: 'out-hyperx-default', kind: 'audiooutput', label: 'HyperX Cloud III' },
    { deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.inboundOutputId, 'out-hyperx-default')
})

test('selectDefaultAudioDevices falls back cleanly when HyperX Cloud III is absent', () => {
  const inputs: AudioDeviceLike[] = [
    { deviceId: 'mic-usb', kind: 'audioinput', label: 'USB Condenser Mic' },
    { deviceId: 'mic-from-meet', kind: 'audioinput', label: 'AI-Translate-Meet-Audio-Capture' },
  ]
  const outputs: AudioDeviceLike[] = [
    { deviceId: 'out-speakers', kind: 'audiooutput', label: 'Built-in Speakers' },
    { deviceId: 'out-headset', kind: 'audiooutput', label: 'Bluetooth Headphones' },
    { deviceId: 'out-to-meet', kind: 'audiooutput', label: 'AI-Translate-To-Meet' },
  ]

  const selection = selectDefaultAudioDevices(inputs, outputs)

  assert.strictEqual(selection.outboundInputId, 'mic-usb')
  assert.strictEqual(selection.outboundOutputId, 'out-to-meet')
  assert.strictEqual(selection.inboundInputId, 'mic-from-meet')
  assert.strictEqual(selection.inboundOutputId, 'out-headset')
})
