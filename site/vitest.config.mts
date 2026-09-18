import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a React Server build; unit tests run in
      // plain Node and get an empty module instead.
      "server-only": fileURLToPath(new URL("./tests/unit/stubs/server-only.ts", import.meta.url)),
      // tsconfig's "@/*" path, which Vite does not read on its own.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit tests only. Anything needing a browser belongs in tests/e2e, which
    // Playwright runs — a jsdom approximation of a mobile browser is exactly the
    // kind of test that passes while the real device is broken.
    //
    // tests/unit/db runs the Supabase migrations in a real in-process Postgres
    // (PGlite) and checks row-level security against it.
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    /*
     * For the PGlite files in tests/unit/db.
     *
     * Each one boots a whole Postgres in a WASM sandbox and replays every
     * migration in its beforeAll. One of those fits comfortably inside the 5
     * second default; two of them starting at the same moment, on a machine
     * already running twenty other test workers, does not — and the failure
     * reads as "beforeAll timed out", which looks like a broken migration
     * rather than a busy laptop. It cost one confusing red run to learn that.
     */
    hookTimeout: 60_000,
  },
});
