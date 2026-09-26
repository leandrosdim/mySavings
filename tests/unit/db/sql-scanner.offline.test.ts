import { describe, it, expect } from "vitest";
import {
  assertTransactionSafe,
  splitTopLevelStatements,
  checkStatementSafe,
  validateMigrationFiles,
  prevalidateHistory,
  checksumSql,
  MigrationError,
  MIGRATION_NAME_RE,
} from "../../../db/migrations.js";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function expectReject(sql: string, label: string): void {
  it(`rejects ${label}`, () => {
    expect(() => assertTransactionSafe(sql, "test_v")).toThrow(MigrationError);
    expect(() => assertTransactionSafe(sql, "test_v")).toThrow(
      /top-level|non-transactional|override/i,
    );
  });
}

function expectAccept(sql: string, label: string): void {
  it(`accepts ${label}`, () => {
    expect(() => assertTransactionSafe(sql, "test_v")).not.toThrow();
  });
}

describe("SQL scanner: rejects top-level transaction control", () => {
  expectReject("SELECT 1; COMMIT;", "COMMIT");
  expectReject("SELECT 1; ROLLBACK;", "ROLLBACK");
  expectReject("SELECT 1; END;", "END");
  expectReject("SELECT 1; ABORT;", "ABORT");
  expectReject("BEGIN; SELECT 1;", "BEGIN");
  expectReject("START TRANSACTION; SELECT 1;", "START TRANSACTION");
  expectReject("PREPARE TRANSACTION foo;", "PREPARE TRANSACTION");
  expectReject("SET search_path TO public;", "SET search_path");
  expectReject("SET SESSION AUTHORIZATION foo;", "SET SESSION");
  expectReject("SET ROLE foo;", "SET ROLE");
  expectReject("RESET search_path;", "RESET search_path");
  expectReject("RESET ROLE;", "RESET ROLE");
  expectReject("DISCARD ALL;", "DISCARD ALL");
  expectReject("VACUUM;", "VACUUM");
  expectReject("CREATE DATABASE foo;", "CREATE DATABASE");
  expectReject("CREATE INDEX CONCURRENTLY foo ON bar(id);", "CREATE INDEX CONCURRENTLY");
  expectReject("REINDEX CONCURRENTLY TABLE foo;", "REINDEX CONCURRENTLY");
  expectReject("ALTER SYSTEM SET foo = 1;", "ALTER SYSTEM");
  expectReject("CLUSTER foo;", "CLUSTER");
  expectReject("CREATE TABLESPACE foo LOCATION '/x';", "CREATE TABLESPACE");
  expectReject("DROP TABLESPACE foo;", "DROP TABLESPACE");
});

describe("SQL scanner: rejects comment-separated controls", () => {
  expectReject("SELECT 1; -- comment\nCOMMIT;", "COMMIT after line comment");
  expectReject("SELECT 1; /* block */ COMMIT;", "COMMIT after block comment");
  expectReject("/* outer /* inner */ */ COMMIT;", "COMMIT after nested block comment");
  expectReject("-- COMMIT is here\nCOMMIT;", "COMMIT on new line after comment");
});

