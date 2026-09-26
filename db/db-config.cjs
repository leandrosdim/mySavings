"use strict";

const { parse } = require("pg-connection-string");

const DATABASE_URL_KEY = "DATABASE_URL";
const MIGRATION_URL_KEY = "MIGRATION_DATABASE_URL";

const POOL_IDLE_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;
const MIGRATION_QUERY_TIMEOUT_MS = 60_000;
const MIGRATION_CONNECTION_TIMEOUT_MS = 15_000;
const CHECK_TIMEOUT_MS = 10_000;

class DbConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DbConfigError";
    this.code = "DB_CONFIG_ERROR";
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Inspect the *resulting* ssl value that pg produced after parsing the
// connection string. pg 8.x aliases sslmode=require/prefer/verify-ca to
// verify-full (ssl:{}), which keeps tls.connect's default rejectUnauthorized
// true. We reject only the values that actually disable TLS or certificate
// verification: ssl:false (sslmode=disable), ssl:undefined (no sslmode and no
// explicit ssl config -> pg defaults to no TLS), and
// ssl:{rejectUnauthorized:false} (sslmode=no-verify or uselibpqcompat=require).
function normalizeSsl(parsedSsl) {
  if (parsedSsl === false || parsedSsl === undefined) {
    return null;
  }
  if (parsedSsl === true) {
    return {};
  }
  if (typeof parsedSsl === "string") {
    if (parsedSsl === "true") {
      return {};
    }
    return null;
  }
  if (isObject(parsedSsl)) {
    return parsedSsl;
  }
  return null;
}

function enforceVerifiedTls(parsedConfig, keyName) {
  const ssl = normalizeSsl(parsedConfig.ssl);
  if (ssl === null) {
    throw new DbConfigError(
      `${keyName} must use verified TLS (sslmode=verify-full or pg 8.x alias require/prefer/verify-ca); received a connection string that disables TLS`,
    );
  }
  if (ssl.rejectUnauthorized === false) {
    throw new DbConfigError(
      `${keyName} must use verified TLS; sslmode=no-verify or uselibpqcompat disables certificate/hostname verification`,
    );
  }
  ssl.rejectUnauthorized = true;
  return ssl;
}

function validateParsedUrl(parsed, keyName) {
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new DbConfigError(`Invalid ${keyName}: expected postgres protocol`);
  }
  if (typeof parsed.hostname !== "string" || parsed.hostname.length === 0) {
    throw new DbConfigError(`Invalid ${keyName}: missing hostname`);
  }
  if (typeof parsed.pathname !== "string" || parsed.pathname.length <= 1) {
    throw new DbConfigError(`Invalid ${keyName}: missing database name`);
  }
}

function resolveSslModeFromQuery(parsedUrl) {
  const sslmode = parsedUrl.searchParams
    ? parsedUrl.searchParams.get("sslmode")
    : null;
  const uselibpqcompat = parsedUrl.searchParams
    ? parsedUrl.searchParams.get("uselibpqcompat")
    : null;
  return { sslmode, uselibpqcompat };
}

function buildSafeConnectionConfig(connectionString, keyName, options = {}) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new DbConfigError(`Missing required env ${keyName}`);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new DbConfigError(`Invalid ${keyName}: not a parseable URL`);
  }
  validateParsedUrl(parsedUrl, keyName);

  const parsedConfig = parse(connectionString);
  const ssl = enforceVerifiedTls(parsedConfig, keyName);

  const config = {
    connectionString,
    ssl,
    connectionTimeoutMillis:
      options.connectionTimeoutMillis ?? CONNECTION_TIMEOUT_MS,
    statement_timeout: options.statement_timeout ?? QUERY_TIMEOUT_MS,
    query_timeout: options.query_timeout ?? QUERY_TIMEOUT_MS,
  };
  return config;
}

function readEnv(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DbConfigError(`Missing required env ${key}`);
  }
  return value;
}

function resolveMigrationUrl() {
  const override = process.env[MIGRATION_URL_KEY];
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return readEnv(DATABASE_URL_KEY);
}

function buildAppPoolConfig(connectionString, options = {}) {
  const base = buildSafeConnectionConfig(
    connectionString,
    DATABASE_URL_KEY,
    options,
  );
  return {
    ...base,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? POOL_IDLE_TIMEOUT_MS,
  };
}

function buildMigrationPoolConfig(connectionString, options = {}) {
  const base = buildSafeConnectionConfig(
    connectionString,
    MIGRATION_URL_KEY,
    {
      connectionTimeoutMillis: MIGRATION_CONNECTION_TIMEOUT_MS,
      statement_timeout: MIGRATION_QUERY_TIMEOUT_MS,
      query_timeout: MIGRATION_QUERY_TIMEOUT_MS,
    },
  );
  return {
    ...base,
    ...options,
    max: 1,
  };
}

function buildCheckPoolConfig(connectionString) {
  const base = buildSafeConnectionConfig(connectionString, DATABASE_URL_KEY, {
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    statement_timeout: CHECK_TIMEOUT_MS,
    query_timeout: CHECK_TIMEOUT_MS,
  });
  return { ...base, max: 1 };
}

function validateMigrationUrlForTests(connectionString) {
  return buildSafeConnectionConfig(connectionString, MIGRATION_URL_KEY, {});
}

function publicErrorReason(error) {
  if (error instanceof DbConfigError) {
    return { code: error.code, reason: error.message };
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    const safeCodes = new Set([
      "DB_CONFIG_ERROR",
      "MIGRATION_CHECKSUM_MISMATCH",
      "MIGRATION_UNSAFE_SQL",
      "MIGRATION_HISTORY_INVALID",
      "MIGRATION_FILE_INVALID",
    ]);
    if (safeCodes.has(code)) {
      return { code, reason: error.message || "migration error" };
    }
  }
  return { code: "DB_ERROR", reason: "database operation failed" };
}

module.exports = {
  DbConfigError,
  DATABASE_URL_KEY,
  MIGRATION_URL_KEY,
  buildAppPoolConfig,
  buildMigrationPoolConfig,
  buildCheckPoolConfig,
  buildSafeConnectionConfig,
  validateMigrationUrlForTests,
  resolveMigrationUrl,
  readEnv,
  enforceVerifiedTls,
  normalizeSsl,
  validateParsedUrl,
  publicErrorReason,
  POOL_IDLE_TIMEOUT_MS,
  CONNECTION_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
};