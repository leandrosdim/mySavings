import { Pool } from "pg";
import { loadEnvFile } from "./load-env.mjs";
import {
  buildCheckPoolConfig,
  DbConfigError,
  publicErrorReason,
} from "../db/db-config.cjs";

loadEnvFile();

const DATABASE_URL_KEY = "DATABASE_URL";

function resolveUrl() {
  const value = process.env[DATABASE_URL_KEY];
  if (typeof value !== "string" || value.length === 0) {
    throw new DbConfigError(`Missing required env ${DATABASE_URL_KEY}`);
  }
  return value;
}

async function checkConnection() {
  const url = resolveUrl();
  const pool = new Pool(buildCheckPoolConfig(url));
  try {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    const ok = await checkConnection();
    if (ok) {
      console.log("database:reachable=true");
      process.exitCode = 0;
    } else {
      console.log("database:reachable=false");
      process.exitCode = 1;
    }
  } catch (error) {
    const reason = publicErrorReason(error);
    if (error instanceof DbConfigError) {
      console.error(`database:reachable=false [${reason.code}]: ${reason.reason}`);
    } else {
      console.error(`database:reachable=false [${reason.code}]`);
    }
    process.exitCode = 1;
  }
}

main();