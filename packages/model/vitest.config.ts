import { defineConfig } from 'vitest/config'

// The domain is pure functions: no DOM, no database, nothing to set up. Tests live beside
// the sources they mirror, one directory up, so `src/` holds only what ships.
export default defineConfig({
  test: { name: 'model', include: ['tests/**/*.test.ts'], environment: 'node' },
})
