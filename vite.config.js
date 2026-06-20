import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 클라이언트(5173)가 Express(3001)의 /proxy·/__vp·/api·/snap 를 동일 출처로 프록시.
// 이 덕분에 불러온 페이지 iframe 이 호스트 앱과 same-origin 이 되어 인스펙터가 DOM 을 읽는다.
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