describe("SQL scanner: rejects transaction-control statement families (S3-01 regression)", () => {
  // The real failing sequence from docs/reviews/Step03.md: CREATE TABLE ...;
  // COMMIT WORK; SELECT 1/0; — the early COMMIT escaped the transaction and
  // the table plus ledger persisted despite the runner reporting failure.
  expectReject(
    "CREATE TABLE escaped (id integer); COMMIT WORK; SELECT 1/0;",
    "real failing sequence (COMMIT WORK escape)",
  );

  // COMMIT family — any leading COMMIT is rejected regardless of clauses.
  expectReject("COMMIT WORK;", "COMMIT WORK");
  expectReject("COMMIT TRANSACTION;", "COMMIT TRANSACTION");
  expectReject("COMMIT AND CHAIN;", "COMMIT AND CHAIN");
  expectReject("COMMIT AND NO CHAIN;", "COMMIT AND NO CHAIN");
  expectReject("COMMIT;", "bare COMMIT");
  expectReject("CREATE TABLE t (id int); COMMIT WORK;", "COMMIT WORK after DDL");

  // ROLLBACK family.
  expectReject("ROLLBACK WORK;", "ROLLBACK WORK");
  expectReject("ROLLBACK TRANSACTION;", "ROLLBACK TRANSACTION");
  expectReject("ROLLBACK AND CHAIN;", "ROLLBACK AND CHAIN");
  expectReject("ROLLBACK AND NO CHAIN;", "ROLLBACK AND NO CHAIN");
  expectReject("ROLLBACK TO SAVEPOINT foo;", "ROLLBACK TO SAVEPOINT");
  expectReject("ROLLBACK;", "bare ROLLBACK");

  // END / ABORT family.
  expectReject("END WORK;", "END WORK");
  expectReject("END TRANSACTION;", "END TRANSACTION");
  expectReject("END AND CHAIN;", "END AND CHAIN");
  expectReject("END;", "bare END");
  expectReject("ABORT WORK;", "ABORT WORK");
  expectReject("ABORT;", "bare ABORT");

  // START TRANSACTION with comment between keywords (START/**/TRANSACTION).
  expectReject("START/**/TRANSACTION;", "START/**/TRANSACTION");
  expectReject("START  /* x */  TRANSACTION;", "START TRANSACTION with block comment");
  expectReject("START TRANSACTION READ ONLY;", "START TRANSACTION READ ONLY");

  // PREPARE TRANSACTION (two-phase commit).
  expectReject("PREPARE TRANSACTION 'tx1';", "PREPARE TRANSACTION");
  expectReject("PREPARE TRANSACTION 'tx1' FOR COMMIT;", "PREPARE TRANSACTION FOR COMMIT");

  // Commented keyword forms.
  expectReject("CREATE TABLE t (id int); -- commit\nCOMMIT WORK;", "COMMIT WORK after line comment");
  expectReject("CREATE TABLE t (id int); /* block */ COMMIT AND CHAIN;", "COMMIT AND CHAIN after block comment");
  expectReject("SELECT 1; /* nested /* inner */ outer */ ROLLBACK;", "ROLLBACK after nested block comment");
});

describe("SQL scanner: rejects session/search_path/role overrides", () => {
  expectReject("SET SESSION search_path = public;", "SET SESSION search_path");
  expectReject("SET LOCAL search_path = public;", "SET LOCAL search_path");
  expectReject("SET SESSION AUTHORIZATION foo;", "SET SESSION AUTHORIZATION");
  expectReject("SET ROLE foo;", "SET ROLE");
  expectReject("SET search_path = public;", "SET search_path");
  expectReject("SET search_path TO public;", "SET search_path TO");
  expectReject("SET LOCAL ROLE foo;", "SET LOCAL ROLE");
  expectReject("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;", "SET TRANSACTION");
  expectReject("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;", "SET SESSION CHARACTERISTICS");
  expectReject("RESET search_path;", "RESET search_path");
  expectReject("RESET ROLE;", "RESET ROLE");
  expectReject("RESET ALL;", "RESET ALL");
  expectReject("RESET SESSION AUTHORIZATION;", "RESET SESSION AUTHORIZATION");
  expectReject("RESET LOCAL search_path;", "RESET LOCAL search_path");
  expectReject("DISCARD ALL;", "DISCARD ALL");
  expectReject("DISCARD TEMP;", "DISCARD TEMP");
  expectReject("UNLISTEN *;", "UNLISTEN");
  expectReject("SET \"search_path\" = public;", "SET quoted search_path");
  expectReject("SET LOCAL \"role\" = foo;", "SET LOCAL quoted role");
  expectReject("RESET \"search_path\";", "RESET quoted search_path");
  expectReject("SET \"session_authorization\" = foo;", "SET quoted session_authorization");
});

describe("SQL scanner: preserves safe SET of ordinary GUCs", () => {
  expectAccept("SET statement_timeout = 5000;", "SET statement_timeout");
  expectAccept("SET statement_timeout TO 5000;", "SET statement_timeout TO");
  expectAccept("SET work_mem = '64MB';", "SET work_mem");
  expectAccept("SET TimeZone = 'UTC';", "SET TimeZone");
  expectAccept("SET client_min_messages TO NOTICE;", "SET client_min_messages");
});

