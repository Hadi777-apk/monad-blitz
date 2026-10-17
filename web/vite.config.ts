import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Hashed asset filenames are Vite's default; index.html is never fingerprinted, so serve it with
// Cache-Control: no-cache (see README).
export default defineConfig({ plugins: [react()], worker: { format: 'es' } })
