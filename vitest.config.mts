import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Offline-only vitest config used by `npm test` and `npm run test:watch`.
// Both scripts force DB_TEST_ALLOW_WRITES to empty so an inherited value can
// never silently switch the ordinary offline run into a write-enabled DB run.
//
// The DB integration + auth suite is served by a SEPARATE dedicated config
// (vitest.db.config.mts), selected only by `npm run test:db`, which requires
// the external opt-in DB_TEST_ALLOW_WRITES=1 via scripts/require-db-test-env.mjs.
// That is also the supported explicit-file command:
//   DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth/login.test.ts
// Because the DB/auth/db files live in the DB config's include set, the file
// is actually loaded there and its module-level requireDatabaseUrl() runs.
//
// NOTE: vitest CLI positional arguments are filters over the include set, not
// additional include patterns. Passing a DB/auth file (e.g.
// `npx vitest run tests/auth/login.test.ts`) under THIS offline config yields
// "No test files found" because the file is not in the offline include set —
// it does NOT reach requireDatabaseUrl(). Use the dedicated `test:db` script
// for explicit-file DB/auth selection; missing opt-in refuses before DB via
// scripts/require-db-test-env.mjs.

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
      "tests/db/**/*.offline.test.ts",
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
  },
});