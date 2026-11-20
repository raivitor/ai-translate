export type AudioBridgeStatus = {
  supported: boolean
  ready: boolean
  managedByApp: boolean
  missingNodes: string[]
  error?: string
}
