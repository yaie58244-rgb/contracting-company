import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { marketerEmail } from "@/lib/marketer-auth";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const failed = () => Response.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }, { status: 401, headers });

/**
 * Signs in with a username and password. The username is resolved to the
 * account's internal login email here on the server, so the browser never
 * learns any email address; it only receives the session tokens.
 * Older accounts keep working: an email address, or a marketer's name.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return Response.json({ error: "إعداد Supabase غير مكتمل على هذا النشر." }, { status: 503, headers });

  let input: { username?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return failed(); }
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || username.length > 120 || !password || password.length > 72) return failed();

  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createSupabaseClient(url, serviceKey, options);

  // ilike without wildcards = case-insensitive exact match (matches the unique index on lower(username)).
  const { data: profile, error: lookupError } = await admin.from("profiles").select("email").ilike("username", username.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  if (lookupError) console.warn("username lookup failed", lookupError.message);
  const email = profile?.email ? String(profile.email)
    : username.includes("@") ? username.toLowerCase()
    : await marketerEmail(username);

  const auth = createSupabaseClient(url, anonKey, options);
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) return failed();
  return Response.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, { headers });
}
