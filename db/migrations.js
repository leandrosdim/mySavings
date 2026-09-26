"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const {
  DbConfigError,
  buildMigrationPoolConfig,
  resolveMigrationUrl,
  readEnv,
  publicErrorReason,
} = require("./db-config.cjs");

const DATABASE_URL_KEY = "DATABASE_URL";
const MIGRATION_URL_KEY = "MIGRATION_DATABASE_URL";
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const ENV_PATH = path.resolve(process.cwd(), ".env");
const ADVISORY_LOCK_KEY = BigInt("0x6d79536176696e67") & BigInt("0x7fffffffffffffff");

const MIGRATION_NAME_RE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

function loadEnvFile() {
  let content;
  try {
    content = fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

class MigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MigrationError";
    this.code = code || "MIGRATION_ERROR";
  }
}

const SCHEMA_MIGRATIONS_DDL = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (",
  "  version TEXT PRIMARY KEY,",
  "  checksum TEXT NOT NULL,",
  "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  ");",
].join("\n");

function checksumSql(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function validateMigrationsDir(migrationsDir) {
  const resolved = path.resolve(migrationsDir);
  const parent = path.dirname(resolved);
  if (resolved === parent) {
    throw new MigrationError(
      "Migration directory path resolves to filesystem root",
      "MIGRATION_FILE_INVALID",
    );
  }
}

function parseVersion(name) {
  const match = name.match(/^([0-9]{4})_/);
  if (!match) {
    throw new MigrationError(
      `Invalid migration filename '${name}': expected NNNN_snake_case.sql`,
      "MIGRATION_FILE_INVALID",
    );
  }
  return parseInt(match[1], 10);
}

function listMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const entries = fs.readdirSync(migrationsDir);
  const sqlFiles = entries.filter((name) => name.endsWith(".sql"));
  sqlFiles.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return sqlFiles;
}

function loadMigrationFile(name, migrationsDir) {
  const full = path.join(migrationsDir, name);
  const sql = fs.readFileSync(full, "utf8");
  return sql;
}

// ---------------------------------------------------------------------------
// Robust SQL scanner: rejects top-level transaction control and session
// overrides that could escape the outer migration transaction.
// Handles line comments (--), block comments (nestable), single-quoted
// strings with '' escapes, E'...' escape strings (backslash escapes),
// double-quoted identifiers with "" escapes, and dollar-quoted strings
// ($tag$...$tag$). A DO block's internal BEGIN/END is procedural and is NOT
// treated as top-level transaction control. Unterminated string/comment/
// dollar-quote states are rejected as malformed rather than swallowed.
// GUC lexical-mode switches (standard_conforming_strings, backslash_quote,
// client_encoding, escape_string_warning) are rejected because they
// invalidate the scanner's lexical assumptions for subsequent text.
// ---------------------------------------------------------------------------

const STATE = {
  NORMAL: 0,
  LINE_COMMENT: 1,
  BLOCK_COMMENT: 2,
  SINGLE_QUOTE: 3,
  DOUBLE_QUOTE: 4,
  DOLLAR_QUOTE: 5,
  E_STRING: 6,
};

const STATE_NAMES = {
  [STATE.BLOCK_COMMENT]: "block comment",
  [STATE.SINGLE_QUOTE]: "single-quoted string",
  [STATE.DOUBLE_QUOTE]: "double-quoted identifier",
  [STATE.DOLLAR_QUOTE]: "dollar-quoted string",
  [STATE.E_STRING]: "E escape string",
};

function assertTransactionSafe(sql, version) {
  const statements = splitTopLevelStatements(sql, version);
  for (const stmt of statements) {
    checkStatementSafe(stmt, version);
  }
}

