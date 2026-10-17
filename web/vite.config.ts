import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const hash = createHash('sha256')
for (const name of readdirSync(resolve('src')).sort()) {
  if (/\.(ts|tsx|json|css|js)$/.test(name)) hash.update(name).update(readFileSync(resolve('src', name)))
}
const buildId = hash.digest('hex').slice(0, 16)

// Hashed asset filenames are Vite's default; index.html is never fingerprinted, so serve it with
// Cache-Control: no-cache (see README).
export default defineConfig({
  plugins: [react()], worker: { format: 'es' },
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  build: { rollupOptions: { plugins: [{ name: 'build-version', generateBundle() { this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({buildId})}) } }] } },
  server: { proxy: { '/usage-api': { target: 'http://127.0.0.1:8787', rewrite: path => path.replace(/^\/usage-api/, '') } } },
  preview: { proxy: { '/usage-api': { target: 'http://127.0.0.1:8787', rewrite: path => path.replace(/^\/usage-api/, '') } } },
})
