import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

const developmentPort = Number(process.env.VITE_DEV_PORT ?? 4173)
const apiOrigin = process.env.VITE_DEV_API_ORIGIN ?? 'http://127.0.0.1:8787'
const realtimeOrigin = apiOrigin.replace(/^http/, 'ws')

function forwardedHttpProxy(): ProxyOptions {
  return {
    target: apiOrigin,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest, request) => {
        if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
        proxyRequest.setHeader('x-forwarded-proto', 'http')
      })
    },
  }
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs'],
  },
  server: {
    host: '0.0.0.0',
    port: developmentPort,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': forwardedHttpProxy(),
      '/auth': forwardedHttpProxy(),
      '/mcp': forwardedHttpProxy(),
      '/oauth': forwardedHttpProxy(),
      '/.well-known': forwardedHttpProxy(),
      '/health': forwardedHttpProxy(),
      '/realtime': {
        target: realtimeOrigin,
        ws: true,
      },
    },
  },
})
