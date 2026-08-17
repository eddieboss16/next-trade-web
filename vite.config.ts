import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `localhost`, never `127.0.0.1` — the API's session cookie is host-scoped and
  // the browser treats those two as different hosts. See CLAUDE.md.
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  test: {
    // `lightweight-charts` needs a canvas jsdom lacks, so it is stubbed for the
    // whole run. An ALIAS, not `vi.mock`: with `isolate: false` files share a
    // module registry, so a per-file mock is only applied if that file happens
    // to import the module first. See src/test/chartStub.ts.
    alias: {
      'lightweight-charts': new URL('./src/test/chartStub.ts', import.meta.url)
        .pathname,
    },
    // Worker startup is the bottleneck on this Windows box: the default `forks`
    // pool never starts at all, and `threads` starts timing out once there are
    // enough test files to need several workers at once. One long-lived worker
    // sidesteps both — the suite is small and CPU-cheap, so the lost
    // parallelism costs less than the startup churn it avoids.
    pool: 'threads',
    // Vitest 4: pool options are top-level (`poolOptions` was removed).
    //
    // Worker STARTUP is the bottleneck on this Windows box — the default
    // `forks` pool never starts at all, and thread starts can exceed Vitest's
    // hard-coded 60s timeout. With isolation on, every test file costs a fresh
    // worker start (15 files = 15 starts), which began failing consistently as
    // the suite grew. `isolate: false` reuses workers, so starts drop to
    // `maxWorkers` regardless of file count — the one lever that actually
    // scales here. Lowering maxWorkers does NOT help: it just serializes the
    // same number of starts.
    //
    // ⚠ The trade: test files sharing a worker share a module registry, so
    // module-level state and `vi.mock` can leak between files. Keep mocks
    // installed/torn down per test (`vi.stubGlobal` + `vi.unstubAllGlobals`),
    // and treat any test that only passes in a particular file order as a real
    // bug. Verified by re-running the mutation checks under this setting: they
    // still fail, so the suite has not gone soft.
    isolate: false,
    maxWorkers: 4,
    environment: 'jsdom',
    // Vitest's 5s default is too tight on this machine: jsdom environment setup
    // alone runs to 220s+ across the suite, and a component test that types with
    // `userEvent` can cross 5s under that contention. The failure is not a clean
    // one either — a timed-out test keeps typing into the shared document, so
    // the NEXT test sees interleaved input ("wrong"+"secret" → "wsreocnrget")
    // and fails for an unrelated-looking reason. Raised to keep slowness from
    // masquerading as corruption. This is headroom, not `--retry`: a genuinely
    // failing test still fails.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
