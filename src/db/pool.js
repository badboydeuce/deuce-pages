let poolPromise;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getPool() {
  if (!hasDatabaseUrl()) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    }));
  }
  return poolPromise;
}

export async function query(text, params = []) {
  const pool = await getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool.query(text, params);
}

export async function withTransaction(work) {
  const pool = await getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
