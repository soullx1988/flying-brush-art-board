import { readFileSync } from 'node:fs'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

import {
  isAllowedLanHost,
  isAllowedLanOrigin,
  resolveLanEntrySecurity,
  type LanEntrySecurity,
} from './scripts/lan-entry-security.js'

function lanRequestGuard(security: LanEntrySecurity): Plugin {
  return {
    name: 'infinite-board-lan-request-guard',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!isAllowedLanHost(request.headers.host, security.allowedHosts)) {
          response.statusCode = 421
          response.end('LAN_HOST_REJECTED')
          return
        }
        if (!isAllowedLanOrigin(request.headers.origin, security.allowedOrigins)) {
          response.statusCode = 403
          response.end('LAN_ORIGIN_REJECTED')
          return
        }
        next()
      })
    },
  }
}

function forwardedHttpsProxy(target = 'http://127.0.0.1:8787'): ProxyOptions {
  return {
    target,
    configure(proxy) {
      const addForwardedHeaders = (proxyRequest: ClientRequest, request: IncomingMessage) => {
        if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
        proxyRequest.setHeader('x-forwarded-proto', 'https')
      }
      proxy.on('proxyReq', addForwardedHeaders)
      proxy.on('proxyReqWs', addForwardedHeaders)
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const security = resolveLanEntrySecurity(environment)
  const pfx = readFileSync(resolve(security.pfxPath))
  if (pfx.byteLength === 0) throw new Error('[LAN_SECURITY] LAN_HTTPS_PFX must not be empty')
  const forwardedProxy = forwardedHttpsProxy()

  return {
    root: 'apps/web',
    plugins: [lanRequestGuard(security), react()],
    optimizeDeps: {
      include: ['pdfjs-dist/legacy/build/pdf.mjs'],
    },
    server: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
      allowedHosts: security.allowedHosts,
      cors: { origin: security.allowedOrigins, credentials: true },
      https: {
        pfx,
        ...(security.pfxPassphrase ? { passphrase: security.pfxPassphrase } : {}),
      },
      proxy: {
        '/api': forwardedProxy,
        '/auth': forwardedProxy,
        '/health': forwardedProxy,
        '/mcp': forwardedProxy,
        '/oauth': forwardedProxy,
        '/.well-known': forwardedProxy,
        '/realtime': {
          ...forwardedHttpsProxy('ws://127.0.0.1:8787'),
          ws: true,
        },
      },
    },
  }
})