describe("SQL scanner: preserves safe SQL with strings, comments, DO blocks", () => {
  expectAccept("SELECT 1;", "plain SELECT");
  expectAccept("CREATE TABLE foo (id int);", "CREATE TABLE");
  expectAccept("ALTER TABLE foo ADD COLUMN x int;", "ALTER TABLE");
  expectAccept("SET statement_timeout = 5000;", "SET statement_timeout (safe)");
  expectAccept("INSERT INTO t VALUES ('COMMIT');", "COMMIT inside single-quoted string");
  expectAccept("INSERT INTO t VALUES ('ROLLBACK; END;');", "multiple keywords in string");
  expectAccept("$$ ROLLBACK is safe here $$", "ROLLBACK inside dollar string");
  expectAccept("$tag$ COMMIT $tag$", "COMMIT inside tagged dollar string");
  expectAccept("-- COMMIT is in comment\nSELECT 1;", "COMMIT in line comment only");
  expectAccept("/* BEGIN */ SELECT 1;", "BEGIN in block comment only");
  expectAccept("/* a /* b */ c */ SELECT 1;", "nested block comment");
  expectAccept("DO $$ BEGIN PERFORM 1; END $$;", "DO block with BEGIN/END");
  expectReject("DO $$ BEGIN PERFORM 1; END $$; COMMIT;", "COMMIT after DO block");
  expectAccept('SELECT "COMMIT" FROM foo;', "COMMIT as quoted identifier");
  expectAccept("SELECT 'foo''bar';", "escaped single quote");
  expectAccept(
    "DO $$ DECLARE x int; BEGIN INSERT INTO t VALUES ('COMMIT WORK'); END $$;",
    "transaction keywords inside DO dollar-quoted body",
  );
  expectAccept(
    "$tag$ BEGIN; COMMIT WORK; ROLLBACK; END WORK; $tag$",
    "transaction keywords inside dollar-quoted string literal",
  );
  expectAccept(
    "/* COMMIT WORK; */ /* ROLLBACK AND CHAIN; */ SELECT 1;",
    "transaction keywords only inside block comments",
  );
  expectAccept(
    "SELECT 'COMMIT WORK; ROLLBACK AND CHAIN; END; ABORT;' FROM t;",
    "transaction keywords only inside single-quoted string",
  );
  expectAccept(
    'INSERT INTO logs (msg) VALUES ("COMMIT" || "ROLLBACK");',
    "quoted identifiers that look like transaction keywords",
  );
});

