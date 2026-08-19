/**
 * Vitest global setup file.
 *
 * Imports fake-indexeddb/auto which patches globalThis.indexedDB (and related globals)
 * with a fully-spec-compliant in-memory implementation. This must run before any test
 * module that touches IndexedDB, because jsdom ships with no IndexedDB implementation.
 *
 * NOTE: This file is registered via vite.config.ts → test.setupFiles, NOT as a Vitest
 * globalSetup, so it runs inside the worker context where IndexedDB is actually needed.
 */
import 'fake-indexeddb/auto';
