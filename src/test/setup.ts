import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library's async queries (`findBy*`, `waitFor`) default to a 1s
// timeout. That is too tight here: this machine can spend 40-60s on transform
// and import for a single file, and under that contention an initial React
// render has been observed not to commit within 1s — the query then fails
// against a still-empty container with no error to explain it. Raised to match
// the Vitest timeouts in vite.config.ts. A genuinely missing element still
// fails, just 5s later.
configure({ asyncUtilTimeout: 5_000 })

// Synchronous on purpose. Two failed attempts at making this conditional on the
// environment are recorded in git history: a top-level `await import(...)`
// defers hook registration past Vitest's setup window (every file fails with
// "Cannot read properties of undefined (reading 'config')"), and an async
// `afterEach` lets the next test begin rendering before `cleanup()` finishes,
// which shows up as text from a previous test leaking into the next one's DOM.
// The node-environment suites tolerate this file as-is — verified, not assumed.
afterEach(() => {
  cleanup()
})