describe("SQL scanner: E-string escape handling (S3-01 correction)", () => {
  // Legitimate E-string with an escaped quote hiding a COMMIT WORK token.
  // The \'; pair is an escaped single quote inside the E string, so the
  // following COMMIT WORK is string content, not a top-level statement.
  expectAccept(
    "SELECT E'quote\\'; COMMIT WORK;';",
    "E-string with escaped quote hiding COMMIT WORK (safe)",
  );
  // E-string with an escaped backslash before the terminating quote: the \\
  // is a literal backslash, then ' terminates the string, so a following
  // COMMIT WORK is a real top-level statement and must be REJECTED.
  expectReject(
    "SELECT E'a\\\\'; COMMIT WORK;",
    "E-string terminated after escaped backslash, real COMMIT follows",
  );
  // E-string terminated normally, then a real COMMIT — rejected.
  expectReject(
    "SELECT E'quote'; COMMIT WORK;",
    "E-string terminated, real COMMIT follows",
  );
  // Lowercase e'...' is also an escape string.
  expectAccept(
    "SELECT e'quote\\'; COMMIT WORK;';",
    "lowercase e string with escaped quote hiding COMMIT (safe)",
  );
  // The E/e prefix MUST be immediately adjacent to the opening quote with no
  // intervening whitespace. PostgreSQL's lexer does not allow whitespace
  // between E and ', so `E '...'` is a plain identifier `E` followed by a
  // plain single-quoted string. The scanner must NOT treat it as an escape
  // string. With standard_conforming_strings=on (the scanner's assumption),
  // the backslash in the plain string is a literal, so the second ' terminates
  // the string and the following COMMIT WORK is a real top-level statement.
  expectReject(
    "SELECT E 'quote\\'; COMMIT WORK;",
    "E with whitespace before quote is a plain identifier + plain string (real COMMIT follows)",
  );
  // The E/e prefix MUST be a standalone lexical prefix, not the trailing letter
  // of an identifier. `name` ends in `e`; the following `'...'` must be a
  // plain single-quoted string. The literal single backslash inside the plain
  // string is a literal character (standard_conforming_strings=on), so the
  // second ' terminates the string and the following COMMIT WORK; -- ' is a
  // real top-level COMMIT that must be REJECTED. This is the exact escape
  // Hermes reported: the previous whitespace E-prefix branch misread the
  // trailing `e` of `name` as an E prefix and merged the whole sequence as one
  // SELECT, letting a real COMMIT WORK escape the guard.
  expectReject(
    "SELECT name '\\'; COMMIT WORK; -- '\nSELECT 1;",
    "typed name literal: trailing e of identifier must not be E prefix (real COMMIT WORK follows)",
  );
  // Same escape with uppercase identifier ending in E (e.g. a column/type
  // name) and a CASE expression: the E in CASE is not a standalone prefix.
  expectReject(
    "SELECT CASE WHEN true THEN '\\'; COMMIT WORK; -- '\nEND;",
    "CASE keyword: trailing E must not be E prefix (real COMMIT WORK follows)",
  );
  // A column literally named `name` followed by a safe plain string then a
  // genuine E escape string that legitimately hides a COMMIT token: the
  // genuine E prefix is adjacent to its quote and is preceded by whitespace,
  // so it is recognized and the COMMIT inside is string content (safe).
  expectAccept(
    "SELECT name 'safe', E'quote\\'; COMMIT WORK;';",
    "typed name literal followed by genuine E escape string hiding COMMIT (safe)",
  );
  // A real COMMIT WORK after a genuine, properly-terminated E escape string
  // is a top-level statement and must be REJECTED.
  expectReject(
    "SELECT E'quote'; COMMIT WORK;",
    "genuine E escape string terminated then real COMMIT WORK (rejected)",
  );
  // ASCII CR-only line comment (no LF) must still terminate the comment state
  // at end-of-input and not swallow a following top-level COMMIT. PostgreSQL
  // treats CR as a line-comment terminator; the scanner's LINE_COMMENT state
  // only exits on `\n`, but at end-of-input LINE_COMMENT is allowed (it is not
  // in the unterminated reject list). A CR comment followed (after a newline)
  // by a real COMMIT must still be rejected.
  expectReject(
    "SELECT 1; -- comment\r\nCOMMIT WORK;",
    "COMMIT after CRLF line comment",
  );
  expectReject(
    "SELECT 1; -- comment with CR only\rCOMMIT WORK;",
    "COMMIT after CR-only line comment",
  );
  // Doubled '' inside an E string is a literal single quote, not a terminator.
  expectAccept(
    "SELECT E'a''b\\'; COMMIT WORK;';",
    "E string with doubled quote and escaped quote hiding COMMIT (safe)",
  );
  // Plain (non-E) string: with standard_conforming_strings=on (the default the
  // scanner assumes), backslash is a literal character, so 'quote\' terminates
  // at the second quote and the following COMMIT WORK is real -> rejected.
  expectReject(
    "SELECT 'quote\\'; COMMIT WORK;",
    "plain string backslash literal then real COMMIT (rejected)",
  );
});

describe("SQL scanner: doubled quoted identifiers", () => {
  expectAccept(
    'SELECT "a""b" FROM t;',
    "doubled double-quote inside quoted identifier (safe)",
  );
  expectAccept(
    'SELECT "COMMIT""WORK" FROM t;',
    "doubled double-quote in identifier that looks like keywords (safe)",
  );
  expectAccept(
    'CREATE TABLE "col""x" (id int);',
    "doubled double-quote in table name (safe)",
  );
});

