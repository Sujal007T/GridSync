import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom as the browser-like environment for React component tests
    environment: 'jsdom',
    // Runs before every test file. Sets up fake-indexeddb so any test that
    // imports offlineQueue.ts (or any module using window.indexedDB) gets a
    // working in-memory implementation instead of jsdom's missing stub.
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    // Vitest 4.x defaults to 'forks' (child_process.fork) which deadlocks on Windows.
    // 'threads' uses worker_threads instead and is stable on Windows.
    pool: 'threads',
  },
})
