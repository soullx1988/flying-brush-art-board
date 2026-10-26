import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pfxPath = process.env.LAN_HTTPS_PFX
const passphrase = process.env.LAN_HTTPS_PFX_PASSPHRASE

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs'],
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    ...(pfxPath ? { https: { pfx: readFileSync(pfxPath), ...(passphrase ? { passphrase } : {}) } } : {}),
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/auth': 'http://127.0.0.1:8787',
      '/realtime': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
})