describe("SQL scanner: rejects unterminated lexical states", () => {
  expectReject("SELECT 'unterminated", "unterminated single-quoted string");
  expectReject('SELECT "unterminated', "unterminated double-quoted identifier");
  expectReject("SELECT $$unterminated", "unterminated dollar-quoted string");
  expectReject("SELECT $tag$unterminated", "unterminated tagged dollar-quoted string");
  expectReject("/* unclosed", "unterminated block comment");
  expectReject("/* outer /* inner */ still open", "unterminated nested block comment");
  expectReject("DO $$ BEGIN PERFORM 1;", "unterminated DO dollar-quoted body");
  expectReject("SELECT 'a; COMMIT WORK;", "unterminated string hiding COMMIT");
  expectReject("SELECT E'quote\\;", "unterminated E escape string");
  expectReject(
    'CREATE TABLE "unterminated(id int);',
    "unterminated quoted identifier before paren",
  );
  expectReject(
    "/* unclosed COMMIT WORK;",
    "unterminated block comment with transaction keywords inside",
  );
});

describe("SQL scanner: rejects GUC lexical-mode switches", () => {
  // Changing any of these GUCs invalidates the scanner's lexical assumptions
  // for subsequent text in the same migration file.
  expectReject(
    "SET standard_conforming_strings = off;",
    "SET standard_conforming_strings off",
  );
  expectReject(
    "SET backslash_quote = on;",
    "SET backslash_quote on",
  );
  expectReject(
    "SET client_encoding = 'SQL_ASCII';",
    "SET client_encoding",
  );
  expectReject(
    "SET escape_string_warning = off;",
    "SET escape_string_warning off",
  );
  expectReject(
    "RESET standard_conforming_strings;",
    "RESET standard_conforming_strings",
  );
  expectReject(
    "RESET backslash_quote;",
    "RESET backslash_quote",
  );
  expectReject(
    'SET "standard_conforming_strings" = off;',
    "SET quoted standard_conforming_strings",
  );
  expectReject(
    'SET "backslash_quote" = on;',
    "SET quoted backslash_quote",
  );
  expectReject(
    "SET LOCAL standard_conforming_strings = off;",
    "SET LOCAL standard_conforming_strings off",
  );
});

describe("splitTopLevelStatements", () => {
  it("splits on semicolons outside strings/comments", () => {
    const sql = "SELECT 1; SELECT 2;";
    expect(splitTopLevelStatements(sql, "v")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("does not split on semicolons inside single-quoted strings", () => {
    const sql = "INSERT INTO t VALUES ('a;b'); SELECT 1;";
    expect(splitTopLevelStatements(sql, "v")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      "SELECT 1",
    ]);
  });

  it("does not split on semicolons inside dollar-quoted strings", () => {
    const sql = "$$ a ; b $$; SELECT 1;";
    expect(splitTopLevelStatements(sql, "v")).toEqual(["$$ a ; b $$", "SELECT 1"]);
  });

  it("does not split on semicolons inside block comments", () => {
    const sql = "/* a ; b */ SELECT 1; SELECT 2;";
    expect(splitTopLevelStatements(sql, "v")).toEqual(["/* a ; b */ SELECT 1", "SELECT 2"]);
  });

  it("does not split on semicolons inside E escape strings", () => {
    const sql = "SELECT E'a\\';b'; SELECT 1;";
    expect(splitTopLevelStatements(sql, "v")).toEqual(["SELECT E'a\\';b'", "SELECT 1"]);
  });

  it("treats backslash-escaped quote in E string as string content", () => {
    const sql = "SELECT E'q\\'; COMMIT WORK;'; SELECT 1;";
    expect(splitTopLevelStatements(sql, "v")).toEqual([
      "SELECT E'q\\'; COMMIT WORK;'",
      "SELECT 1",
    ]);
  });

  it("treats doubled double-quote inside quoted identifier as content", () => {
    const sql = 'SELECT "a""b"; SELECT 1;';
    expect(splitTopLevelStatements(sql, "v")).toEqual(['SELECT "a""b"', "SELECT 1"]);
  });

  it("rejects unterminated single-quoted string", () => {
    expect(() => splitTopLevelStatements("SELECT 'unterminated", "v")).toThrow(MigrationError);
  });

  it("rejects unterminated block comment", () => {
    expect(() => splitTopLevelStatements("/* unclosed", "v")).toThrow(MigrationError);
  });

  it("rejects unterminated dollar-quoted string", () => {
    expect(() => splitTopLevelStatements("SELECT $$unterminated", "v")).toThrow(MigrationError);
  });

  it("rejects unterminated double-quoted identifier", () => {
    expect(() => splitTopLevelStatements('SELECT "unterminated', "v")).toThrow(MigrationError);
  });
});

describe("validateMigrationFiles", () => {
  function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "mig-unit-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("accepts valid forward-only names", () => {
    expect(() => validateMigrationFiles(["0001_a.sql", "0002_b.sql"], "x")).not.toThrow();
  });

  it("rejects invalid filename with dash", () => {
    expect(() => validateMigrationFiles(["0001-kebab.sql"], "x")).toThrow(MigrationError);
  });

  it("rejects invalid filename with uppercase", () => {
    expect(() => validateMigrationFiles(["0001_Upper.sql"], "x")).toThrow(MigrationError);
  });

  it("rejects duplicate numeric versions", () => {
    expect(() => validateMigrationFiles(["0001_a.sql", "0001_b.sql"], "x")).toThrow(MigrationError);
  });

  it("rejects non-numeric prefix", () => {
    expect(() => validateMigrationFiles(["abcd_name.sql"], "x")).toThrow(MigrationError);
  });
});

