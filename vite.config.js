import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client (5173) proxies Express (3001) /proxy·/__vp·/api·/snap as same-origin.
// This makes the loaded page iframe same-origin with the host app so the inspector can read the DOM.
const PROXY_TARGET = 'http://localhost:3001'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/proxy': PROXY_TARGET,
      '/__vp': PROXY_TARGET,
      '/api': PROXY_TARGET,
      '/snap': PROXY_TARGET,
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
