import "../config/loadEnv.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./pool.js";

if (process.env.LOCAL_JSON_DB === "true") {
  console.log("LOCAL_JSON_DB=true, skipping PostgreSQL migration");
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, "../../database/schema.sql");

const sql = await fs.readFile(schemaPath, "utf8");
await query(sql);
console.log("Database schema migrated");
