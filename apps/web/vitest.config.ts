import { defineConfig } from 'vitest/config'

// Next preserves JSX for its compiler. Component tests need Vite to compile it.
export default defineConfig({
  test: {},
  oxc: { jsx: { runtime: 'automatic' } },
})
