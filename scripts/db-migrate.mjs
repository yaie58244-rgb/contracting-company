import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is required");
  process.exit(1);
}

const dir = "database/supabase";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`create table if not exists public._applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`);

const { rows } = await client.query("select name from public._applied_migrations");
const applied = new Set(rows.map(r => r.name));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip   ${file}`);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public._applied_migrations(name) values ($1)", [file]);
    await client.query("commit");
    console.log(`ok     ${file}`);
  } catch (error) {
    await client.query("rollback").catch(() => null);
    console.error(`failed ${file}`);
    console.error(error.message);
    process.exit(1);
  }
}

await client.end();
console.log("migrations complete");