function splitTopLevelStatements(sql, version) {
  const statements = [];
  let current = "";
  let state = STATE.NORMAL;
  let dollarTag = null;
  let blockDepth = 0;
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === STATE.NORMAL) {
      if (ch === "-" && next === "-") {
        state = STATE.LINE_COMMENT;
        current += ch + next;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = STATE.BLOCK_COMMENT;
        blockDepth = 1;
        current += ch + next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = STATE.SINGLE_QUOTE;
        current += ch;
        i += 1;
        continue;
      }
      // E'...' / e'...' escape string literal: backslash escapes are active
      // inside, so \' does not terminate the string. The E/e prefix MUST be a
      // standalone lexical prefix: it is only recognized when (a) it is
      // immediately followed by the opening quote (no intervening whitespace;
      // PostgreSQL's lexer does not allow whitespace between E and ') and (b)
      // the preceding character is not an identifier character (ASCII letter,
      // digit, underscore, or any non-ASCII byte >= 0x80, which conservatively
      // covers Unicode identifier letters). This prevents the trailing 'e' of
      // an identifier such as `name` or `CASE` from being misread as an E
      // prefix before a following whitespace + quote.
      if ((ch === "E" || ch === "e") && next === "'") {
        const prev = i > 0 ? sql.charCodeAt(i - 1) : -1;
        const prevIsIdentChar =
          prev >= 0 &&
          ((prev >= 0x30 && prev <= 0x39) || // 0-9
            (prev >= 0x41 && prev <= 0x5a) || // A-Z
            (prev >= 0x61 && prev <= 0x7a) || // a-z
            prev === 0x5f || // _
            prev >= 0x80); // non-ASCII byte: conservatively treat as identifier char
        if (!prevIsIdentChar) {
          state = STATE.E_STRING;
          current += ch + next;
          i += 2;
          continue;
        }
      }
      if (ch === '"') {
        state = STATE.DOUBLE_QUOTE;
        current += ch;
        i += 1;
        continue;
      }
      if (ch === "$") {
        const tagMatch = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
        if (tagMatch) {
          const tag = tagMatch[0];
          dollarTag = tag;
          state = STATE.DOLLAR_QUOTE;
          current += tag;
          i += tag.length;
          continue;
        }
      }
      if (ch === ";") {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        current = "";
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.LINE_COMMENT) {
      // PostgreSQL treats both `\n` and `\r` (and `\r\n`) as line-comment
      // terminators. Exiting on `\r` as well prevents a CR-only line comment
      // from swallowing a following top-level statement (e.g.
      // `-- comment\rCOMMIT WORK;`) into the comment state.
      if (ch === "\n" || ch === "\r") {
        state = STATE.NORMAL;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.BLOCK_COMMENT) {
      if (ch === "*" && next === "/") {
        current += ch + next;
        i += 2;
        blockDepth -= 1;
        if (blockDepth === 0) {
          state = STATE.NORMAL;
        }
        continue;
      }
      if (ch === "/" && next === "*") {
        current += ch + next;
        i += 2;
        blockDepth += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.SINGLE_QUOTE) {
      if (ch === "'") {
        if (next === "'") {
          current += ch + next;
          i += 2;
          continue;
        }
        current += ch;
        state = STATE.NORMAL;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.E_STRING) {
      // Inside an E'...' escape string, a backslash escapes the next byte
      // (including \' and \\), so a \' pair does not terminate the string.
      // A doubled '' is also a literal single quote inside E strings.
      if (ch === "\\") {
        current += ch;
        if (i + 1 < len) {
          current += sql[i + 1];
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          current += ch + next;
          i += 2;
          continue;
        }
        current += ch;
        state = STATE.NORMAL;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.DOUBLE_QUOTE) {
      // Inside a "..." identifier, a doubled "" is a literal double quote
      // character embedded in the identifier; it does not terminate the
      // identifier. PostgreSQL mirrors the single-quote '' rule here.
      if (ch === '"') {
        if (next === '"') {
          current += ch + next;
          i += 2;
          continue;
        }
        current += ch;
        state = STATE.NORMAL;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (state === STATE.DOLLAR_QUOTE) {
      if (ch === dollarTag[0]) {
        const candidate = sql.slice(i, i + dollarTag.length);
        if (candidate === dollarTag) {
          current += candidate;
          i += dollarTag.length;
          state = STATE.NORMAL;
          dollarTag = null;
          continue;
        }
      }
      current += ch;
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  // Reject unterminated string/comment/dollar-quote states. A migration that
  // leaves an unterminated lexical state is malformed; swallowing the trailing
  // text could hide a real transaction-control statement from the guard.
  if (state !== STATE.NORMAL && state !== STATE.LINE_COMMENT) {
    const name = STATE_NAMES[state] || "lexical state";
    throw new MigrationError(
      `Migration ${version} has an unterminated ${name} that could hide a top-level statement`,
      "MIGRATION_UNSAFE_SQL",
    );
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  return statements;
}

function stripLeadingComments(statement) {
  let s = statement;
  let i = 0;
  while (i < s.length) {
    const ws = s.slice(i).match(/^\s+/);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    if (s.startsWith("--", i)) {
      // A line comment runs to end-of-line; both `\n` and `\r` terminate it
      // (PostgreSQL treats CR as a line terminator). Find the next `\n` or
      // `\r`; if neither is present the comment runs to end-of-string.
      let j = i + 2;
      while (j < s.length && s[j] !== "\n" && s[j] !== "\r") {
        j += 1;
      }
      if (j >= s.length) return "";
      i = j + 1;
      continue;
    }
    if (s.startsWith("/*", i)) {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "/" && s[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (s[j] === "*" && s[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) {
        // Unterminated block comment at the leading edge: the caller
        // (extractLeadingKeywords) surfaces this as an unsafe rejection
        // rather than swallowing a potentially hostile trailing statement.
        throw new MigrationError(
          "Migration has an unterminated leading block comment that could hide a top-level statement",
          "MIGRATION_UNSAFE_SQL",
        );
      }
      i = j;
      continue;
    }
    break;
  }
  return s.slice(i);
}

// Extract the leading keyword tokens of a top-level statement, skipping
// whitespace and SQL comments between tokens. Stops at the first token that
// is not a bare keyword (e.g. '(', ';', a quoted identifier, a string, a
// number, or a dollar quote). Quoted identifiers ("search_path") are returned
// as the literal inner text wrapped in double quotes so callers can detect
// quoted setting targets. Returns null if the statement has no leading
// keyword and no quoted identifier (e.g. it starts with a paren, string or
// dollar quote) — those forms cannot be transaction-control statements.
// Unterminated quoted identifiers / block comments in the leading edge are
// rejected as malformed so a trailing transaction-control statement cannot
// hide behind an unterminated lexical token.
function extractLeadingKeywords(statement) {
  const stripped = stripLeadingComments(statement);
  if (stripped.length === 0) return null;
  const keywords = [];
  let i = 0;
  while (i < stripped.length) {
    const ws = stripped.slice(i).match(/^\s+/);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    if (stripped.startsWith("--", i)) {
      // Line comment runs to next `\n` or `\r` (PostgreSQL treats CR as a
      // line terminator). If neither is present, the comment runs to
      // end-of-string: break so the empty/whitespace tail is not parsed.
      let j = i + 2;
      while (j < stripped.length && stripped[j] !== "\n" && stripped[j] !== "\r") {
        j += 1;
      }
      if (j >= stripped.length) break;
      i = j + 1;
      continue;
    }
    if (stripped.startsWith("/*", i)) {
      let depth = 1;
      let j = i + 2;
      while (j < stripped.length && depth > 0) {
        if (stripped[j] === "/" && stripped[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (stripped[j] === "*" && stripped[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) {
        throw new MigrationError(
          "Migration has an unterminated leading block comment that could hide a top-level statement",
          "MIGRATION_UNSAFE_SQL",
        );
      }
      i = j;
      continue;
    }
    const kwMatch = stripped.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (kwMatch) {
      keywords.push(kwMatch[0].toUpperCase());
      i += kwMatch[0].length;
      continue;
    }
    if (stripped[i] === '"') {
      let j = i + 1;
      let inner = "";
      while (j < stripped.length) {
        if (stripped[j] === '"') {
          if (stripped[j + 1] === '"') {
            inner += '"';
            j += 2;
            continue;
          }
          break;
        }
        inner += stripped[j];
        j += 1;
      }
      if (j >= stripped.length) {
        throw new MigrationError(
          "Migration has an unterminated quoted identifier in a leading position",
          "MIGRATION_UNSAFE_SQL",
        );
      }
      keywords.push('"' + inner.toUpperCase() + '"');
      i = j + 1;
      continue;
    }
    break;
  }
  if (keywords.length === 0) return null;
  return keywords;
}

function isDoBlock(statement) {
  const keywords = extractLeadingKeywords(statement);
  return keywords !== null && keywords.length >= 1 && keywords[0] === "DO";
}

// True if the first non-comment token of the statement is a transaction-control
// family keyword or a session/search_path/role override. Matches by leading
// keyword prefix so optional clauses (WORK, TRANSACTION, AND CHAIN/AND NO
// CHAIN) and comments/whitespace between keywords cannot evade the guard.
function isTransactionControlOrOverride(keywords) {
  if (keywords === null || keywords.length === 0) return false;
  const first = keywords[0];

  // Bare transaction-control families. Any statement that starts with one of
  // these words is rejected regardless of trailing clauses (COMMIT WORK,
  // COMMIT TRANSACTION, COMMIT AND CHAIN, COMMIT AND NO CHAIN, END WORK,
  // ABORT, ROLLBACK TO ..., BEGIN, ...).
  const bareControl = new Set(["COMMIT", "ROLLBACK", "END", "ABORT", "BEGIN", "DISCARD", "UNLISTEN"]);
  if (bareControl.has(first)) return true;

  if (first === "START") {
    // START TRANSACTION / START TRANSACTION ... ; also covers
    // START/**/TRANSACTION because comments are skipped between keywords.
    return keywords.length >= 2 && keywords[1] === "TRANSACTION";
  }
  if (first === "PREPARE") {
    return keywords.length >= 2 && keywords[1] === "TRANSACTION";
  }

  // SET <target> and RESET <target> overrides.
  if (first === "SET" || first === "RESET") {
    if (keywords.length < 2) return true; // bare SET/RESET with no target: ambiguous, reject
    const target = keywords[1];
    // Session/search_path/role/authorization/transaction/lock/session-level
    // overrides that can escape the migration transaction or its scoped
    // search_path/role. SET statement_timeout (a plain GUC) is still allowed.
    const overrideTargets = new Set([
      "SESSION",
      "LOCAL",
      "ROLE",
      "TRANSACTION",
      "AUTHORIZATION",
      "SESSION_AUTHORIZATION",
      "SEARCH_PATH",
      "ALL",
      // Quoted forms of the same settings.
      '"SEARCH_PATH"',
      '"ROLE"',
      '"SESSION_AUTHORIZATION"',
      '"AUTHORIZATION"',
      // GUC lexical-mode switches: changing any of these invalidates the
      // scanner's lexical assumptions for subsequent text (e.g. turning
      // standard_conforming_strings off re-enables backslash escapes in
      // plain '...' strings; backslash_quote controls quote handling;
      // client_encoding changes byte interpretation; escape_string_warning
      // is paired with standard_conforming_strings). Reject them explicitly.
      "STANDARD_CONFORMING_STRINGS",
      "BACKSLASH_QUOTE",
      "CLIENT_ENCODING",
      "ESCAPE_STRING_WARNING",
      '"STANDARD_CONFORMING_STRINGS"',
      '"BACKSLASH_QUOTE"',
      '"CLIENT_ENCODING"',
      '"ESCAPE_STRING_WARNING"',
    ]);
    if (overrideTargets.has(target)) return true;
    // SET SESSION ... / SET LOCAL ... then a target: any following keyword is a
    // session/transaction-scoped override; reject the whole family.
    if (target === "SESSION" || target === "LOCAL") return true;
    return false;
  }

  return false;
}

function checkStatementSafe(statement, version) {
  const keywords = extractLeadingKeywords(statement);

  // A DO block's procedural BEGIN/END is not top-level transaction control.
  if (keywords !== null && keywords.length >= 1 && keywords[0] === "DO") {
    return;
  }

  if (isTransactionControlOrOverride(keywords)) {
    const label = keywords === null ? "<empty>" : keywords.join(" ");
    throw new MigrationError(
      `Migration ${version} contains a top-level transaction-control or session override statement ('${label}') that can escape or override the migration transaction`,
      "MIGRATION_UNSAFE_SQL",
    );
  }

  // Non-transactional utility statements that cannot run inside a transaction
  // block. Matched by leading keyword prefix so they are not confused with
  // occurrences inside strings or comments.
  if (keywords !== null) {
    const k = keywords;
    const startsWith = (...prefix) =>
      k.length >= prefix.length && prefix.every((w, idx) => k[idx] === w);
    if (
      startsWith("VACUUM") ||
      startsWith("CREATE", "DATABASE") ||
      startsWith("CREATE", "INDEX", "CONCURRENTLY") ||
      startsWith("REINDEX", "CONCURRENTLY") ||
      startsWith("ALTER", "SYSTEM") ||
      startsWith("CLUSTER") ||
      startsWith("CREATE", "TABLESPACE") ||
      startsWith("DROP", "TABLESPACE")
    ) {
      throw new MigrationError(
        `Migration ${version} contains a non-transactional statement (${k.join(" ")}) that cannot be rolled back`,
        "MIGRATION_UNSAFE_SQL",
      );
    }
  }
}

function validateMigrationFiles(files, migrationsDir) {
  const seenVersions = new Set();
  for (const name of files) {
    if (!MIGRATION_NAME_RE.test(name)) {
      throw new MigrationError(
        `Invalid migration filename '${name}': expected NNNN_snake_case.sql (digits, lowercase, underscore)`,
        "MIGRATION_FILE_INVALID",
      );
    }
    const versionNum = parseVersion(name);
    if (seenVersions.has(versionNum)) {
      throw new MigrationError(
        `Duplicate migration version ${versionNum} from file '${name}'`,
        "MIGRATION_FILE_INVALID",
      );
    }
    seenVersions.add(versionNum);
  }
}

function prevalidateHistory(files, ledger, migrationsDir) {
  const fileVersions = new Map();
  for (const name of files) {
    fileVersions.set(name.replace(/\.sql$/, ""), name);
  }

  let maxAppliedVersion = -1;
  for (const version of ledger.keys()) {
    const v = parseVersion(version + ".sql");
    if (v > maxAppliedVersion) maxAppliedVersion = v;
  }

  for (const [version, checksum] of ledger.entries()) {
    if (!fileVersions.has(version)) {
      throw new MigrationError(
        `Applied migration ${version} is missing from the migrations directory`,
        "MIGRATION_HISTORY_INVALID",
      );
    }
    const sql = loadMigrationFile(fileVersions.get(version), migrationsDir);
    const fileChecksum = checksumSql(sql);
    if (fileChecksum !== checksum) {
      throw new MigrationError(
        `Checksum mismatch for applied migration ${version}: ledger differs from file`,
        "MIGRATION_CHECKSUM_MISMATCH",
      );
    }
  }

  for (const name of files) {
    const version = name.replace(/\.sql$/, "");
    if (!ledger.has(version)) {
      const v = parseVersion(name);
      if (maxAppliedVersion !== -1 && v < maxAppliedVersion) {
        throw new MigrationError(
          `Migration ${version} has a version number earlier than the max applied version; out-of-order forward-only migrations are not allowed`,
          "MIGRATION_HISTORY_INVALID",
        );
      }
    }
  }
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(SCHEMA_MIGRATIONS_DDL);
}

async function getAppliedLedger(client) {
  const result = await client.query(
    "SELECT version, checksum FROM schema_migrations ORDER BY version ASC",
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.version, row.checksum);
  }
  return map;
}

async function applyMigration(client, file, sql) {
  const version = file.replace(/\.sql$/, "");
  assertTransactionSafe(sql, version);
  const checksum = checksumSql(sql);
  await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
    version,
    checksum,
  ]);
  await client.query(sql);
}

async function runMigrations(options = {}) {
  const migrationsDir = options.migrationsDir || MIGRATIONS_DIR;
  validateMigrationsDir(migrationsDir);
  const schema = options.schema || null;
  if (schema !== null) {
    if (typeof schema !== "string" || schema.length === 0) {
      throw new MigrationError("Schema option must be a non-empty string", "MIGRATION_FILE_INVALID");
    }
    if (/[,"'\\;\s]/.test(schema)) {
      throw new MigrationError(
        "Schema option must be a single identifier (no commas, quotes or whitespace)",
        "MIGRATION_FILE_INVALID",
      );
    }
  }
  const url = resolveMigrationUrl();
  const poolConfig = buildMigrationPoolConfig(url);
  const pool = new Pool(poolConfig);
  let appliedCount = 0;
  let skippedCount = 0;
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end();
    const reason = publicErrorReason(error);
    throw new MigrationError(
      `Migration run failed to connect (${reason.code})`,
      reason.code,
    );
  }
  try {
    await client.query("BEGIN");
    try {
      if (schema !== null) {
        await client.query("SELECT set_config($1, $2, true)", ["search_path", schema]);
      }
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY.toString()]);
      await ensureSchemaMigrationsTable(client);
      const ledger = await getAppliedLedger(client);
      const files = listMigrationFiles(migrationsDir);
      validateMigrationFiles(files, migrationsDir);
      prevalidateHistory(files, ledger, migrationsDir);
      for (const file of files) {
        const version = file.replace(/\.sql$/, "");
        const sql = loadMigrationFile(file, migrationsDir);
        const checksum = checksumSql(sql);
        const existing = ledger.get(version);
        if (existing !== undefined) {
          if (existing !== checksum) {
            throw new MigrationError(
              `Checksum mismatch for migration ${version}: ledger differs from file`,
              "MIGRATION_CHECKSUM_MISMATCH",
            );
          }
          skippedCount += 1;
          continue;
        }
        await applyMigration(client, file, sql);
        appliedCount += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      let rollbackError = null;
      try {
        await client.query("ROLLBACK");
      } catch (rbErr) {
        rollbackError = rbErr;
      }
      if (rollbackError !== null) {
        if (client) {
          try {
            client.release(rollbackError);
          } catch {
            try {
              client.release(true);
            } catch {
              /* ignore */
            }
          }
          client = null;
        }
      }
      throw error;
    }
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
  return { applied: appliedCount, skipped: skippedCount };
}

async function main() {
  try {
    const result = await runMigrations();
    console.log(`Migrations complete: ${result.applied} applied, ${result.skipped} skipped.`);
  } catch (error) {
    const reason = publicErrorReason(error);
    if (error instanceof MigrationError || error instanceof DbConfigError) {
      console.error(`Migration error [${reason.code}]: ${reason.reason}`);
    } else {
      console.error(`Migration run failed [${reason.code}]`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runMigrations,
  listMigrationFiles,
  checksumSql,
  loadMigrationFile,
  MigrationError,
  ADVISORY_LOCK_KEY,
  SCHEMA_MIGRATIONS_DDL,
  resolveMigrationUrl,
  assertTransactionSafe,
  splitTopLevelStatements,
  checkStatementSafe,
  validateMigrationFiles,
  prevalidateHistory,
  MIGRATION_NAME_RE,
  publicErrorReason,
  DbConfigError,
};