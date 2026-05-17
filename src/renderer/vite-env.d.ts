/// <reference types="vite/client" />

interface Window {
  aiTranslate?: {
    platform: NodeJS.Platform
    setApiKey: (key: string) => Promise<void>
    hasApiKey: () => Promise<boolean>
    clearApiKey: () => Promise<void>
    createClientSecret: (params: {
      targetLanguage: string
      enableTranscription?: boolean | undefined
    }) => Promise<{ value: string; expiresAt: number }>
  }
}
