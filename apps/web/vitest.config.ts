import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Next preserves JSX for its compiler. Component tests need Vite to compile it.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {},
  oxc: { jsx: { runtime: 'automatic' } },
})
