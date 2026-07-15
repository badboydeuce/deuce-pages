import fs from "node:fs/promises";
import path from "node:path";

const defaultPath = path.resolve(process.cwd(), "data/local-db.json");

function dbPath() {
  return path.resolve(process.cwd(), process.env.JSON_DB_PATH || defaultPath);
}

function emptyDb() {
  return {
    users: [],
    sessions: [],
    packages: [],
    userPages: [],
    walletTransactions: [],
    pageResults: [],
    trafficEvents: []
  };
}

export function useJsonDb() {
  return process.env.LOCAL_JSON_DB === "true";
}

export async function readJsonDb() {
  const filePath = dbPath();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const next = emptyDb();
    await writeJsonDb(next);
    return next;
  }
}

export async function writeJsonDb(db) {
  const filePath = dbPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify({ ...emptyDb(), ...db }, null, 2)}\n`);
}

export async function updateJsonDb(work) {
  const db = await readJsonDb();
  const result = await work(db);
  await writeJsonDb(db);
  return result;
}
