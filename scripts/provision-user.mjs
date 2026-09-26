import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { loadEnvFile } from "./load-env.mjs";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

loadEnvFile();

const DATABASE_URL_KEY = "DATABASE_URL";
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;

function resolveUrl() {
  const value = process.env[DATABASE_URL_KEY];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required env ${DATABASE_URL_KEY}`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${DATABASE_URL_KEY}: not a parseable URL`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`Invalid ${DATABASE_URL_KEY}: expected postgres protocol`);
  }
  return value;
}

function isValidEmail(email) {
  if (email.length === 0 || email.length > EMAIL_MAX) return false;
  const at = email.indexOf("@");
  return at > 0 && at < email.length - 1 && email === email.trim();
}

async function promptLine(question, { secret = false } = {}) {
  if (process.stdin.isTTY) {
    if (!secret) {
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input, output });
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }
    return new Promise((resolve) => {
      let data = "";
      process.stdout.write(question);
      const onData = (ch) => {
        const c = ch.toString();
        if (c === "\r" || c === "\n" || c === "\u0003") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(data);
        } else if (c === "\u007f" || c === "\b") {
          if (data.length > 0) {
            data = data.slice(0, -1);
          }
        } else {
          data += c;
        }
      };
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
    });
  }
  const lines = await readPipedLines();
  return lines.shift() ?? "";
}

let pipedLines = null;

async function readPipedLines() {
  if (pipedLines) {
    return pipedLines;
  }
  return new Promise((resolve) => {
    let buf = "";
    const lines = [];
    const onData = (ch) => {
      buf += ch.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, idx).replace(/\r$/, ""));
        buf = buf.slice(idx + 1);
      }
    };
    const onEnd = () => {
      if (buf.length > 0) {
        lines.push(buf);
      }
      pipedLines = lines;
      resolve(lines);
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

// This mirrors the server-side resetUserPassword lock order exactly:
//   1. BEGIN
//   2. SELECT ... FOR UPDATE on the user row (serialize with login session issuance)
//   3. UPDATE password_hash
//   4. UPDATE sessions SET revoked_at (revoke all existing sessions)
//   5. COMMIT
// The CLI must NEVER use a different lock order or a separate path that
// bypasses the user-row lock, otherwise a login in flight could create a
// session after the reset using the old password hash (S4-01).
async function provision(pool, email, password, reset) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const existing = await client.query(
        `SELECT id FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
        [email],
      );
      if (existing.rowCount > 0) {
        if (!reset) {
          throw new Error(
            "A user with that email already exists. Use --reset to overwrite the password.",
          );
        }
        const passwordHash = await hash(password, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        const userId = existing.rows[0].id;
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
          [passwordHash, userId],
        );
        await client.query(
          `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
      } else {
        if (reset) {
          throw new Error("User not found. Omit --reset to provision a new user.");
        }
        const passwordHash = await hash(password, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        await client.query(
          `INSERT INTO users (email, password_hash) VALUES ($1, $2)`,
          [email, passwordHash],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");

  const url = resolveUrl();
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });

  try {
    const email = (await promptLine("Email: ")).trim().toLowerCase();
    if (!isValidEmail(email)) {
      console.error("Invalid email.");
      process.exitCode = 1;
      return;
    }
    const password = await promptLine("Password: ", { secret: true });
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      console.error(
        `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`,
      );
      process.exitCode = 1;
      return;
    }

    await provision(pool, email, password, reset);
    console.log(reset ? "Password reset." : "User provisioned.");
  } catch (error) {
    console.error("Provisioning failed:", {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();