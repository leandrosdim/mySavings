import "server-only";

const TRUSTED_ORIGIN_KEY = "TRUSTED_ORIGIN";
const TRUSTED_ORIGIN_DEV_KEY = "TRUSTED_ORIGIN_DEV";

class OriginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginConfigError";
  }
}

// Validate and normalize a CONFIG origin string. Config origins are the ONLY
// origins that may have a trailing slash normalized away. The result is a
// canonical origin string: scheme://host with no path, query, fragment, or
// userinfo. Throws on malformed input.
function normalizeConfigOrigin(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new OriginConfigError("Trusted origin is empty");
  }

  // Reject literal null/undefined strings that sometimes slip through env
  // defaults.
  if (raw === "null" || raw === "undefined") {
    throw new OriginConfigError("Trusted origin is literally 'null' or 'undefined'");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OriginConfigError(`Trusted origin is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new OriginConfigError(
      `Trusted origin must use http: or https: protocol, got ${parsed.protocol}`,
    );
  }

  // Production MUST be HTTPS. Dev may be http (localhost).
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new OriginConfigError(
      `Production trusted origin must be HTTPS, got ${parsed.protocol}`,
    );
  }

  if (typeof parsed.host !== "string" || parsed.host.length === 0) {
    throw new OriginConfigError("Trusted origin has no host");
  }

  // Reject userinfo (credentials in origin are not canonical).
  if (parsed.username !== "" || parsed.password !== "") {
    throw new OriginConfigError("Trusted origin must not contain userinfo");
  }

  // Reject path/query/fragment — a canonical origin is scheme://host only.
  // Config origins may have a trailing slash which we normalize away.
  const path = parsed.pathname;
  if (path !== "/" && path !== "") {
    throw new OriginConfigError(
      `Trusted origin must not contain a path, got ${path}`,
    );
  }
  if (parsed.search !== "") {
    throw new OriginConfigError("Trusted origin must not contain a query string");
  }
  if (parsed.hash !== "") {
    throw new OriginConfigError("Trusted origin must not contain a fragment");
  }

  // Canonical form: scheme://host (no trailing slash).
  return `${parsed.protocol}//${parsed.host}`;
}

let cachedConfigOrigin: string | null | undefined = undefined;
let cachedConfigError: OriginConfigError | null = null;

function readConfiguredOrigin(): string | null {
  if (cachedConfigOrigin !== undefined) {
    return cachedConfigOrigin;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const key = isProduction
    ? TRUSTED_ORIGIN_KEY
    : process.env[TRUSTED_ORIGIN_DEV_KEY]
      ? TRUSTED_ORIGIN_DEV_KEY
      : TRUSTED_ORIGIN_KEY;
  const raw = process.env[key];

  if (typeof raw !== "string" || raw.length === 0) {
    cachedConfigOrigin = null;
    return null;
  }

  try {
    cachedConfigOrigin = normalizeConfigOrigin(raw.trim());
    cachedConfigError = null;
  } catch (e) {
    cachedConfigOrigin = null;
    cachedConfigError = e instanceof OriginConfigError ? e : new OriginConfigError("Invalid trusted origin config");
  }
  return cachedConfigOrigin;
}

// Returns the cached config error if the last readConfiguredOrigin() call
// encountered a bad config. Used by validateRequestOrigin to produce a safe
// 503 on bad config.
export function getConfigError(): string | null {
  readConfiguredOrigin();
  return cachedConfigError ? cachedConfigError.message : null;
}

// Reset the config cache. Used in tests that change env vars between cases.
export function __resetConfigCache(): void {
  cachedConfigOrigin = undefined;
  cachedConfigError = null;
}

// Parse and validate a REQUEST Origin header. A request origin must be a
// canonical HTTP(S) origin exactly: scheme://host, no path, query, fragment,
// or userinfo. Returns the canonical origin string or null if invalid.
function parseRequestOrigin(origin: string): string | null {
  if (typeof origin !== "string" || origin.length === 0) {
    return null;
  }

  // Reject literal null/undefined strings.
  if (origin === "null" || origin === "undefined") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  if (typeof parsed.host !== "string" || parsed.host.length === 0) {
    return null;
  }

  // Reject userinfo.
  if (parsed.username !== "" || parsed.password !== "") {
    return null;
  }

  // Reject path/query/fragment in request origin. An Origin header should
  // never contain these; if it does, it's malformed or malicious.
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return null;
  }
  if (parsed.search !== "") {
    return null;
  }
  if (parsed.hash !== "") {
    return null;
  }

  // Reject multi-origin (comma-separated) headers — browsers never send these.
  if (origin.includes(",")) {
    return null;
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function originsMatch(requestOrigin: string, trustedOrigin: string): boolean {
  const reqParsed = parseRequestOrigin(requestOrigin);
  return reqParsed !== null && reqParsed === trustedOrigin;
}

export type OriginCheckResult =
  | { valid: true; origin: string }
  | { valid: false; reason: "missing" | "malformed" | "not_configured" | "bad_config" | "mismatch" };

export function validateRequestOrigin(requestHeaders: Headers): OriginCheckResult {
  const origin = requestHeaders.get("origin");

  // Reject missing, empty, or multi-valued Origin headers.
  if (origin === null || origin === undefined || origin === "") {
    return { valid: false, reason: "missing" };
  }

  // Reject multi-origin headers (browsers send exactly one Origin value).
  if (origin.includes(",")) {
    return { valid: false, reason: "malformed" };
  }

  const trusted = readConfiguredOrigin();
  if (cachedConfigError !== null) {
    return { valid: false, reason: "bad_config" };
  }
  if (trusted === null) {
    return { valid: false, reason: "not_configured" };
  }

  if (!originsMatch(origin, trusted)) {
    return { valid: false, reason: "mismatch" };
  }

  return { valid: true, origin: trusted };
}

export function getConfiguredOrigin(): string {
  const trusted = readConfiguredOrigin();
  if (cachedConfigError !== null) {
    throw cachedConfigError;
  }
  if (trusted === null) {
    throw new Error(
      "Trusted origin not configured. Set TRUSTED_ORIGIN (production) or TRUSTED_ORIGIN_DEV to the canonical origin (e.g. https://app.example.com).",
    );
  }
  return trusted;
}

// Returns the safe redirect URL for logout. Uses the validated canonical
// origin, never a raw forwarded host. Falls back to the relative /login path
// when no trusted origin is configured (non-production only; production
// requires TRUSTED_ORIGIN). Never builds a redirect from raw invalid input.
export function getSafeLogoutRedirect(): string {
  const trusted = readConfiguredOrigin();
  if (cachedConfigError !== null) {
    // Bad config: return the relative path, never the invalid origin.
    return "/login";
  }
  if (trusted === null) {
    return "/login";
  }
  return `${trusted}/login`;
}

export const __testing = {
  parseRequestOrigin,
  normalizeConfigOrigin,
  originsMatch,
  readConfiguredOrigin,
  OriginConfigError,
};