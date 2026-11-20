import { app, BrowserWindow, globalShortcut, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { clearApiKey, hasApiKey, loadApiKey, saveApiKey } from './apiKeyStore.js'
import { PipeWireAudioBridge } from './audioBridge.js'
import { createClientSecret } from './openaiRealtimeHandler.js'
import {
  isAllowedPermissionOrigin,
  isAllowedRendererUrl,
  validateApiKeyInput,
  validateCreateClientSecretParams,
  type RendererSecurityConfig,
} from './security.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = process.env.NODE_ENV === 'development'
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
const rendererIndexPath = path.join(__dirname, '../renderer/index.html')

const securityConfig: RendererSecurityConfig = {
  isDevelopment,
  rendererDevUrl,
  rendererIndexPath,
}

const DEV_LOAD_MAX_ATTEMPTS = 5
const DEV_LOAD_RETRY_DELAY_MS = 250
const MUTE_SHORTCUT = 'CommandOrControl+Shift+M'

const audioBridge = new PipeWireAudioBridge()

function registerMuteShortcut(): void {
  const registered = globalShortcut.register(MUTE_SHORTCUT, () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('aiTranslate:toggleOutboundMute')
      }
    }
  })

  if (!registered) {
    console.warn(`Global shortcut ${MUTE_SHORTCUT} could not be registered.`)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()

  if (!isAllowedRendererUrl(senderUrl, securityConfig)) {
    throw new Error('Unauthorized IPC sender.')
  }
}

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed =
      permission === 'media' && isAllowedPermissionOrigin(webContents.getURL(), details.requestingUrl, securityConfig)
    callback(allowed)
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission !== 'media' || !webContents) {
      return false
    }

    return isAllowedPermissionOrigin(webContents.getURL(), requestingOrigin, securityConfig)
  })
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function loadRendererDevUrl(window: BrowserWindow, url: string): Promise<void> {
  for (let attempt = 1; attempt <= DEV_LOAD_MAX_ATTEMPTS; attempt += 1) {
    if (window.isDestroyed()) {
      return
    }

    try {
      await window.loadURL(url)
      if (!window.isDestroyed()) {
        window.webContents.openDevTools({ mode: 'detach' })
      }
      return
    } catch (error) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : ''

      if (errorCode !== 'ERR_CONNECTION_REFUSED' || attempt === DEV_LOAD_MAX_ATTEMPTS) {
        console.error('Failed to load renderer URL:', error)
        return
      }

      await delay(DEV_LOAD_RETRY_DELAY_MS)
    }
  }
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: 'Ai Translate',
    show: false,
    backgroundColor: '#f8faf7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  let revealTimeout: ReturnType<typeof setTimeout> | undefined

  const clearRevealTimeout = (): void => {
    if (revealTimeout) {
      clearTimeout(revealTimeout)
      revealTimeout = undefined
    }
  }

  const revealMainWindow = (): void => {
    clearRevealTimeout()
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
      window.focus()
    }
  }

  window.on('closed', clearRevealTimeout)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedRendererUrl(navigationUrl, securityConfig)) {
      event.preventDefault()
    }
  })

  window.once('ready-to-show', revealMainWindow)
  window.webContents.once('did-finish-load', revealMainWindow)
  revealTimeout = setTimeout(revealMainWindow, 3000)

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load: ${errorCode} ${errorDescription}`)
  })

  if (isDevelopment) {
    await loadRendererDevUrl(window, rendererDevUrl)
    return
  }

  await window.loadFile(rendererIndexPath)
}

app.whenReady().then(async () => {
  ipcMain.handle('aiTranslate:setApiKey', (event, rawKey: unknown) => {
    assertTrustedSender(event)
    saveApiKey(validateApiKeyInput(rawKey))
  })

  ipcMain.handle('aiTranslate:hasApiKey', event => {
    assertTrustedSender(event)
    return hasApiKey()
  })

  ipcMain.handle('aiTranslate:clearApiKey', event => {
    assertTrustedSender(event)
    clearApiKey()
  })

  ipcMain.handle('aiTranslate:createClientSecret', async (event, rawParams: unknown) => {
    assertTrustedSender(event)
    const validatedParams = validateCreateClientSecretParams(rawParams)
    const apiKey = loadApiKey()

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured. Please set it in Settings.')
    }

    return createClientSecret({
      targetLanguage: validatedParams.targetLanguage,
      noiseReduction: validatedParams.noiseReduction,
      apiKey,
    })
  })

  ipcMain.handle('aiTranslate:getAudioBridgeStatus', event => {
    assertTrustedSender(event)
    return audioBridge.getStatus()
  })

  ipcMain.handle('aiTranslate:restartAudioBridge', event => {
    assertTrustedSender(event)
    return audioBridge.restart()
  })

  configureMediaPermissions()
  registerMuteShortcut()
  void audioBridge.ensureStarted()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  audioBridge.stopManaged()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
