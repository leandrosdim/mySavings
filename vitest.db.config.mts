import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Dedicated config for the DB integration + auth suite, selected only by
// `npm run test:db` (which requires the external opt-in
// DB_TEST_ALLOW_WRITES=1 via scripts/require-db-test-env.mjs). This config is
// cumulative: it also runs the offline unit/scanner tests so production-scanner
// regressions are exercised in both modes. The ordinary offline `npm test`
// and `npm run test:watch` use vitest.config.mts and never touch the database;
// they force DB_TEST_ALLOW_WRITES to empty so an inherited value cannot
// silently switch them into a write-enabled DB run.
//
// Explicit-file selection (e.g. a single auth/db file) is supported through
// this config: `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth/login.test.ts`.
// Because the DB/auth/db files are in this config's include set, the file is
// loaded and its module-level requireDatabaseUrl() runs; without the opt-in,
// `npm run test:db` refuses before vitest starts via the guard script, so a
// missing opt-in never reaches the database.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("tests/__mocks__/server-only.ts", import.meta.url)),
      "next/headers": fileURLToPath(new URL("tests/__mocks__/next/headers.ts", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("tests/__mocks__/next/navigation.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    include: [
      "tests/unit/**/*.test.ts",
      "tests/db/**/*.test.ts",
      "tests/auth/**/*.test.ts",
      "tests/finance/**/*.test.ts",
    ],
    exclude: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
    ],
    globals: false,
    watch: false,
    // Auth DB tests share a single global advisory lock and the same injected
    // pool mechanism (closePool/__setTestPool is process-global). Running
    // test files in parallel causes lock contention and pool-injection races.
    // Run all files in a single thread so the global lock and pool injection
    // are serialized across test files.
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});