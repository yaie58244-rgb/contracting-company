import fs from "node:fs";
import { Client } from "pg";

const pass = fs.readFileSync(process.env.TEMP + "/sb-pass.txt", "utf8").trim();
const c = new Client({ connectionString: `postgresql://postgres.poyhjbxzecpcrjfawefp:${pass}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();

const expected = {
  clients: 51329,
  client_phones: 51723,
  properties: 54307,
  property_phones: 54712,
  excel_import_rows: 54307,
  audit_logs: 105639,
};

let bad = 0;
for (const [table, want] of Object.entries(expected)) {
  const { n } = (await c.query(`select count(*)::int n from public.${table}`)).rows[0];
  const ok = n === want;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${table}: ${n} / ${want}`);
}

const refs = [
  ["properties without client", "select count(*)::int n from properties p where p.client_id is not null and not exists(select 1 from clients c where c.id=p.client_id)"],
  ["client_phones without client", "select count(*)::int n from client_phones x where not exists(select 1 from clients c where c.id=x.client_id)"],
  ["properties with unknown type", "select count(*)::int n from properties p where p.type_id is not null and not exists(select 1 from lookups l where l.id=p.type_id)"],
  ["properties with unknown area", "select count(*)::int n from properties p where p.area_id is not null and not exists(select 1 from lookups l where l.id=p.area_id)"],
  ["phone rows lacking digits", "select count(*)::int n from client_phones where normalized_phone !~ '^[0-9]+$'"],
];
for (const [label, sql] of refs) {
  const { n } = (await c.query(sql)).rows[0];
  if (n !== 0) bad++;
  console.log(`${n === 0 ? "OK  " : "FAIL"} ${label}: ${n}`);
}

const sample = (await c.query("select c.name, c.created_at, (select phone from client_phones p where p.client_id=c.id order by is_primary desc limit 1) phone from clients c order by c.created_at desc limit 3")).rows;
console.log("\nlatest clients:", sample.map(r => `${r.name} | ${r.phone ?? "-"} | ${r.created_at.toISOString().slice(0, 10)}`).join("\n               "));

const prop = (await c.query("select code, status, entry_date from properties order by created_at desc limit 3")).rows;
console.log("latest properties:", prop.map(r => `${r.code}/${r.status}/${r.entry_date}`).join(", "));

await c.end();
console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECKS FAILED`);
process.exit(bad === 0 ? 0 : 1);
