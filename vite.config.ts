import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const DEV_SERVER_HOST = '127.0.0.1'
const DEV_SERVER_PORT = 5173
const DEV_SERVER_ORIGIN = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`
const DEV_SERVER_WS_ORIGIN = `ws://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.openai.com",
  "media-src 'self' mediastream:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${DEV_SERVER_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${DEV_SERVER_ORIGIN} ${DEV_SERVER_WS_ORIGIN} https://api.openai.com`,
  "media-src 'self' mediastream:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function cspMetaPlugin(): Plugin {
  let isBuild = false

  return {
    name: 'ai-translate-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: isBuild ? PRODUCTION_CSP : DEVELOPMENT_CSP,
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), cspMetaPlugin()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    host: DEV_SERVER_HOST,
    port: DEV_SERVER_PORT,
    strictPort: true,
  },
})
