// Guard for `npm run test:db`. The DB integration + auth suite performs real
// writes to a PostgreSQL database against uniquely-owned disposable schemas.
// It must never run as part of the ordinary offline `npm test`. To enforce
// that, `test:db` does NOT set DB_TEST_ALLOW_WRITES itself; the caller must
// supply it externally, e.g. `DB_TEST_ALLOW_WRITES=1 npm run test:db`.
// Invoking `npm run test:db` without the opt-in fails loudly here instead of
// silently falling back to the offline suite (which would exclude every
// DB/auth file and report zero tests, masking a misconfigured run).
const KEY = "DB_TEST_ALLOW_WRITES";

if (process.env[KEY] !== "1") {
  console.error(
    `Refusing to run test:db without explicit opt-in.\n` +
      `Set ${KEY}=1 in the external environment, e.g.:\n` +
      `  ${KEY}=1 npm run test:db\n` +
      `Ordinary 'npm test' stays offline and never touches the database.`,
  );
  process.exit(1);
}