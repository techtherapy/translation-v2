/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force ESM entry for track-changes-plugin (CJS entry requires @manuscripts/transform devDep)
      '@manuscripts/track-changes-plugin': path.resolve(__dirname, './node_modules/@manuscripts/track-changes-plugin/dist/es/index.js'),
      // Mock @manuscripts/transform (devDep of track-changes-plugin, not shipped)
      '@manuscripts/transform': path.resolve(__dirname, './src/__mocks__/@manuscripts/transform.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
