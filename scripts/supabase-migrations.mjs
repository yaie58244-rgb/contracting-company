import fs from "node:fs";
import path from "node:path";

const srcDir = "database/migrations";
const outDir = "database/supabase";

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".sql")).sort();

for (const file of files) {
  let sql = fs.readFileSync(path.join(srcDir, file), "utf8");

  sql = sql
    .replaceAll('neon_auth."user"', "auth.users")
    .replaceAll("auth.user_id()", "(auth.uid()::text)")
    .replaceAll(",neon_auth,pg_temp", ",pg_temp")
    .replaceAll("auth_user.name", "coalesce(auth_user.raw_user_meta_data->>'name','')")
    .replace(/\banonymous\b/g, "anon")
    .replaceAll("'Neon Auth user was not found", "'Auth user was not found")
    .replaceAll("Neon Auth (Better Auth) stores uuid ids", "Supabase Auth stores uuid ids")
    .replaceAll("-- link to neon_auth.\"user\"", "-- link to auth.users")
    .replaceAll("-- Neon Auth identities are string IDs.", "-- Supabase Auth identities are string IDs.");

  const name = file.replace(/^\d+_/, m => m).replace("neon", "supabase");
  fs.writeFileSync(path.join(outDir, name), sql, "utf8");
}

console.log(`wrote ${files.length} files to ${outDir}`);
