import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build straight into the backend's static/ dir so FastAPI serves it as-is.
export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