describe("prevalidateHistory", () => {
  function withTempMigrationsDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "mig-pre-"));
    mkdirSync(join(dir, "migrations"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function w(dir: string, name: string, sql: string): void {
    writeFileSync(join(dir, "migrations", name), sql);
  }

  it("accepts valid history with pending migrations", () => {
    withTempMigrationsDir((dir) => {
      w(dir, "0001_a.sql", "SELECT 1;");
      w(dir, "0002_b.sql", "SELECT 2;");
      const ledger = new Map([["0001_a", checksumSql("SELECT 1;")]]);
      expect(() =>
        prevalidateHistory(["0001_a.sql", "0002_b.sql"], ledger, join(dir, "migrations")),
      ).not.toThrow();
    });
  });

  it("rejects missing applied migration", () => {
    withTempMigrationsDir((dir) => {
      w(dir, "0001_a.sql", "SELECT 1;");
      const ledger = new Map([["0009_missing", "abc"]]);
      expect(() =>
        prevalidateHistory(["0001_a.sql"], ledger, join(dir, "migrations")),
      ).toThrow(/missing/);
    });
  });

  it("rejects checksum mismatch on applied migration", () => {
    withTempMigrationsDir((dir) => {
      w(dir, "0001_a.sql", "SELECT 1;");
      const ledger = new Map([["0001_a", "wrongchecksum"]]);
      expect(() =>
        prevalidateHistory(["0001_a.sql"], ledger, join(dir, "migrations")),
      ).toThrow(/Checksum mismatch/);
    });
  });

  it("rejects newly introduced version earlier than max applied", () => {
    withTempMigrationsDir((dir) => {
      w(dir, "0001_a.sql", "SELECT 1;");
      w(dir, "0002_b.sql", "SELECT 2;");
      const ledger = new Map([["0002_b", checksumSql("SELECT 2;")]]);
      expect(() =>
        prevalidateHistory(["0001_a.sql", "0002_b.sql"], ledger, join(dir, "migrations")),
      ).toThrow(/out-of-order/);
    });
  });

  it("accepts gaps in version numbers", () => {
    withTempMigrationsDir((dir) => {
      w(dir, "0001_a.sql", "SELECT 1;");
      w(dir, "0005_b.sql", "SELECT 5;");
      const ledger = new Map([["0001_a", checksumSql("SELECT 1;")]]);
      expect(() =>
        prevalidateHistory(["0001_a.sql", "0005_b.sql"], ledger, join(dir, "migrations")),
      ).not.toThrow();
    });
  });
});